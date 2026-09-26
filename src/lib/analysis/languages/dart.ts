import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { configFilesNamed, EXTERNAL, pickCandidate, readEach, resolved, unresolved } from "../analyzer.ts";
import type { ReferenceKind } from "../kinds.ts";
import { isPunct, isWord, readQualifiedName, tokenize, type Token } from "../lexer.ts";
import { directoryOf, joinRepositoryPath } from "../paths.ts";

const DART_SYNTAX = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/", nested: true }],
  quotes: [
    { open: "r'''", close: "'''", multiline: true },
    { open: 'r"""', close: '"""', multiline: true },
    { open: "r'", close: "'" },
    { open: 'r"', close: '"' },
    { open: "'''", close: "'''", escapes: true, multiline: true, interpolation: ["$"] },
    { open: '"""', close: '"""', escapes: true, multiline: true, interpolation: ["$"] },
    { open: "'", close: "'", escapes: true, interpolation: ["$"] },
    { open: '"', close: '"', escapes: true, interpolation: ["$"] },
  ],
} as const;

type Directive =
  | { kind: ReferenceKind; uri: Token }
  // part of some.library.name;
  | { kind: "module"; libraryName: string };

type DartFile = { directives: Directive[]; library: string | null };

export function readDartFile(content: string): DartFile {
  const tokens = tokenize(content, DART_SYNTAX);
  const directives: Directive[] = [];
  let library: string | null = null;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isWord(token)) continue;
    const previous = tokens[i - 1];
    if (previous !== undefined && !isPunct(previous, ";") && !isPunct(previous, "}") && !isPunct(previous, ")")) continue;

    const next = tokens[i + 1];
    if (token.text === "library") {
      const name = readQualifiedName(tokens, i + 1);
      if (name !== null) library = name.parts.join(".");
    } else if ((token.text === "import" || token.text === "export") && next?.type === "string") {
      directives.push({ kind: token.text === "import" ? "import" : "reexport", uri: next });
    } else if (token.text === "part" && next?.type === "string") {
      directives.push({ kind: "module", uri: next });
    } else if (token.text === "part" && isWord(next, "of")) {
      const target = tokens[i + 2];
      if (target?.type === "string") directives.push({ kind: "module", uri: target });
      else {
        const name = readQualifiedName(tokens, i + 2);
        if (name !== null) directives.push({ kind: "module", libraryName: name.parts.join(".") });
      }
    }
  }
  return { directives, library };
}

// Package names from every pubspec.yaml, mapped to the directory holding it.
// Only the top-level `name:` line is read.
function readPackages(repository: RepositoryContext): Map<string, string | null> {
  const packages = new Map<string, string | null>();
  for (const file of configFilesNamed(repository, (name) => name === "pubspec.yaml")) {
    const match = /^name:[ \t]*["']?([A-Za-z_][\w]*)["']?[ \t]*(#.*)?$/m.exec(file.content);
    if (match === null) continue;
    const name = match[1];
    // Two packages with one name cannot be told apart.
    packages.set(name, packages.has(name) ? null : directoryOf(file.path));
  }
  return packages;
}

function resolveUri(
  uri: Token,
  fromPath: string,
  packages: Map<string, string | null>,
  repository: RepositoryContext,
): FileReference["resolution"] {
  if (uri.dynamic) return unresolved("unsupported_dynamic");
  const value = uri.text;
  if (value.startsWith("package:")) {
    const slash = value.indexOf("/");
    if (slash === -1) return unresolved("not_found");
    const name = value.slice("package:".length, slash);
    const directory = packages.get(name);
    if (directory === undefined) return EXTERNAL;
    if (directory === null) return unresolved("ambiguous");
    const path = joinRepositoryPath(directory === "" ? "lib" : `${directory}/lib`, value.slice(slash + 1));
    return path === null ? unresolved("outside_repository") : pickCandidate([path], repository);
  }
  if (/^[a-z][\w+.-]*:/i.test(value)) return EXTERNAL;
  const path = joinRepositoryPath(directoryOf(fromPath), value);
  return path === null ? unresolved("outside_repository") : pickCandidate([path], repository);
}

// Dart: import, export, part and `part of` by URI, relative or
// `package:name/...` when name is a package in this repository (from
// pubspec.yaml). `part of library.name` is matched to the file declaring that
// library. `dart:` libraries and other packages are external.
export const analyzeDart: LanguageAnalyzer = (files, repository) => {
  const packages = readPackages(repository);
  const { parsed, failed } = readEach(files, (file) => readDartFile(file.content));

  const libraries = new Map<string, string | null>();
  for (const { file, value } of parsed) {
    if (value.library === null) continue;
    libraries.set(value.library, libraries.has(value.library) ? null : file.path);
  }

  const references = new Map<string, FileReference[]>();
  for (const { file, value } of parsed) {
    references.set(
      file.path,
      value.directives.map((directive) => {
        if ("libraryName" in directive) {
          const owner = libraries.get(directive.libraryName);
          return {
            specifier: directive.libraryName,
            kind: directive.kind,
            resolution: owner === undefined ? unresolved("not_found") : owner === null ? unresolved("ambiguous") : resolved(owner),
          };
        }
        return {
          specifier: directive.uri.text,
          kind: directive.kind,
          resolution: resolveUri(directive.uri, file.path, packages, repository),
        };
      }),
    );
  }
  return { references, failed };
};
