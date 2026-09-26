import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { readEach, resolved } from "../analyzer.ts";
import { isPunct, isWord, tokenize, type CustomReader } from "../lexer.ts";
import { DeclarationIndex } from "./declarations.ts";

// #"..."#, ##"""..."""## and other raw strings, whose delimiter includes the
// hashes.
const readRawString: CustomReader = (source, index) => {
  const match = /^(#+)("""|")/.exec(source.slice(index, index + 24));
  if (match === null) return null;
  const close = source.indexOf(`${match[2]}${match[1]}`, index + match[0].length);
  return { end: close === -1 ? source.length : close + match[2].length + match[1].length, value: "", dynamic: false };
};

const SWIFT_SYNTAX = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/", nested: true }],
  custom: [readRawString],
  quotes: [
    { open: '"""', close: '"""', escapes: true, multiline: true, interpolation: ["\\("] },
    { open: '"', close: '"', escapes: true, interpolation: ["\\("] },
  ],
} as const;

const TYPE_KEYWORDS = new Set(["class", "struct", "enum", "protocol", "actor", "typealias"]);
const DECLARATION_FOLLOWERS = new Set(["func", "var", "let", "subscript", "init", "deinit", "class", "static"]);

export type SwiftFile = {
  imports: string[];
  types: string[];
  declared: Set<string>;
  // Capitalized names used in code, including extended types.
  names: Set<string>;
};

export function readSwiftFile(content: string): SwiftFile {
  const tokens = tokenize(content, SWIFT_SYNTAX);
  const file: SwiftFile = { imports: [], types: [], declared: new Set(), names: new Set() };
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPunct(token, "{")) depth++;
    if (isPunct(token, "}")) depth = Math.max(0, depth - 1);
    if (!isWord(token) || isPunct(tokens[i - 1], ".")) continue;

    if (token.text === "import") {
      // import Module, import struct Module.Type
      let next = i + 1;
      if (isWord(tokens[next]) && TYPE_KEYWORDS.has(tokens[next].text)) next++;
      if (isWord(tokens[next])) file.imports.push(tokens[next].text);
      while (isPunct(tokens[next + 1], ".") && isWord(tokens[next + 2])) next += 2;
      i = next;
      continue;
    }

    if (TYPE_KEYWORDS.has(token.text)) {
      const name = tokens[i + 1];
      // `class func` and `class var` are members, not declarations.
      if (!isWord(name) || DECLARATION_FOLLOWERS.has(name.text) || TYPE_KEYWORDS.has(name.text)) continue;
      file.declared.add(name.text);
      if (depth === 0) file.types.push(name.text);
      i++;
      continue;
    }

    if (/^[A-Z]/.test(token.text)) file.names.add(token.text);
  }
  return file;
}

// The module a file compiles into: a Swift package target (Sources/Name or
// Tests/Name next to a Package.swift), or else one module for all other Swift
// files of the repository, like a single app target.
function moduleOf(path: string, packageDirectories: string[]): { key: string; name: string | null } {
  for (const directory of packageDirectories) {
    const prefix = directory === "" ? "" : `${directory}/`;
    const match = /^(Sources|Tests)\/([^/]+)\//.exec(path.startsWith(prefix) ? path.slice(prefix.length) : "");
    if (match !== null) return { key: `${prefix}${match[1]}/${match[2]}`, name: match[2] };
  }
  return { key: "", name: null };
}

// Swift: `import Module` is module-level and never an edge by itself; files of
// one module see each other's types without any import. Type names used in
// code (including `extension Type`) become references when exactly one file
// of the file's own module, or of a package target it imports, declares a
// top-level type of that name. Nested types and types declared in several
// files are skipped.
export const analyzeSwift: LanguageAnalyzer = (files, repository: RepositoryContext) => {
  const { parsed, failed } = readEach(files, (file) => readSwiftFile(file.content));
  const packageDirectories = [...repository.sourcePaths]
    .filter((path) => path === "Package.swift" || path.endsWith("/Package.swift"))
    .map((path) => path.slice(0, -"Package.swift".length).replace(/\/$/, ""))
    .sort((a, b) => b.length - a.length);

  const index = new DeclarationIndex("::");
  const targets = new Map<string, Set<string>>();
  for (const { file, value } of parsed) {
    const target = moduleOf(file.path, packageDirectories);
    for (const type of value.types) index.add(target.key, type, file.path);
    if (target.name !== null) {
      targets.set(target.name, new Set([...(targets.get(target.name) ?? []), target.key]));
    }
  }

  const references = new Map<string, FileReference[]>();
  for (const { file, value } of parsed) {
    const found: FileReference[] = [];
    const own = moduleOf(file.path, packageDirectories).key;
    const imported = value.imports.flatMap((name) => {
      const keys = targets.get(name);
      return keys !== undefined && keys.size === 1 ? [...keys] : [];
    });
    for (const name of value.names) {
      if (value.declared.has(name)) continue;
      for (const level of [[own], imported]) {
        const target = index.inNamespaces(name, level);
        if (target === null) continue;
        if (target !== "ambiguous") found.push({ specifier: name, kind: "reference", resolution: resolved(target) });
        break;
      }
    }
    references.set(file.path, found);
  }
  return { references, failed };
};
