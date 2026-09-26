import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { EXTERNAL, pickCandidate, readEach, unresolved } from "../analyzer.ts";
import { isPunct, isWord, tokenize, type CustomReader, type Token } from "../lexer.ts";
import { directoryOf, joinRepositoryPath } from "../paths.ts";
import { blankHeredocs } from "./heredoc.ts";

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };

function readDelimited(source: string, start: number, open: string): number {
  const close = PAIRS[open] ?? open;
  let depth = 1;
  let i = start;
  while (i < source.length) {
    const char = source[i];
    if (char === "\\") {
      i += 2;
      continue;
    }
    if (char === close) {
      depth--;
      if (depth === 0) return i + 1;
    } else if (char === open && close !== open) {
      depth++;
    }
    i++;
  }
  return source.length;
}

// =begin ... =end comments, which must start at the beginning of a line.
const readBlockComment: CustomReader = (source, index) => {
  if (!source.startsWith("=begin", index) || (index > 0 && source[index - 1] !== "\n")) return null;
  const end = source.indexOf("\n=end", index);
  if (end === -1) return { skip: true, end: source.length };
  const lineEnd = source.indexOf("\n", end + 1);
  return { skip: true, end: lineEnd === -1 ? source.length : lineEnd };
};

// %q(...), %w[...], %r{...} and bare %(...) literals.
const readPercentLiteral: CustomReader = (source, index, previous) => {
  if (source[index] !== "%") return null;
  let cursor = index + 1;
  const letter = /[qQwWiIrsx]/.test(source[cursor] ?? "");
  if (letter) cursor++;
  const open = source[cursor];
  if (open === undefined || /[\w\s]/.test(open)) return null;
  // Without a letter, "%" after a value is the modulo operator.
  if (!letter && (previous?.type === "word" || isPunct(previous, ")") || isPunct(previous, "]"))) return null;
  const end = readDelimited(source, cursor + 1, open);
  const value = source.slice(cursor + 1, end - 1);
  return { end, value, dynamic: value.includes("#{") };
};

const REGEX_KEYWORDS = new Set(["if", "unless", "when", "and", "or", "not", "return", "then", "elsif", "while", "until"]);

// A regular expression literal, which only starts where a value is expected.
// Elsewhere "/" is division.
const readRegex: CustomReader = (source, index, previous) => {
  if (source[index] !== "/") return null;
  const expectsValue =
    previous === undefined ||
    (previous.type === "punct" && "(,=!&|;{[:?~+-*<>%".includes(previous.text)) ||
    (previous.type === "word" && REGEX_KEYWORDS.has(previous.text));
  if (!expectsValue) return null;
  let i = index + 1;
  let inClass = false;
  while (i < source.length && source[i] !== "\n") {
    const char = source[i];
    if (char === "\\") i += 2;
    else {
      if (char === "[") inClass = true;
      else if (char === "]") inClass = false;
      else if (char === "/" && !inClass) return { skip: true, end: i + 1 };
      i++;
    }
  }
  return null;
};

const RUBY_SYNTAX = {
  lineComments: ["#"],
  custom: [readBlockComment, readPercentLiteral, readRegex],
  quotes: [
    { open: '"', close: '"', escapes: true, multiline: true, interpolation: ["#{"] },
    { open: "'", close: "'", escapes: true, multiline: true },
    { open: "`", close: "`", escapes: true, multiline: true, interpolation: ["#{"] },
  ],
  wordChars: "?!",
  newlines: true,
} as const;

const HEREDOC = /<<[~-]?(?:(['"`])(\w+)\1|([A-Z_][A-Z0-9_]*))/g;

type RubyLoad = { method: "require" | "require_relative" | "autoload"; path: Token };

export function readRubyLoads(content: string): RubyLoad[] {
  const source = blankHeredocs(content, HEREDOC, (line, name) => line.trim() === name, "#");
  const tokens = tokenize(source, RUBY_SYNTAX);
  const loads: RubyLoad[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isWord(token) || isPunct(tokens[i - 1], ".")) continue;
    let next = i + 1;
    if (isPunct(tokens[next], "(")) next++;

    if (token.text === "require" || token.text === "require_relative") {
      const after = tokens[next + 1];
      // require "a" + name builds the path at runtime.
      if (tokens[next]?.type === "string" && !isPunct(after, "+")) loads.push({ method: token.text, path: tokens[next] });
    } else if (token.text === "autoload") {
      // autoload :Name, "path"
      if (isPunct(tokens[next], ":") && isWord(tokens[next + 1]) && isPunct(tokens[next + 2], ",")) {
        const path = tokens[next + 3];
        if (path?.type === "string") loads.push({ method: "autoload", path });
      }
    }
  }
  return loads;
}

function withExtension(path: string): string[] {
  return path.endsWith(".rb") ? [path] : [`${path}.rb`, path];
}

// `require "a/b"` is looked up from the repository root and every "lib"
// directory, the usual load path of a Ruby project or gem. Anything not found
// there is a gem or a standard library and is ignored.
function resolveLoad(
  load: RubyLoad,
  fromPath: string,
  libRoots: string[],
  repository: RepositoryContext,
): FileReference["resolution"] {
  if (load.path.dynamic) return unresolved("unsupported_dynamic");
  const value = load.path.text;
  if (value === "" || value.startsWith("/")) return EXTERNAL;

  if (load.method === "require_relative" || value.startsWith("./") || value.startsWith("../")) {
    const path = joinRepositoryPath(directoryOf(fromPath), value);
    return path === null ? unresolved("outside_repository") : pickCandidate(withExtension(path), repository);
  }
  return pickCandidate(
    libRoots.flatMap((root) => {
      const path = joinRepositoryPath(root, value);
      return path === null ? [] : withExtension(path);
    }),
    repository,
    EXTERNAL,
  );
}

// Ruby: require_relative, and require/autoload of paths that exist under a
// load-path directory of this repository.
export const analyzeRuby: LanguageAnalyzer = (files, repository) => {
  const libRoots = new Set<string>([""]);
  for (const file of files) {
    const segments = file.path.split("/");
    segments.slice(0, -1).forEach((segment, i) => {
      if (segment === "lib") libRoots.add(segments.slice(0, i + 1).join("/"));
    });
  }
  const roots = [...libRoots];
  const { parsed, failed } = readEach(files, (file) => readRubyLoads(file.content));
  const references = new Map<string, FileReference[]>(
    parsed.map(({ file, value }) => [
      file.path,
      value.map((load) => ({
        specifier: load.path.text,
        kind: "require" as const,
        resolution: resolveLoad(load, file.path, roots, repository),
      })),
    ]),
  );
  return { references, failed };
};
