import type { FileReference, LanguageAnalyzer } from "../analyzer.ts";
import { readEach, resolved, unresolved } from "../analyzer.ts";
import type { ReferenceKind } from "../kinds.ts";
import { isPunct, isWord, tokenize, type CustomReader, type Token } from "../lexer.ts";
import { DeclarationIndex } from "./declarations.ts";

const SIGIL_PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<": ">" };

// ~r/.../, ~s(...), ~w[...], ~S"""...""" and other sigils.
const readSigil: CustomReader = (source, index) => {
  if (source[index] !== "~") return null;
  const match = /^~[a-zA-Z][A-Z0-9]*("""|'''|[/|"'([{<])/.exec(source.slice(index, index + 16));
  if (match === null) return null;
  const open = match[1];
  const close = open.length === 3 ? open : (SIGIL_PAIRS[open] ?? open);
  let i = index + match[0].length;
  while (i < source.length && !source.startsWith(close, i)) i += source[i] === "\\" ? 2 : 1;
  return { end: Math.min(i + close.length, source.length), value: "", dynamic: true };
};

// Character literals such as ?a, ?" and ?\n.
const readCharacter: CustomReader = (source, index, previous) => {
  if (source[index] !== "?" || previous?.type === "word" || /\s/.test(source[index + 1] ?? " ")) return null;
  return { end: index + (source[index + 1] === "\\" ? 3 : 2), value: "", dynamic: false };
};

const ELIXIR_SYNTAX = {
  lineComments: ["#"],
  custom: [readSigil, readCharacter],
  quotes: [
    { open: '"""', close: '"""', escapes: true, multiline: true, interpolation: ["#{"] },
    { open: "'''", close: "'''", escapes: true, multiline: true, interpolation: ["#{"] },
    { open: '"', close: '"', escapes: true, multiline: true, interpolation: ["#{"] },
    { open: "'", close: "'", escapes: true, multiline: true, interpolation: ["#{"] },
  ],
  wordChars: "?!",
} as const;

type ModuleUse = { name: string[]; kind: ReferenceKind };
type ElixirFile = {
  modules: string[];
  directives: ModuleUse[];
  // Module names written in code, with aliases already expanded.
  names: string[][];
};

const DIRECTIVES: Record<string, ReferenceKind> = { alias: "import", import: "import", require: "require", use: "import" };
const DEFINITIONS = new Set(["defmodule", "defprotocol"]);

// An alias such as Foo.Bar.Baz: capitalized words joined by dots.
function readAlias(tokens: Token[], index: number): { parts: string[]; next: number } | null {
  if (!isWord(tokens[index]) || !/^[A-Z]/.test(tokens[index].text)) return null;
  const parts = [tokens[index].text];
  let next = index + 1;
  while (isPunct(tokens[next], ".") && isWord(tokens[next + 1]) && /^[A-Z]/.test(tokens[next + 1].text)) {
    parts.push(tokens[next + 1].text);
    next += 2;
  }
  return { parts, next };
}

export function readElixirFile(content: string): ElixirFile {
  const tokens = tokenize(content, ELIXIR_SYNTAX);
  const file: ElixirFile = { modules: [], directives: [], names: [] };
  // Enclosing defmodule blocks, each with the block depth it opened.
  const stack: { name: string[]; depth: number }[] = [];
  const aliases = new Map<string, string[]>();
  let depth = 0;
  let pendingModule: string[] | null = null;

  const expand = (parts: string[]): string[] => {
    if (parts[0] === "__MODULE__") return [...(stack.at(-1)?.name ?? []), ...parts.slice(1)];
    const alias = aliases.get(parts[0]);
    return alias === undefined ? parts : [...alias, ...parts.slice(1)];
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!isWord(token)) continue;
    const previous = tokens[i - 1];
    const isKeyword = !isPunct(previous, ".") && !isPunct(previous, ":") && !isPunct(tokens[i + 1], ":");

    if (isKeyword && (token.text === "do" || token.text === "fn")) {
      depth++;
      if (token.text === "do" && pendingModule !== null) {
        stack.push({ name: pendingModule, depth });
        pendingModule = null;
      }
      continue;
    }
    if (isKeyword && token.text === "end") {
      while (stack.length > 0 && stack.at(-1)!.depth >= depth) stack.pop();
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (DEFINITIONS.has(token.text) && isKeyword) {
      const alias = readAlias(tokens, i + 1);
      if (alias === null) continue;
      const name = [...(stack.at(-1)?.name ?? []), ...alias.parts];
      file.modules.push(name.join("."));
      // A nested module is aliased by its last part inside its parent.
      if (stack.length > 0 && alias.parts.length === 1) aliases.set(alias.parts[0], name);
      pendingModule = name;
      i = alias.next - 1;
      continue;
    }

    const directive = DIRECTIVES[token.text];
    if (directive !== undefined && isKeyword) {
      const alias = readAlias(tokens, i + 1);
      if (alias === null) continue;
      let next = alias.next;
      const base = expand(alias.parts);
      if (isPunct(tokens[next], ".") && isPunct(tokens[next + 1], "{")) {
        // alias Foo.{Bar, Baz.Qux}
        next += 2;
        while (next < tokens.length && !isPunct(tokens[next], "}")) {
          const member = readAlias(tokens, next);
          if (member === null) {
            next++;
            continue;
          }
          const name = [...base, ...member.parts];
          file.directives.push({ name, kind: directive });
          if (token.text === "alias") aliases.set(member.parts.at(-1)!, name);
          next = member.next;
        }
      } else {
        file.directives.push({ name: base, kind: directive });
        if (token.text === "alias") {
          // alias Foo.Bar, as: Baz
          let as = -1;
          for (let j = next; j < next + 4 && as === -1; j++) if (isWord(tokens[j], "as")) as = j;
          const aliasName = as !== -1 && isPunct(tokens[as + 1], ":") ? readAlias(tokens, as + 2) : null;
          aliases.set(aliasName?.parts[0] ?? base.at(-1)!, base);
        }
      }
      i = next - 1;
      continue;
    }

    if (isPunct(previous, ".") || !/^[A-Z_]/.test(token.text)) continue;
    const alias = readAlias(tokens, i) ?? (token.text === "__MODULE__" ? { parts: ["__MODULE__"], next: i + 1 } : null);
    if (alias === null) continue;
    let next = alias.next;
    if (token.text === "__MODULE__") {
      while (isPunct(tokens[next], ".") && isWord(tokens[next + 1]) && /^[A-Z]/.test(tokens[next + 1].text)) {
        alias.parts.push(tokens[next + 1].text);
        next += 2;
      }
    }
    file.names.push(expand(alias.parts));
    i = next - 1;
  }
  return file;
}

// Elixir: modules are indexed by the name in `defmodule`. alias, import,
// require and use, and module names written in code (Foo.Bar.baz(), %Foo{}),
// become references when they name exactly one module of the repository.
// Aliases are expanded per file. Standard library and dependency modules are
// not in the index and are ignored.
export const analyzeElixir: LanguageAnalyzer = (files) => {
  const { parsed, failed } = readEach(files, (file) => readElixirFile(file.content));
  const index = new DeclarationIndex(".");
  for (const { file, value } of parsed) {
    for (const name of value.modules) index.add("", name, file.path);
  }
  // Exact names only: Foo.Bar is its own module, not something inside Foo.
  const lookup = (parts: string[]) => {
    const files = index.files(parts.join("."));
    if (files === undefined) return null;
    return files.size === 1 ? resolved([...files][0]) : unresolved("ambiguous");
  };

  const references = new Map<string, FileReference[]>();
  for (const { file, value } of parsed) {
    const found: FileReference[] = [];
    for (const directive of value.directives) {
      const target = lookup(directive.name);
      if (target !== null) found.push({ specifier: directive.name.join("."), kind: directive.kind, resolution: target });
    }
    for (const name of value.names) {
      const target = lookup(name);
      if (target !== null && target.status === "resolved") {
        found.push({ specifier: name.join("."), kind: "reference", resolution: target });
      }
    }
    references.set(file.path, found);
  }
  return { references, failed };
};
