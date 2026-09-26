import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { EXTERNAL, pickCandidate, readEach, unresolved } from "../analyzer.ts";
import { isPunct, isWord, logicalLines, tokenize, type CustomReader, type Token } from "../lexer.ts";
import { directoryOf } from "../paths.ts";

// String literals with any prefix (r, b, u, f and combinations), single or
// triple quoted. Only their extent matters here: imports never use strings.
const readPythonString: CustomReader = (source, index) => {
  let cursor = index;
  let formatted = false;
  while (cursor - index < 2 && /[rRbBuUfF]/.test(source[cursor] ?? "")) {
    formatted ||= source[cursor] === "f" || source[cursor] === "F";
    cursor++;
  }
  const quote = source[cursor];
  if (quote !== "'" && quote !== '"') return null;
  if (cursor > index && index > 0 && /[\w\u0080-￿]/.test(source[index - 1])) return null;

  const triple = source.startsWith(quote.repeat(3), cursor);
  const close = triple ? quote.repeat(3) : quote;
  let i = cursor + close.length;
  while (i < source.length) {
    if (source.startsWith(close, i)) return { end: i + close.length, value: "", dynamic: formatted };
    if (source[i] === "\n" && !triple) return { end: i, value: "", dynamic: formatted };
    // Even in raw strings a backslash keeps the next quote from closing it.
    i += source[i] === "\\" ? 2 : 1;
  }
  return { end: source.length, value: "", dynamic: formatted };
};

export const PYTHON_SYNTAX = { lineComments: ["#"], custom: [readPythonString], newlines: true } as const;

type ImportStatement =
  // import a.b.c
  | { type: "import"; module: string[] }
  // from ..a.b import x, y
  | { type: "from"; level: number; module: string[]; names: string[] };

export function readPythonImports(content: string): ImportStatement[] {
  const statements: ImportStatement[] = [];
  for (const line of logicalLines(tokenize(content, PYTHON_SYNTAX))) {
    for (const statement of splitStatements(line)) {
      const parsed = parseStatement(statement);
      if (parsed !== null) statements.push(...parsed);
    }
  }
  return statements;
}

function splitStatements(line: Token[]): Token[][] {
  const statements: Token[][] = [[]];
  for (const token of line) {
    if (isPunct(token, ";")) statements.push([]);
    else statements.at(-1)!.push(token);
  }
  return statements.filter((statement) => statement.length > 0);
}

function parseStatement(tokens: Token[]): ImportStatement[] | null {
  if (isWord(tokens[0], "import")) {
    return splitOnCommas(tokens.slice(1)).flatMap((part) => {
      const name = dottedName(part, 0);
      return name === null ? [] : [{ type: "import" as const, module: name.parts }];
    });
  }
  if (!isWord(tokens[0], "from")) return null;

  let index = 1;
  let level = 0;
  while (isPunct(tokens[index], ".")) {
    level++;
    index++;
  }
  let moduleName: string[] = [];
  if (!isWord(tokens[index], "import")) {
    const name = dottedName(tokens, index);
    if (name === null) return null;
    moduleName = name.parts;
    index = name.next;
  }
  if (!isWord(tokens[index], "import")) return null;
  if (level === 0 && moduleName.length === 0) return null;

  const rest = tokens.slice(index + 1).filter((token) => !isPunct(token, "(") && !isPunct(token, ")"));
  const names = splitOnCommas(rest).flatMap((part) =>
    isPunct(part[0], "*") ? ["*"] : isWord(part[0]) ? [part[0].text] : [],
  );
  return [{ type: "from", level, module: moduleName, names }];
}

function dottedName(tokens: Token[], index: number): { parts: string[]; next: number } | null {
  if (!isWord(tokens[index])) return null;
  const parts = [tokens[index].text];
  let next = index + 1;
  while (isPunct(tokens[next], ".") && isWord(tokens[next + 1])) {
    parts.push(tokens[next + 1].text);
    next += 2;
  }
  return { parts, next };
}

function splitOnCommas(tokens: Token[]): Token[][] {
  const parts: Token[][] = [[]];
  for (const token of tokens) {
    if (isPunct(token, ",")) parts.push([]);
    else parts.at(-1)!.push(token);
  }
  return parts.filter((part) => part.length > 0);
}

// Module files for `parts` under `directory`: a module file or a package's
// __init__.py. With no parts, the package in `directory` itself.
function moduleCandidates(directory: string, parts: string[]): string[] {
  const base = [directory, ...parts].filter((segment) => segment !== "").join("/");
  if (parts.length === 0) return [joinPath(base, "__init__.py")];
  return [`${base}.py`, joinPath(base, "__init__.py")];
}

function joinPath(directory: string, name: string): string {
  return directory === "" ? name : `${directory}/${name}`;
}

type PythonIndex = {
  roots: string[];
  // Every directory that contains Python source, directly or below.
  directories: Set<string>;
};

// Absolute imports are looked up from import roots: the repository root, any
// "src" directory, and the directory above each top-level package (the first
// ancestor without __init__.py). The importing file's own directory is added
// per file, as Python puts a script's directory on sys.path. A name found under
// more than one root is ambiguous and skipped.
function buildIndex(paths: string[]): PythonIndex {
  const sources = new Set(paths);
  const roots = new Set<string>([""]);
  const directories = new Set<string>();

  for (const path of paths) {
    let directory = directoryOf(path);
    while (true) {
      directories.add(directory);
      if (directory === "") break;
      directory = directoryOf(directory);
    }
    const segments = path.split("/");
    const srcIndex = segments.lastIndexOf("src", segments.length - 2);
    if (srcIndex !== -1) roots.add(segments.slice(0, srcIndex + 1).join("/"));

    if (path.endsWith("/__init__.py")) {
      let top = directoryOf(path);
      while (top !== "" && sources.has(joinPath(directoryOf(top), "__init__.py"))) top = directoryOf(top);
      if (top !== "") roots.add(directoryOf(top));
    }
  }
  return { roots: [...roots].sort(), directories };
}

function resolveAbsolute(
  parts: string[],
  fromPath: string,
  index: PythonIndex,
  repository: RepositoryContext,
): FileReference["resolution"] {
  const roots = new Set([...index.roots, directoryOf(fromPath)]);
  const candidates = [...roots].flatMap((root) => moduleCandidates(root, parts));
  const local = [...roots].some((root) => {
    const top = joinPath(root, parts[0]);
    return repository.sourcePaths.has(`${top}.py`) || index.directories.has(top);
  });
  return pickCandidate(candidates, repository, local ? unresolved("not_found") : EXTERNAL);
}

// Python: `import a.b` and `from a.b import c`, absolute and relative.
// `from package import name` points at the submodule `name` when the package
// has one, and otherwise at the package's __init__.py, which is the file the
// name is read from. Nothing is executed and sys.path is not evaluated.
export const analyzePython: LanguageAnalyzer = (files, repository) => {
  const index = buildIndex(files.map((file) => file.path));
  const { parsed, failed } = readEach(files, (file) => readPythonImports(file.content));
  const references = new Map<string, FileReference[]>();

  for (const { file, value: statements } of parsed) {
    const found: FileReference[] = [];
    for (const statement of statements) {
      if (statement.type === "import") {
        found.push({
          specifier: statement.module.join("."),
          kind: "import",
          resolution: resolveAbsolute(statement.module, file.path, index, repository),
        });
        continue;
      }

      const specifier = ".".repeat(statement.level) + statement.module.join(".");
      let base: string | null = null;
      let moduleResolution: FileReference["resolution"];
      if (statement.level > 0) {
        base = directoryOf(file.path);
        for (let i = 1; i < statement.level && base !== null; i++) base = base === "" ? null : directoryOf(base);
        if (base === null) {
          found.push({ specifier, kind: "import", resolution: unresolved("outside_repository") });
          continue;
        }
        moduleResolution = pickCandidate(moduleCandidates(base, statement.module), repository);
      } else {
        moduleResolution = resolveAbsolute(statement.module, file.path, index, repository);
      }

      // The package directory the imported names could be submodules of,
      // including namespace packages without __init__.py.
      let packageDirectory: string | null = null;
      if (moduleResolution.status === "resolved") {
        if (moduleResolution.path.endsWith("__init__.py")) packageDirectory = directoryOf(moduleResolution.path);
      } else if (base !== null) {
        packageDirectory = [base, ...statement.module].filter((segment) => segment !== "").join("/");
      } else {
        const directories = [...new Set([...index.roots, directoryOf(file.path)])]
          .map((root) => [root, ...statement.module].filter((segment) => segment !== "").join("/"))
          .filter((directory) => index.directories.has(directory));
        if (directories.length === 1) packageDirectory = directories[0];
      }

      let usedModule = false;
      for (const name of statement.names) {
        if (name !== "*" && packageDirectory !== null) {
          const submodule = pickCandidate(moduleCandidates(packageDirectory, [name]), repository, EXTERNAL);
          if (submodule.status === "resolved" || (submodule.status === "unresolved" && submodule.reason === "ambiguous")) {
            found.push({ specifier: `${specifier}${specifier.endsWith(".") ? "" : "."}${name}`, kind: "import", resolution: submodule });
            continue;
          }
        }
        usedModule = true;
      }
      if (usedModule || statement.names.length === 0) {
        found.push({ specifier, kind: "import", resolution: moduleResolution });
      }
    }
    references.set(file.path, found);
  }
  return { references, failed };
};
