import type { FileReference, LanguageAnalyzer } from "../analyzer.ts";
import { EXTERNAL, readEach, resolved, unresolved } from "../analyzer.ts";
import type { ReferenceKind } from "../kinds.ts";
import {
  isPunct,
  isWord,
  readCharLiteral,
  readQualifiedName,
  tokenize,
  type CustomReader,
  type LexerSyntax,
  type Token,
} from "../lexer.ts";
import { DeclarationIndex } from "./declarations.ts";

// Java, Kotlin and Scala share one analyzer and one index, since they share a
// classpath: a package declaration, imports of packages and types, and type
// declarations, read with each file's own syntax. Their files are indexed by fully
// qualified type name, which turns imports into file references. Types used
// without an import (same package, or through a wildcard import) are
// resolved too, but only when exactly one type of that name is in scope and
// the name is not declared in the file itself; wildcard imports never add
// edges on their own.

type Import = { parts: string[]; wildcard: boolean; alias: string | null; member: boolean };

export type JvmFile = {
  packageName: string[];
  // Scala: `package a; package b` also makes a's members visible.
  enclosingPackages: string[][];
  imports: Import[];
  // Top-level declarations: types, and for Kotlin also functions and properties.
  topLevel: string[];
  // Every type name declared in the file, at any depth.
  declared: Set<string>;
  // Capitalized names used in code, and dotted names starting with a
  // lower-case package segment.
  names: Set<string>;
  qualified: string[][];
};

type Dialect = {
  syntax: LexerSyntax;
  typeKeywords: ReadonlySet<string>;
  // Kotlin top-level functions and properties can be imported by name.
  memberKeywords?: ReadonlySet<string>;
  // Scala imports are relative to the enclosing packages.
  relativeImports?: boolean;
  readImport(tokens: Token[], index: number): { imports: Import[]; next: number };
};

export function readJvmFile(content: string, dialect: Dialect): JvmFile {
  const tokens = tokenize(content, dialect.syntax);
  const file: JvmFile = {
    packageName: [],
    enclosingPackages: [],
    imports: [],
    topLevel: [],
    declared: new Set(),
    names: new Set(),
    qualified: [],
  };
  const skip = new Set<number>();
  let depth = 0;
  let parentheses = 0;
  // Brace depth of the innermost `package x { ... }` block (Scala).
  let packageDepth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPunct(token, "{")) depth++;
    if (isPunct(token, "}")) depth = Math.max(0, depth - 1);
    if (isPunct(token, "(")) parentheses++;
    if (isPunct(token, ")")) parentheses = Math.max(0, parentheses - 1);
    if (!isWord(token) || skip.has(i)) continue;
    const previous = tokens[i - 1];
    // Member access: a.b, Foo::class. A single ":" introduces a type.
    const afterAccess = isPunct(previous, ".") || (isPunct(previous, ":") && isPunct(tokens[i - 2], ":"));

    if (token.text === "package" && !afterAccess && depth === packageDepth) {
      const name = readQualifiedName(tokens, i + 1);
      if (name === null) continue;
      for (let j = i; j < name.next; j++) skip.add(j);
      if (file.packageName.length > 0) file.enclosingPackages.push(file.packageName);
      file.packageName = [...file.packageName, ...name.parts];
      if (isPunct(tokens[name.next], "{")) packageDepth = depth + 1;
      continue;
    }

    if (token.text === "import" && !afterAccess) {
      const { imports, next } = dialect.readImport(tokens, i + 1);
      for (let j = i; j < next; j++) skip.add(j);
      file.imports.push(...imports);
      continue;
    }

    if (dialect.typeKeywords.has(token.text) && !afterAccess) {
      const name = tokens[i + 1];
      if (isWord(name) && !dialect.typeKeywords.has(name.text)) {
        file.declared.add(name.text);
        if (depth === packageDepth) file.topLevel.push(name.text);
        skip.add(i + 1);
      }
      continue;
    }

    if (
      dialect.memberKeywords?.has(token.text) &&
      !afterAccess &&
      depth === packageDepth &&
      parentheses === 0 &&
      !dialect.typeKeywords.has(tokens[i + 1]?.text ?? "")
    ) {
      // fun <T> Receiver.name(...) and val name: Type
      let j = i + 1;
      if (isPunct(tokens[j], "<")) {
        let angle = 0;
        do {
          if (isPunct(tokens[j], "<")) angle++;
          if (isPunct(tokens[j], ">")) angle--;
          j++;
        } while (j < tokens.length && angle > 0);
      }
      const name = readQualifiedName(tokens, j);
      if (name !== null) file.topLevel.push(name.parts.at(-1)!);
      continue;
    }

    // Scala symbol literals, 'name.
    if (afterAccess || isPunct(previous, "'")) continue;
    const chain = readQualifiedName(tokens, i);
    if (chain !== null && chain.parts.length > 1 && /^[a-z]/.test(chain.parts[0])) {
      file.qualified.push(chain.parts);
      for (let j = i; j < chain.next; j++) skip.add(j);
      continue;
    }
    if (/^[A-Z]/.test(token.text)) file.names.add(token.text);
  }
  return file;
}

// import a.b.C / a.b.* / static a.b.C.m (Java, Kotlin with `as` aliases).
export function readSimpleImport(tokens: Token[], index: number): { imports: Import[]; next: number } {
  let i = index;
  const isStatic = isWord(tokens[i], "static");
  if (isStatic) i++;
  const name = readQualifiedName(tokens, i);
  if (name === null) return { imports: [], next: i };
  let next = name.next;
  let wildcard = false;
  if (isPunct(tokens[next], ".") && isPunct(tokens[next + 1], "*")) {
    wildcard = true;
    next += 2;
  }
  let alias: string | null = null;
  if (isWord(tokens[next], "as") && isWord(tokens[next + 1])) {
    alias = tokens[next + 1].text;
    next += 2;
  }
  return { imports: [{ parts: name.parts, wildcard, alias, member: isStatic }], next };
}

// Scala: import a.b.C, a.b._, a.b.*, a.b.{C, D => E, F as G, _}, several
// clauses separated by commas.
export function readScalaImport(tokens: Token[], index: number): { imports: Import[]; next: number } {
  const imports: Import[] = [];
  let i = index;
  while (true) {
    const name = readQualifiedName(tokens, i);
    if (name === null) break;
    i = name.next;
    // "_" is a word character, so a._ reads as a name ending in "_".
    if (name.parts.at(-1) === "_" && name.parts.length > 1) {
      imports.push({ parts: name.parts.slice(0, -1), wildcard: true, alias: null, member: false });
      if (!isPunct(tokens[i], ",")) break;
      i++;
      continue;
    }
    const isSelector = isPunct(tokens[i], ".");
    if (isSelector && (isPunct(tokens[i + 1], "*") || isWord(tokens[i + 1], "_"))) {
      imports.push({ parts: name.parts, wildcard: true, alias: null, member: false });
      i += 2;
    } else if (isSelector && isPunct(tokens[i + 1], "{")) {
      i += 2;
      while (i < tokens.length && !isPunct(tokens[i], "}")) {
        const selector = tokens[i];
        if (isPunct(selector, "*") || isWord(selector, "_")) {
          imports.push({ parts: name.parts, wildcard: true, alias: null, member: false });
        } else if (isWord(selector) && selector.text !== "given") {
          let alias: string | null = null;
          let j = i + 1;
          if (isPunct(tokens[j], "=") && isPunct(tokens[j + 1], ">")) j += 2;
          else if (isWord(tokens[j], "as")) j += 1;
          else j = -1;
          if (j !== -1 && isWord(tokens[j])) {
            alias = tokens[j].text;
            i = j;
          }
          if (alias !== "_") imports.push({ parts: [...name.parts, selector.text], wildcard: false, alias, member: false });
        }
        i++;
      }
      i++;
    } else {
      let alias: string | null = null;
      if (isWord(tokens[i], "as") && isWord(tokens[i + 1])) {
        alias = tokens[i + 1].text;
        i += 2;
      }
      imports.push({ parts: name.parts, wildcard: false, alias, member: false });
    }
    if (!isPunct(tokens[i], ",")) break;
    i++;
  }
  return { imports, next: i };
}

export const analyzeJvm: LanguageAnalyzer = (files) => {
  const { parsed, failed } = readEach(files, (file) => {
    const dialect = DIALECTS[file.language as JvmLanguage];
    return { dialect, ...readJvmFile(file.content, dialect) };
  });
  const index = new DeclarationIndex(".");
  for (const { file, value } of parsed) {
    for (const name of value.topLevel) index.add(value.packageName.join("."), name, file.path);
  }

  const lookupImport = (dialect: Dialect, parts: string[], packages: string[][]) => {
    const bases = dialect.relativeImports ? [...packages, []] : [[]];
    for (const base of bases) {
      const found = index.lookup([...base, ...parts]);
      if (found !== null) return found;
    }
    return null;
  };

  const references = new Map<string, FileReference[]>();
  for (const { file, value } of parsed) {
    const found: FileReference[] = [];
    const add = (specifier: string, kind: ReferenceKind, resolution: FileReference["resolution"]) =>
      found.push({ specifier, kind, resolution });
    const ownPackage = value.packageName.join(".");
    // Innermost first: the file's package, then Scala's enclosing ones.
    const packages = [value.packageName, ...[...value.enclosingPackages].reverse()].filter((p) => p.length > 0);
    const imported = new Set<string>();
    const wildcardPackages: string[] = [];

    for (const entry of value.imports) {
      const specifier = entry.parts.join(".") + (entry.wildcard ? ".*" : "");
      const target = lookupImport(value.dialect, entry.parts, packages);
      if (entry.wildcard) {
        // A wildcard over a type imports its members: one file. Over a
        // package it only widens the scope for names used below.
        if (target !== null && index.files(entry.parts.join(".")) !== undefined) add(specifier, "import", target);
        else wildcardPackages.push(entry.parts.join("."));
        continue;
      }
      imported.add(entry.alias ?? entry.parts.at(-1)!);
      if (target !== null) {
        add(specifier, "import", target);
      } else if (/^[a-z]/.test(entry.parts.at(-1)!) && !entry.member) {
        // A package, or a member imported by name that is not indexed.
        add(specifier, "import", unresolved("unsupported_resolution"));
      } else {
        const knownPrefix = entry.parts.some((_, i) => i > 0 && index.hasNamespace(entry.parts.slice(0, i).join(".")));
        add(specifier, "import", knownPrefix ? unresolved("not_found") : EXTERNAL);
      }
    }

    for (const name of value.names) {
      if (value.declared.has(name) || imported.has(name)) continue;
      // Java and Kotlin: the file's own package wins over wildcard imports.
      const scopes = [[ownPackage, ...packages.slice(1).map((p) => p.join("."))], wildcardPackages];
      // Scala: the scopes of enclosing package clauses are searched too.
      for (const scope of scopes) {
        const target = index.inNamespaces(name, scope);
        if (target === null) continue;
        if (target !== "ambiguous") add(name, "reference", resolved(target));
        break;
      }
    }

    for (const parts of value.qualified) {
      const target = index.lookup(parts);
      if (target !== null && target.status === "resolved") add(parts.join("."), "reference", target);
    }
    references.set(file.path, found);
  }
  return { references, failed };
};

const JAVA_SYNTAX: LexerSyntax = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/" }],
  quotes: [
    { open: '"""', close: '"""', escapes: true, multiline: true },
    { open: '"', close: '"', escapes: true },
    { open: "'", close: "'", escapes: true },
  ],
};

const KOTLIN_SYNTAX: LexerSyntax = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/", nested: true }],
  quotes: [
    { open: '"""', close: '"""', multiline: true, interpolation: ["$"] },
    { open: '"', close: '"', escapes: true, interpolation: ["$"] },
    { open: "'", close: "'", escapes: true },
    // `backtick names` are identifiers, but may contain spaces and keywords.
    { open: "`", close: "`" },
  ],
};

// s"...", f"...", raw"..." and their triple-quoted forms.
const readInterpolatedString: CustomReader = (source, index) => {
  const match = /^[a-z]\w*("""|")/.exec(source.slice(index, index + 24));
  if (match === null || (index > 0 && /\w/.test(source[index - 1]))) return null;
  const close = source.indexOf(match[1], index + match[0].length);
  if (match[1] === '"') {
    let i = index + match[0].length;
    while (i < source.length && source[i] !== '"' && source[i] !== "\n") i += source[i] === "\\" ? 2 : 1;
    return { end: Math.min(i + 1, source.length), value: "", dynamic: true };
  }
  return { end: close === -1 ? source.length : close + 3, value: "", dynamic: true };
};

const SCALA_SYNTAX: LexerSyntax = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/", nested: true }],
  custom: [readInterpolatedString, readCharLiteral],
  quotes: [
    { open: '"""', close: '"""', multiline: true },
    { open: '"', close: '"', escapes: true },
    { open: "`", close: "`" },
  ],
};

export const JAVA: Dialect = {
  syntax: JAVA_SYNTAX,
  typeKeywords: new Set(["class", "interface", "enum", "record"]),
  readImport: readSimpleImport,
};

export const KOTLIN: Dialect = {
  syntax: KOTLIN_SYNTAX,
  typeKeywords: new Set(["class", "interface", "object", "typealias"]),
  memberKeywords: new Set(["fun", "val", "var"]),
  readImport: readSimpleImport,
};

export const SCALA: Dialect = {
  syntax: SCALA_SYNTAX,
  typeKeywords: new Set(["class", "trait", "object", "enum"]),
  relativeImports: true,
  readImport: readScalaImport,
};

type JvmLanguage = "java" | "kotlin" | "scala";

const DIALECTS: Record<JvmLanguage, Dialect> = { java: JAVA, kotlin: KOTLIN, scala: SCALA };
