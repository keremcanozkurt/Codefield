import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { EXTERNAL, pickCandidate, readEach, unresolved } from "../analyzer.ts";
import { isPunct, isWord, tokenize, type CustomReader } from "../lexer.ts";
import { directoryOf, joinRepositoryPath } from "../paths.ts";

// C++ raw strings, R"delimiter(...)delimiter", with an optional encoding
// prefix. Their contents may hold anything, including "#include".
const readRawString: CustomReader = (source, index) => {
  const match = /^(?:u8|u|U|L)?R"([^()\\\s"]{0,16})\(/.exec(source.slice(index, index + 24));
  if (match === null || (index > 0 && /\w/.test(source[index - 1]))) return null;
  const close = source.indexOf(`)${match[1]}"`, index + match[0].length);
  return { end: close === -1 ? source.length : close + match[1].length + 2, value: "", dynamic: false };
};

const C_SYNTAX = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/" }],
  custom: [readRawString],
  quotes: [
    { open: '"', close: '"', escapes: true },
    { open: "'", close: "'", escapes: true },
  ],
  newlines: true,
} as const;

type Include = { path: string; angle: boolean };

// #include "x" and #include <x> directives, which the preprocessor only
// recognizes as the first thing on a line. Macros are not expanded, so an
// #include of a macro name is ignored.
export function readIncludes(content: string): Include[] {
  const tokens = tokenize(content, C_SYNTAX);
  const includes: Include[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isPunct(tokens[i], "#") || (i > 0 && tokens[i - 1].type !== "newline")) continue;
    const directive = tokens[i + 1];
    if (!isWord(directive) || (directive.text !== "include" && directive.text !== "import")) continue;
    const target = tokens[i + 2];
    if (target?.type === "string" && target.line === directive.line) {
      includes.push({ path: target.text, angle: false });
    } else if (isPunct(target, "<") && target.line === directive.line) {
      const close = content.indexOf(">", target.end);
      const newline = content.indexOf("\n", target.end);
      if (close !== -1 && (newline === -1 || close < newline)) {
        includes.push({ path: content.slice(target.end, close).trim(), angle: true });
      }
    }
  }
  return includes;
}

type IncludeIndex = {
  // The repository root and every directory named "include" or "inc".
  roots: string[];
  byName: Map<string, string[]>;
};

function buildIndex(repository: RepositoryContext): IncludeIndex {
  const roots = new Set<string>([""]);
  const byName = new Map<string, string[]>();
  for (const path of repository.sourcePaths) {
    const segments = path.split("/");
    segments.slice(0, -1).forEach((segment, i) => {
      if (segment === "include" || segment === "inc") roots.add(segments.slice(0, i + 1).join("/"));
    });
    const name = segments.at(-1)!;
    const list = byName.get(name) ?? [];
    list.push(path);
    byName.set(name, list);
  }
  return { roots: [...roots], byName };
}

// Quoted includes are looked up next to the including file, then under the
// repository root and "include"/"inc" directories, then as a unique path
// suffix anywhere in the repository. Angle-bracket includes skip the first
// step and only use the suffix match for paths with a directory, like
// <mylib/config.h>; <stdio.h> and other bare names are system headers unless
// an include directory has them. Real builds choose include paths with -I
// flags, which are not visible here, so several matches are left unresolved.
function resolveInclude(
  include: Include,
  fromPath: string,
  index: IncludeIndex,
  repository: RepositoryContext,
): FileReference["resolution"] {
  if (include.path === "" || include.path.startsWith("/")) return EXTERNAL;

  if (!include.angle) {
    const local = joinRepositoryPath(directoryOf(fromPath), include.path);
    if (local !== null && repository.sourcePaths.has(local)) return { status: "resolved", path: local };
    if (local !== null && repository.repositoryPaths?.has(local)) return unresolved("not_source");
  }

  const fromRoots = pickCandidate(
    index.roots.flatMap((root) => {
      const path = joinRepositoryPath(root, include.path);
      return path === null ? [] : [path];
    }),
    repository,
    EXTERNAL,
  );
  if (fromRoots.status !== "external") return fromRoots;

  if (!include.angle || include.path.includes("/")) {
    const normalized = joinRepositoryPath("", include.path);
    if (normalized !== null) {
      const name = normalized.slice(normalized.lastIndexOf("/") + 1);
      const matches = (index.byName.get(name) ?? []).filter(
        (path) => path === normalized || path.endsWith(`/${normalized}`),
      );
      if (matches.length > 0) return pickCandidate(matches, repository);
    }
  }
  return include.angle ? EXTERNAL : unresolved("not_found");
}

// C and C++ share one analyzer, so a .cpp file including a .h header is an
// ordinary edge.
export const analyzeCFamily: LanguageAnalyzer = (files, repository) => {
  const index = buildIndex(repository);
  const { parsed, failed } = readEach(files, (file) => readIncludes(file.content));
  const references = new Map<string, FileReference[]>(
    parsed.map(({ file, value }) => [
      file.path,
      value.map((include) => ({
        specifier: include.angle ? `<${include.path}>` : include.path,
        kind: "include" as const,
        resolution: resolveInclude(include, file.path, index, repository),
      })),
    ]),
  );
  return { references, failed };
};
