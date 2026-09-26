import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { EXTERNAL, pickCandidate, readEach, unresolved } from "../analyzer.ts";
import { isPunct, isWord, tokenize, type CustomReader, type Token } from "../lexer.ts";

// Long brackets: [[...]], [==[...]==], and the comments --[[...]] built on them.
function longBracketEnd(source: string, index: number): number | null {
  const match = /^\[(=*)\[/.exec(source.slice(index, index + 32));
  if (match === null) return null;
  const close = source.indexOf(`]${match[1]}]`, index + match[0].length);
  return close === -1 ? source.length : close + match[1].length + 2;
}

const readLongComment: CustomReader = (source, index) => {
  if (!source.startsWith("--[", index)) return null;
  const end = longBracketEnd(source, index + 2);
  return end === null ? null : { skip: true, end };
};

const readLongString: CustomReader = (source, index) => {
  if (source[index] !== "[") return null;
  const end = longBracketEnd(source, index);
  if (end === null) return null;
  const open = source.indexOf("[", index + 1) + 1;
  const close = source.lastIndexOf("]", end - 2);
  return { end, value: source.slice(open, close).replace(/^\n/, ""), dynamic: false };
};

const LUA_SYNTAX = {
  lineComments: ["--"],
  custom: [readLongComment, readLongString],
  quotes: [
    { open: '"', close: '"', escapes: true },
    { open: "'", close: "'", escapes: true },
  ],
} as const;

export function readLuaRequires(content: string): Token[] {
  const tokens = tokenize(content, LUA_SYNTAX);
  const modules: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!isWord(tokens[i], "require") || isPunct(tokens[i - 1], ".") || isPunct(tokens[i - 1], ":")) continue;
    const parenthesized = isPunct(tokens[i + 1], "(");
    const argument = parenthesized ? tokens[i + 2] : tokens[i + 1];
    // require("a" .. b) builds the name at runtime.
    if (argument?.type !== "string" || (parenthesized && !isPunct(tokens[i + 3], ")"))) continue;
    modules.push(argument);
  }
  return modules;
}

// Lua: require("a.b") with a literal module name, looked up as a/b.lua or
// a/b/init.lua from the repository root and any lua, src or lib directory.
// package.path is not evaluated, so modules found under more than one of
// these roots are left unresolved.
export const analyzeLua: LanguageAnalyzer = (files, repository) => {
  const roots = new Set<string>([""]);
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.path.split("/");
    segments.slice(0, -1).forEach((segment, i) => {
      directories.add(segments.slice(0, i + 1).join("/"));
      if (segment === "lua" || segment === "src" || segment === "lib") roots.add(segments.slice(0, i + 1).join("/"));
    });
  }

  const resolve = (module: Token): FileReference["resolution"] => {
    if (module.dynamic) return unresolved("unsupported_dynamic");
    const path = module.text.replace(/\./g, "/");
    if (path === "" || path.startsWith("/") || path.split("/").includes("..")) return EXTERNAL;
    const candidates = [...roots].flatMap((root) => {
      const base = root === "" ? path : `${root}/${path}`;
      return [`${base}.lua`, `${base}/init.lua`];
    });
    const first = path.split("/")[0];
    const local = [...roots].some((root) => directories.has(root === "" ? first : `${root}/${first}`));
    return pickCandidate(candidates, repository as RepositoryContext, local ? unresolved("not_found") : EXTERNAL);
  };

  const { parsed, failed } = readEach(files, (file) => readLuaRequires(file.content));
  const references = new Map<string, FileReference[]>(
    parsed.map(({ file, value }) => [
      file.path,
      value.map((module) => ({ specifier: module.text, kind: "require" as const, resolution: resolve(module) })),
    ]),
  );
  return { references, failed };
};
