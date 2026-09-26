import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { configFilesNamed, EXTERNAL, readEach, resolved, unresolved } from "../analyzer.ts";
import { isPunct, isWord, tokenize, type Token } from "../lexer.ts";
import { compareStrings, directoryOf, joinRepositoryPath } from "../paths.ts";

const GO_SYNTAX = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/" }],
  quotes: [
    { open: "`", close: "`", multiline: true },
    { open: '"', close: '"', escapes: true },
    { open: "'", close: "'", escapes: true },
  ],
} as const;

type GoFile = { packageName: string | null; imports: Token[] };

// The package clause, and import paths from `import "x"`, `import name "x"`
// and grouped `import ( ... )` declarations.
export function readGoFile(content: string): GoFile {
  const tokens = tokenize(content, GO_SYNTAX);
  const imports: Token[] = [];
  let packageName: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    if (packageName === null && isWord(tokens[i], "package") && isWord(tokens[i + 1])) {
      packageName = tokens[i + 1].text;
      continue;
    }
    if (!isWord(tokens[i], "import") || isPunct(tokens[i - 1], ".")) continue;
    if (isPunct(tokens[i + 1], "(")) {
      let j = i + 2;
      while (j < tokens.length && !isPunct(tokens[j], ")")) {
        if (tokens[j].type === "string") imports.push(tokens[j]);
        j++;
      }
      i = j;
    } else {
      const next = isWord(tokens[i + 1]) || isPunct(tokens[i + 1], ".") ? tokens[i + 2] : tokens[i + 1];
      if (next?.type === "string") imports.push(next);
    }
  }
  return { packageName, imports };
}

type GoModule = { path: string; directory: string };

function readModules(repository: RepositoryContext): GoModule[] {
  const modules: GoModule[] = [];
  for (const file of configFilesNamed(repository, (name) => name === "go.mod")) {
    const match = /^module[ \t]+"?([^\s"/][^\s"]*)"?[ \t]*(\/\/.*)?$/m.exec(file.content);
    if (match !== null) modules.push({ path: match[1], directory: directoryOf(file.path) });
  }
  // Longest module path first, so a nested module wins over its parent.
  return modules.sort((a, b) => b.path.length - a.path.length);
}

// Go imports packages, not files. An import of a package in this repository
// becomes one edge to a representative file of that package: the file named
// after the package (cobra.go for `package cobra`), else the one named after
// the directory (store/store.go), otherwise the first non-test file by path.
// Edges to every file in the package would claim dependencies on files that
// may not be used at all.
export function representativeFile(files: string[], directory: string, packageName: string | null = null): string | null {
  const candidates = files.filter((path) => !path.endsWith("_test.go")).sort(compareStrings);
  if (candidates.length === 0) return null;
  const named = (name: string | null) =>
    name === null || name === "" ? undefined : candidates.find((path) => path.slice(path.lastIndexOf("/") + 1) === `${name}.go`);
  return named(packageName) ?? named(directory.slice(directory.lastIndexOf("/") + 1)) ?? candidates[0];
}

// Go: import paths are mapped to directories through the module path in each
// go.mod; the standard library and other modules are external.
export const analyzeGo: LanguageAnalyzer = (files, repository) => {
  const modules = readModules(repository);
  const { parsed, failed } = readEach(files, (file) => readGoFile(file.content));
  const byDirectory = new Map<string, string[]>();
  // The package name most non-test files of a directory declare.
  const packageNames = new Map<string, Map<string, number>>();
  for (const { file, value } of parsed) {
    const directory = directoryOf(file.path);
    byDirectory.set(directory, [...(byDirectory.get(directory) ?? []), file.path]);
    if (value.packageName !== null && !file.path.endsWith("_test.go")) {
      const counts = packageNames.get(directory) ?? new Map<string, number>();
      counts.set(value.packageName, (counts.get(value.packageName) ?? 0) + 1);
      packageNames.set(directory, counts);
    }
  }
  const packageOf = (directory: string): string | null => {
    const counts = [...(packageNames.get(directory) ?? [])].sort((a, b) => b[1] - a[1] || compareStrings(a[0], b[0]));
    return counts[0]?.[0] ?? null;
  };

  const resolvePackage = (directory: string): FileReference["resolution"] => {
    const representative = representativeFile(byDirectory.get(directory) ?? [], directory, packageOf(directory));
    return representative === null ? unresolved("not_found") : resolved(representative);
  };

  const resolve = (spec: Token, fromPath: string): FileReference["resolution"] => {
    const path = spec.text;
    if (path.startsWith("./") || path.startsWith("../")) {
      const directory = joinRepositoryPath(directoryOf(fromPath), path);
      return directory === null ? unresolved("outside_repository") : resolvePackage(directory);
    }
    const owner = modules.find((m) => path === m.path || path.startsWith(`${m.path}/`));
    if (owner === undefined) return EXTERNAL;
    const directory = joinRepositoryPath(owner.directory, path.slice(owner.path.length + 1));
    return directory === null ? unresolved("outside_repository") : resolvePackage(directory);
  };

  const references = new Map<string, FileReference[]>(
    parsed.map(({ file, value }) => [
      file.path,
      value.imports.map((spec) => ({ specifier: spec.text, kind: "import" as const, resolution: resolve(spec, file.path) })),
    ]),
  );
  return { references, failed };
};
