import type { AnalyzedFile, FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { configFilesNamed, EXTERNAL, pickCandidate, readEach, resolved, unresolved } from "../analyzer.ts";
import type { ReferenceKind } from "../kinds.ts";
import { isPunct, isWord, readCharLiteral, tokenize, type CustomReader, type Token } from "../lexer.ts";
import { directoryOf, joinRepositoryPath } from "../paths.ts";

// r"...", r#"..."#, br"..." and b'x'.
const readRawString: CustomReader = (source, index) => {
  const match = /^b?r(#*)"/.exec(source.slice(index, index + 40));
  if (match !== null && !(index > 0 && /\w/.test(source[index - 1]))) {
    const close = source.indexOf(`"${match[1]}`, index + match[0].length);
    return { end: close === -1 ? source.length : close + 1 + match[1].length, value: "", dynamic: false };
  }
  if (source[index] === "b" && source[index + 1] === "'" && !(index > 0 && /\w/.test(source[index - 1]))) {
    const char = readCharLiteral(source, index + 1, undefined);
    if (char !== null && !char.skip) return { ...char, end: char.end };
  }
  return null;
};

const RUST_SYNTAX = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/", nested: true }],
  custom: [readRawString, readCharLiteral],
  quotes: [
    { open: 'b"', close: '"', escapes: true, multiline: true },
    { open: '"', close: '"', escapes: true, multiline: true },
  ],
} as const;

type ModDeclaration = { name: string; inline: string[]; path: string | null };
type UsePath = { segments: string[]; inline: string[]; reexport: boolean };
type RustFile = { mods: ModDeclaration[]; inlineMods: string[][]; uses: UsePath[] };

export function readRustFile(content: string): RustFile {
  const tokens = tokenize(content, RUST_SYNTAX);
  const file: RustFile = { mods: [], inlineMods: [], uses: [] };
  // Inline `mod name { ... }` blocks enclosing the current position.
  const stack: { name: string; depth: number }[] = [];
  let depth = 0;
  let pathAttribute: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPunct(token, "{")) {
      depth++;
      continue;
    }
    if (isPunct(token, "}")) {
      depth--;
      while (stack.length > 0 && stack.at(-1)!.depth > depth) stack.pop();
      pathAttribute = null;
      continue;
    }
    if (isPunct(token, ";")) {
      pathAttribute = null;
      continue;
    }
    // #[path = "file.rs"]
    if (isPunct(token, "#") && isPunct(tokens[i + 1], "[") && isWord(tokens[i + 2], "path") && isPunct(tokens[i + 3], "=")) {
      if (tokens[i + 4]?.type === "string") pathAttribute = tokens[i + 4].text;
      continue;
    }
    if (!isWord(token) || isPunct(tokens[i - 1], ":") || isPunct(tokens[i - 1], ".")) continue;
    const inline = stack.map((entry) => entry.name);

    if (token.text === "mod" && isWord(tokens[i + 1])) {
      const name = tokens[i + 1].text.replace(/^r#/, "");
      if (isPunct(tokens[i + 2], ";")) {
        file.mods.push({ name, inline, path: pathAttribute });
      } else if (isPunct(tokens[i + 2], "{")) {
        stack.push({ name, depth: depth + 1 });
        file.inlineMods.push([...inline, name]);
      }
      pathAttribute = null;
      continue;
    }

    if (token.text === "use") {
      // pub use, pub(crate) use
      const reexport = isWord(tokens[i - 1], "pub") || (isPunct(tokens[i - 1], ")") && isWord(tokens[i - 4], "pub"));
      // Bounded, so a file of `use` without semicolons stays linear.
      let end = -1;
      for (let j = i + 1; j < Math.min(tokens.length, i + 4096) && end === -1; j++) if (isPunct(tokens[j], ";")) end = j;
      const tree = tokens.slice(i + 1, end === -1 ? Math.min(tokens.length, i + 4096) : end);
      for (const segments of expandUseTree(tree)) file.uses.push({ segments, inline, reexport });
      if (end !== -1) i = end;
    }
  }
  return file;
}

// Expands `a::{b::C, d::*}` into [a, b, C] and [a, d, *]. `as` aliases and
// `self` inside braces are handled; `self` means the enclosing path itself.
export function expandUseTree(tokens: Token[]): string[][] {
  const results: string[][] = [];
  let index = 0;

  const parse = (prefix: string[]) => {
    const segments = [...prefix];
    if (isPunct(tokens[index], ":") && isPunct(tokens[index + 1], ":")) index += 2;
    while (index < tokens.length) {
      const token = tokens[index];
      if (isPunct(token, "{")) {
        index++;
        while (index < tokens.length && !isPunct(tokens[index], "}")) {
          parse(segments);
          if (isPunct(tokens[index], ",")) index++;
        }
        index++;
        return;
      }
      if (isPunct(token, "*")) {
        results.push([...segments, "*"]);
        index++;
        return;
      }
      if (!isWord(token)) return;
      // `a::{self, b}` names `a` itself.
      if (token.text === "self" && prefix.length > 0 && segments.length === prefix.length) {
        results.push([...segments]);
        index++;
        skipAlias();
        return;
      }
      segments.push(token.text.replace(/^r#/, ""));
      index++;
      if (isPunct(tokens[index], ":") && isPunct(tokens[index + 1], ":")) {
        index += 2;
        continue;
      }
      skipAlias();
      results.push(segments);
      return;
    }
  };
  const skipAlias = () => {
    if (isWord(tokens[index], "as")) index += 2;
  };
  parse([]);
  return results;
}

// One crate: a library, binary, test, example or benchmark root. Only
// libraries have a name other crates can `use`.
type Crate = { name: string | null; root: string };

// Crates from each Cargo.toml: the package name (as written in code, with
// "-" as "_") for the library root, and binary, test, example and benchmark
// roots by Cargo's conventions. Without any Cargo.toml, every src/lib.rs and
// src/main.rs is taken as a crate root.
function readCrates(repository: RepositoryContext, files: AnalyzedFile[]): Crate[] {
  const manifests = configFilesNamed(repository, (name) => name === "Cargo.toml");
  const paths = files.map((file) => file.path);
  const crates: Crate[] = [];
  for (const manifest of manifests) {
    const directory = directoryOf(manifest.path);
    const package_ = /^name\s*=\s*"([^"]+)"/m.exec(tomlSection(manifest.content, "package"));
    const libPath = /^path\s*=\s*"([^"]+)"/m.exec(tomlSection(manifest.content, "lib"));
    const prefix = directory === "" ? "" : `${directory}/`;
    const lib = libPath !== null ? joinRepositoryPath(directory, libPath[1]) : `${prefix}src/lib.rs`;
    const roots = paths.filter((path) => {
      if (!path.startsWith(prefix)) return false;
      const rest = path.slice(prefix.length);
      return (
        rest === "src/main.rs" ||
        rest === "build.rs" ||
        /^src\/bin\/[^/]+\.rs$/.test(rest) ||
        /^src\/bin\/[^/]+\/main\.rs$/.test(rest) ||
        /^(tests|examples|benches)\/[^/]+\.rs$/.test(rest) ||
        /^(tests|examples|benches)\/[^/]+\/main\.rs$/.test(rest)
      );
    });
    if (lib !== null && repository.sourcePaths.has(lib)) {
      crates.push({ name: package_ === null ? null : package_[1].replace(/-/g, "_"), root: lib });
    }
    for (const root of roots) crates.push({ name: null, root });
  }
  if (manifests.length === 0) {
    for (const path of paths) {
      if (/(^|\/)src\/(lib|main)\.rs$/.test(path)) crates.push({ name: null, root: path });
    }
  }
  return crates;
}

function isModRsFile(path: string, rootFiles: Set<string>): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name === "mod.rs" || rootFiles.has(path);
}

// Directory holding the files of modules declared in `path` inside the
// inline modules `inline`.
function childDirectory(path: string, inline: string[], rootFiles: Set<string>): string {
  const directory = directoryOf(path);
  const stem = path.slice(path.lastIndexOf("/") + 1).replace(/\.rs$/, "");
  const base = isModRsFile(path, rootFiles) ? directory : directory === "" ? stem : `${directory}/${stem}`;
  return [base, ...inline].filter((segment) => segment !== "").join("/");
}

type ModuleLocation = { crate: number; path: string[] };

// Rust: `mod name;` declarations map to name.rs or name/mod.rs (or a #[path]
// attribute), which also gives every reachable file its module path. `use`
// paths starting with crate, self, super, a module declared in the same file
// or another crate of the repository are resolved to the file of the longest
// module prefix they name; the item itself may be defined there or re-exported.
// Other paths name std or external crates.
export const analyzeRust: LanguageAnalyzer = (files, repository) => {
  const { parsed, failed } = readEach(files, (file) => readRustFile(file.content));
  const byPath = new Map(parsed.map(({ file, value }) => [file.path, value]));
  const crates = readCrates(repository, files);
  const rootFiles = new Set(crates.map((crate) => crate.root));

  const modTargets = new Map<string, Map<ModDeclaration, FileReference["resolution"]>>();
  const resolveMod = (path: string, declaration: ModDeclaration): FileReference["resolution"] => {
    if (declaration.path !== null) {
      const base = [directoryOf(path), ...declaration.inline].filter((s) => s !== "").join("/");
      const target = joinRepositoryPath(base, declaration.path);
      return target === null ? unresolved("outside_repository") : pickCandidate([target], repository);
    }
    const directory = childDirectory(path, declaration.inline, rootFiles);
    const base = directory === "" ? declaration.name : `${directory}/${declaration.name}`;
    return pickCandidate([`${base}.rs`, `${base}/mod.rs`], repository);
  };
  for (const [path, file] of byPath) {
    modTargets.set(path, new Map(file.mods.map((mod) => [mod, resolveMod(path, mod)])));
  }

  // Module paths, walking `mod` declarations out from each crate root.
  const locations = new Map<string, ModuleLocation>();
  const modules = crates.map(() => new Map<string, string>());
  crates.forEach((crate, index) => {
    const visited = new Set<string>();
    const queue = [{ path: crate.root, module: [] as string[] }];
    while (queue.length > 0) {
      const { path, module } = queue.shift()!;
      if (visited.has(path)) continue;
      visited.add(path);
      // A file reachable from several crates keeps its first module path.
      if (!locations.has(path)) locations.set(path, { crate: index, path: module });
      modules[index].set(module.join("::"), path);
      const file = byPath.get(path);
      if (file === undefined) continue;
      for (const inline of file.inlineMods) modules[index].set([...module, ...inline].join("::"), path);
      for (const [declaration, target] of modTargets.get(path) ?? []) {
        if (target.status === "resolved") {
          queue.push({ path: target.path, module: [...module, ...declaration.inline, declaration.name] });
        }
      }
    }
  });
  const crateByName = new Map<string, number>();
  crates.forEach((crate, index) => {
    if (crate.name !== null) crateByName.set(crate.name, index);
  });

  const resolveUse = (path: string, file: RustFile, use: UsePath): FileReference["resolution"] => {
    const [first, ...rest] = use.segments;
    const location = locations.get(path);
    let crate: number;
    let base: string[];

    if (first === "crate" || first === "self" || first === "super") {
      if (location === undefined) return unresolved("unsupported_resolution");
      crate = location.crate;
      const current = [...location.path, ...use.inline];
      if (first === "crate") base = [];
      else base = current;
      let remaining = rest;
      if (first === "super") {
        base = current.slice(0, -1);
        while (remaining[0] === "super") {
          base = base.slice(0, -1);
          remaining = remaining.slice(1);
        }
      }
      return longestModule(crate, base, remaining);
    }

    // A module declared in this file, in the same inline scope.
    const declared = file.mods.find((mod) => mod.name === first && sameScope(mod.inline, use.inline));
    if (declared !== undefined) {
      const target = modTargets.get(path)?.get(declared);
      if (location === undefined) return target ?? unresolved("not_found");
      return longestModule(location.crate, [...location.path, ...use.inline], use.segments);
    }
    if (file.inlineMods.some((inline) => sameScope(inline.slice(0, -1), use.inline) && inline.at(-1) === first)) {
      return resolved(path);
    }

    const other = crateByName.get(first);
    if (other !== undefined) return longestModule(other, [], rest);
    return EXTERNAL;
  };

  const longestModule = (crate: number, base: string[], segments: string[]): FileReference["resolution"] => {
    const names = segments.filter((segment) => segment !== "*" && segment !== "self");
    for (let length = names.length; length >= 0; length--) {
      const file = modules[crate].get([...base, ...names.slice(0, length)].join("::"));
      if (file !== undefined) return resolved(file);
    }
    return unresolved("not_found");
  };

  const references = new Map<string, FileReference[]>();
  for (const [path, file] of byPath) {
    const found: FileReference[] = [];
    for (const [declaration, resolution] of modTargets.get(path) ?? []) {
      found.push({ specifier: `mod ${[...declaration.inline, declaration.name].join("::")}`, kind: "module", resolution });
    }
    for (const use of file.uses) {
      const kind: ReferenceKind = use.reexport ? "reexport" : "import";
      found.push({ specifier: use.segments.join("::"), kind, resolution: resolveUse(path, file, use) });
    }
    references.set(path, found);
  }
  return { references, failed };
};

// The lines of one [section] of a TOML file, up to the next section header.
export function tomlSection(content: string, name: string): string {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${name}]`);
  if (start === -1) return "";
  const end = lines.findIndex((line, i) => i > start && /^\s*\[/.test(line));
  return lines.slice(start + 1, end === -1 ? lines.length : end).join("\n");
}

function sameScope(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((segment, i) => segment === b[i]);
}
