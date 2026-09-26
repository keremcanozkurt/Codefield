import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { configFilesNamed, EXTERNAL, pickCandidate, readEach, unresolved } from "../analyzer.ts";
import type { ReferenceKind } from "../kinds.ts";
import { isPunct, isWord, tokenize, type CustomReader, type Token } from "../lexer.ts";
import { directoryOf, joinRepositoryPath } from "../paths.ts";
import { DeclarationIndex } from "./declarations.ts";
import { blankHeredocs } from "./heredoc.ts";

// "#" starts a comment, except for PHP 8 attributes, #[...].
const readHashComment: CustomReader = (source, index) => {
  if (source[index] !== "#" || source[index + 1] === "[") return null;
  const end = source.indexOf("\n", index);
  return { skip: true, end: end === -1 ? source.length : end };
};

const PHP_SYNTAX = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/" }],
  custom: [readHashComment],
  quotes: [
    { open: "'", close: "'", escapes: true, multiline: true },
    { open: '"', close: '"', escapes: true, multiline: true, interpolation: ["$"] },
    { open: "`", close: "`", escapes: true, multiline: true, interpolation: ["$"] },
  ],
  wordChars: "$",
} as const;

const HEREDOC = /<<<[ \t]*(?:(['"])(\w+)\1|(\w+))/g;

// Only code between <?php (or <?=) and ?> is PHP; the rest is output text,
// replaced with spaces so positions and line numbers stay the same.
function codeOnly(content: string): string {
  let result = "";
  let index = 0;
  while (index < content.length) {
    const open = content.indexOf("<?", index);
    if (open === -1) {
      result += blank(content.slice(index));
      break;
    }
    result += blank(content.slice(index, open));
    const start = content.startsWith("<?php", open) ? open + 5 : content.startsWith("<?=", open) ? open + 3 : open + 2;
    result += " ".repeat(start - open);
    const close = content.indexOf("?>", start);
    const end = close === -1 ? content.length : close;
    result += content.slice(start, end);
    if (close !== -1) result += "  ";
    index = close === -1 ? content.length : close + 2;
  }
  return result;
}

function blank(text: string): string {
  return text.replace(/[^\n]/g, " ");
}

type PhpUse = { name: string[]; alias: string };
type PhpFile = {
  declarations: { namespace: string; name: string }[];
  uses: { namespace: string; use: PhpUse }[];
  includes: { expression: Token; relativeToFile: boolean }[];
  // Class names written in code, with the namespace and imports in effect.
  names: { parts: string[]; absolute: boolean; namespace: string; aliases: Map<string, string[]> }[];
};

const DECLARATION_KEYWORDS = new Set(["class", "interface", "trait", "enum"]);
const INCLUDE_KEYWORDS = new Set(["include", "include_once", "require", "require_once"]);
// Words that can precede a class name where it is used as a type or value.
const NAME_CONTEXT = new Set(["new", "extends", "implements", "instanceof", "catch", "use"]);

function readName(tokens: Token[], index: number): { parts: string[]; absolute: boolean; next: number } | null {
  let next = index;
  const absolute = isPunct(tokens[next], "\\");
  if (absolute) next++;
  if (!isWord(tokens[next]) || tokens[next].text.startsWith("$")) return null;
  const parts = [tokens[next].text];
  next++;
  while (isPunct(tokens[next], "\\") && isWord(tokens[next + 1])) {
    parts.push(tokens[next + 1].text);
    next += 2;
  }
  return { parts, absolute, next };
}

export function readPhpFile(content: string): PhpFile {
  // PHP 7.3+ allows the closing marker to be indented and followed by code.
  const source = blankHeredocs(codeOnly(content), HEREDOC, (line, name) => {
    const rest = line.trimStart();
    return rest.startsWith(name) && !/\w/.test(rest[name.length] ?? "");
  });
  const tokens = tokenize(source, PHP_SYNTAX);
  const file: PhpFile = { declarations: [], uses: [], includes: [], names: [] };

  let namespace = "";
  let aliases = new Map<string, string[]>();
  // Brace depth at which the current namespace's top-level code sits.
  let topDepth = 0;
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPunct(token, "{")) depth++;
    else if (isPunct(token, "}")) depth = Math.max(0, depth - 1);
    if (!isWord(token)) continue;
    const word = token.text.toLowerCase();
    const previous = tokens[i - 1];
    const afterMember = isPunct(previous, ">") || (isPunct(previous, ":") && isPunct(tokens[i - 2], ":"));

    if (word === "namespace" && depth === topDepth && !isPunct(tokens[i + 1], "\\")) {
      const name = readName(tokens, i + 1);
      namespace = name === null ? "" : name.parts.join("\\");
      aliases = new Map();
      const after = tokens[name?.next ?? i + 1];
      topDepth = isPunct(after, "{") ? depth + 1 : depth;
      if (name !== null) i = name.next - 1;
      continue;
    }

    if (word === "use" && depth === topDepth) {
      let next = i + 1;
      if (isWord(tokens[next]) && ["function", "const"].includes(tokens[next].text.toLowerCase())) continue;
      while (next < tokens.length && !isPunct(tokens[next], ";")) {
        const name = readName(tokens, next);
        if (name === null) break;
        next = name.next;
        const add = (parts: string[], aliasToken?: Token) => {
          const alias = aliasToken?.text ?? parts.at(-1)!;
          aliases.set(alias.toLowerCase(), parts);
          file.uses.push({ namespace, use: { name: parts, alias } });
        };
        if (isPunct(tokens[next], "\\") && isPunct(tokens[next + 1], "{")) {
          // use A\B\{C, D as E};
          next += 2;
          while (next < tokens.length && !isPunct(tokens[next], "}")) {
            const member = readName(tokens, next);
            if (member === null) {
              next++;
              continue;
            }
            next = member.next;
            if (isWord(tokens[next], "as")) {
              add([...name.parts, ...member.parts], tokens[next + 1]);
              next += 2;
            } else add([...name.parts, ...member.parts]);
          }
          next++;
        } else if (isWord(tokens[next], "as")) {
          add(name.parts, tokens[next + 1]);
          next += 2;
        } else {
          add(name.parts);
        }
        if (isPunct(tokens[next], ",")) next++;
      }
      i = next;
      continue;
    }

    if (DECLARATION_KEYWORDS.has(word) && !afterMember && !isWord(previous, "new") && depth === topDepth) {
      const name = tokens[i + 1];
      if (isWord(name) && !name.text.startsWith("$")) file.declarations.push({ namespace, name: name.text });
      continue;
    }

    if (INCLUDE_KEYWORDS.has(word) && !afterMember) {
      let next = i + 1;
      if (isPunct(tokens[next], "(")) next++;
      // __DIR__ . '/x.php' and dirname(__FILE__) . '/x.php'
      let relativeToFile = false;
      if (isWord(tokens[next], "__DIR__") && isPunct(tokens[next + 1], ".")) {
        relativeToFile = true;
        next += 2;
      } else if (
        isWord(tokens[next], "dirname") &&
        isPunct(tokens[next + 1], "(") &&
        isWord(tokens[next + 2], "__FILE__") &&
        isPunct(tokens[next + 3], ")") &&
        isPunct(tokens[next + 4], ".")
      ) {
        relativeToFile = true;
        next += 5;
      }
      const expression = tokens[next];
      const end = tokens[next + 1];
      if (expression?.type === "string" && (isPunct(end, ";") || isPunct(end, ")") || end === undefined)) {
        file.includes.push({ expression, relativeToFile });
      }
      continue;
    }

    // Class names used in code: after new/extends/..., before ::, or fully
    // qualified. Lower-case words are functions and constants.
    if (afterMember || token.text.startsWith("$") || isPunct(previous, "\\")) continue;
    const name = readName(tokens, i);
    if (name === null) continue;
    const qualified = name.parts.length > 1;
    const inContext = isWord(previous) && NAME_CONTEXT.has(previous.text.toLowerCase());
    const beforeStatic = isPunct(tokens[name.next], ":") && isPunct(tokens[name.next + 1], ":");
    if ((qualified || inContext || beforeStatic) && /^[A-Z]/.test(name.parts.at(-1)!)) {
      file.names.push({ parts: name.parts, absolute: false, namespace, aliases });
    }
    i = name.next - 1;
  }

  // Fully qualified names, \A\B. A backslash right after a word is inside a
  // name instead, as in A\B.
  for (let i = 0; i < tokens.length; i++) {
    if (!isPunct(tokens[i], "\\") || (isWord(tokens[i - 1]) && tokens[i - 1].end === tokens[i].start)) continue;
    const name = readName(tokens, i);
    if (name !== null && name.absolute && /^[A-Z]/.test(name.parts.at(-1)!)) {
      file.names.push({ parts: name.parts, absolute: true, namespace: "", aliases: new Map() });
    }
  }
  return file;
}

type Psr4 = { prefix: string[]; directories: string[] };

// PSR-4 prefixes from every composer.json: "App\\" => "src/".
function readPsr4(repository: RepositoryContext): Psr4[] {
  const mappings: Psr4[] = [];
  for (const file of configFilesNamed(repository, (name) => name === "composer.json")) {
    let json: unknown;
    try {
      json = JSON.parse(file.content);
    } catch {
      continue;
    }
    for (const section of ["autoload", "autoload-dev"]) {
      const psr4 = (json as Record<string, Record<string, unknown>> | null)?.[section]?.["psr-4"];
      if (typeof psr4 !== "object" || psr4 === null) continue;
      for (const [prefix, target] of Object.entries(psr4 as Record<string, unknown>)) {
        const targets = (Array.isArray(target) ? target : [target]).filter((t): t is string => typeof t === "string");
        const directories = targets.flatMap((t) => {
          const path = joinRepositoryPath(directoryOf(file.path), t);
          return path === null ? [] : [path];
        });
        mappings.push({ prefix: prefix.split("\\").filter((part) => part !== ""), directories });
      }
    }
  }
  return mappings;
}

function resolveClass(
  parts: string[],
  index: DeclarationIndex,
  psr4: Psr4[],
  repository: RepositoryContext,
): FileReference["resolution"] {
  const declared = index.lookup(parts, false);
  if (declared !== null) return declared;
  for (const mapping of psr4) {
    if (mapping.prefix.length >= parts.length) continue;
    if (!mapping.prefix.every((part, i) => part.toLowerCase() === parts[i].toLowerCase())) continue;
    const rest = parts.slice(mapping.prefix.length).join("/");
    const found = pickCandidate(
      mapping.directories.map((directory) => (directory === "" ? `${rest}.php` : `${directory}/${rest}.php`)),
      repository,
      EXTERNAL,
    );
    if (found.status !== "external") return found;
  }
  return index.hasNamespace(parts.slice(0, -1).join("\\")) ? unresolved("not_found") : EXTERNAL;
}

// PHP: include/require with a literal path (optionally after __DIR__ .),
// `use` imports of classes, and class names used in code, matched against
// the classes declared in the repository and composer.json PSR-4 prefixes.
// Class names are case-insensitive in PHP and matched that way.
export const analyzePhp: LanguageAnalyzer = (files, repository) => {
  const { parsed, failed } = readEach(files, (file) => readPhpFile(file.content));
  const index = new DeclarationIndex("\\", true);
  for (const { file, value } of parsed) {
    for (const declaration of value.declarations) index.add(declaration.namespace, declaration.name, file.path);
  }
  const psr4 = readPsr4(repository);

  const references = new Map<string, FileReference[]>();
  for (const { file, value } of parsed) {
    const found: FileReference[] = [];
    const add = (specifier: string, kind: ReferenceKind, resolution: FileReference["resolution"]) =>
      found.push({ specifier, kind, resolution });

    for (const include of value.includes) {
      const text = include.expression.text;
      if (include.expression.dynamic) {
        add(text, "include", unresolved("unsupported_dynamic"));
        continue;
      }
      const fromFile = joinRepositoryPath(directoryOf(file.path), include.relativeToFile ? text.replace(/^\/+/, "") : text);
      if (include.relativeToFile || text.startsWith("./") || text.startsWith("../")) {
        add(text, "include", fromFile === null ? unresolved("outside_repository") : pickCandidate([fromFile], repository));
      } else if (text.startsWith("/")) {
        add(text, "include", EXTERNAL);
      } else {
        // PHP searches include_path before the calling file's directory; the
        // repository root and the file's directory are the likely entries.
        const fromRoot = joinRepositoryPath("", text);
        add(text, "include", pickCandidate([fromFile, fromRoot].filter((p): p is string => p !== null), repository));
      }
    }

    for (const { use } of value.uses) {
      add(use.name.join("\\"), "import", resolveClass(use.name, index, psr4, repository));
    }

    const own = new Set(value.declarations.map((d) => (d.namespace ? `${d.namespace}\\${d.name}` : d.name).toLowerCase()));
    for (const name of value.names) {
      let parts: string[];
      if (name.absolute) parts = name.parts;
      else {
        const imported = name.aliases.get(name.parts[0].toLowerCase());
        // Imported names already have an import reference.
        if (imported !== undefined && name.parts.length === 1) continue;
        parts = imported !== undefined
          ? [...imported, ...name.parts.slice(1)]
          : [...(name.namespace === "" ? [] : name.namespace.split("\\")), ...name.parts];
      }
      if (own.has(parts.join("\\").toLowerCase())) continue;
      const resolution = index.lookup(parts, false);
      if (resolution !== null && resolution.status === "resolved") add(parts.join("\\"), "reference", resolution);
    }

    references.set(file.path, found);
  }
  return { references, failed };
};

