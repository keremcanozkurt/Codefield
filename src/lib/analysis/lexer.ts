// A small tokenizer shared by the non-JavaScript analyzers. It knows each
// language's comments and string literals, which is what keeps directive
// matching reliable: an `import` inside a comment, a docstring or a string is
// never seen as one. It does not build a syntax tree; analyzers read the few
// top-level forms they need (imports, includes, package and type
// declarations) from the token stream.

export type Token = {
  type: "word" | "string" | "punct" | "newline";
  // The source text for words and punctuation, the decoded contents for
  // strings, and "\n" for newlines.
  text: string;
  start: number;
  end: number;
  line: number;
  // Set on strings with interpolation, whose value is not known statically.
  dynamic?: boolean;
};

export type StringMatch = { end: number; value: string; dynamic: boolean };

// A custom reader for syntax that simple quote rules cannot describe, such as
// heredocs, raw strings with delimiters or a Ruby regular expression. Returns
// null when `source` at `index` is not that syntax. `previous` is the last
// token produced, ignoring newlines.
export type CustomReader = (
  source: string,
  index: number,
  previous: Token | undefined,
) => (StringMatch & { skip?: false }) | { skip: true; end: number } | null;

export type QuoteRule = {
  open: string;
  close: string;
  escapes?: boolean;
  // Two closing quotes in a row stand for one, as in C# verbatim strings.
  doubledClose?: boolean;
  // Whether the literal may continue past a newline. Single-line literals
  // that reach a newline end there, so one stray quote cannot swallow the
  // rest of the file.
  multiline?: boolean;
  // Markers that make the literal interpolated, such as "${" or "#{".
  interpolation?: readonly string[];
};

export type LexerSyntax = {
  lineComments?: readonly string[];
  blockComments?: readonly { open: string; close: string; nested?: boolean }[];
  quotes?: readonly QuoteRule[];
  custom?: readonly CustomReader[];
  // Characters besides letters, digits and "_" that may appear inside words.
  wordChars?: string;
  newlines?: boolean;
};

export function tokenize(source: string, syntax: LexerSyntax): Token[] {
  const tokens: Token[] = [];
  const wordChars = syntax.wordChars ?? "";
  const lineComments = syntax.lineComments ?? [];
  const blockComments = syntax.blockComments ?? [];
  const quotes = syntax.quotes ?? [];
  const custom = syntax.custom ?? [];
  let line = 1;
  let index = 0;
  let previous: Token | undefined;

  const push = (token: Token) => {
    tokens.push(token);
    if (token.type !== "newline") previous = token;
  };
  const newline = (at: number) => {
    if (syntax.newlines && tokens.at(-1)?.type !== "newline") {
      tokens.push({ type: "newline", text: "\n", start: at, end: at + 1, line });
    }
  };
  const countLines = (from: number, to: number) => {
    let found = false;
    for (let i = from; i < to; i++) {
      if (source.charCodeAt(i) === 10) {
        line++;
        found = true;
      }
    }
    return found;
  };

  scan: while (index < source.length) {
    const char = source[index];

    if (char === "\n") {
      newline(index);
      line++;
      index++;
      continue;
    }
    if (char === " " || char === "\t" || char === "\r" || char === "\f" || char === "\v") {
      index++;
      continue;
    }
    // A backslash before a line break joins two lines (C, Python).
    if (char === "\\" && (source[index + 1] === "\n" || (source[index + 1] === "\r" && source[index + 2] === "\n"))) {
      index = source.indexOf("\n", index) + 1;
      line++;
      continue;
    }

    for (const read of custom) {
      const match = read(source, index, previous);
      if (match === null) continue;
      const startLine = line;
      if (countLines(index, match.end) && match.skip) newline(match.end);
      if (!match.skip) {
        push({ type: "string", text: match.value, start: index, end: match.end, line: startLine, dynamic: match.dynamic });
      }
      index = Math.max(match.end, index + 1);
      continue scan;
    }

    // Block comments first: Lua's "--[[" starts with its line comment "--".
    for (const comment of blockComments) {
      if (!source.startsWith(comment.open, index)) continue;
      const end = skipBlockComment(source, index, comment.open, comment.close, comment.nested ?? false);
      if (countLines(index, end)) newline(end);
      index = end;
      continue scan;
    }

    for (const marker of lineComments) {
      if (!source.startsWith(marker, index)) continue;
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
      continue scan;
    }

    for (const rule of quotes) {
      if (!source.startsWith(rule.open, index)) continue;
      // A prefixed literal such as r"..." must not start in the middle of a word.
      if (isWordStart(rule.open.charCodeAt(0)) && index > 0 && isWordChar(source.charCodeAt(index - 1), wordChars)) {
        continue;
      }
      const match = readQuoted(source, index, rule);
      push({ type: "string", text: match.value, start: index, end: match.end, line, dynamic: match.dynamic });
      countLines(index, match.end);
      index = match.end;
      continue scan;
    }

    const code = source.charCodeAt(index);
    if (isWordChar(code, wordChars)) {
      let end = index + 1;
      while (end < source.length && isWordChar(source.charCodeAt(end), wordChars)) end++;
      push({ type: "word", text: source.slice(index, end), start: index, end, line });
      index = end;
      continue;
    }

    push({ type: "punct", text: char, start: index, end: index + 1, line });
    index++;
  }

  return tokens;
}

function readQuoted(source: string, start: number, rule: QuoteRule): StringMatch {
  let index = start + rule.open.length;
  let value = "";
  let dynamic = false;
  const interpolation = rule.interpolation ?? [];

  while (index < source.length) {
    if (source.startsWith(rule.close, index)) {
      if (rule.doubledClose && source.startsWith(rule.close, index + rule.close.length)) {
        value += rule.close;
        index += rule.close.length * 2;
        continue;
      }
      return { end: index + rule.close.length, value, dynamic };
    }
    const char = source[index];
    if (char === "\n" && !rule.multiline) return { end: index, value, dynamic };
    if (rule.escapes && char === "\\" && index + 1 < source.length) {
      const next = source[index + 1];
      value += ESCAPES[next] ?? next;
      index += 2;
      continue;
    }
    if (!dynamic && interpolation.some((marker) => source.startsWith(marker, index))) dynamic = true;
    value += char;
    index++;
  }
  return { end: source.length, value, dynamic };
}

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "0": "\0" };

function skipBlockComment(source: string, start: number, open: string, close: string, nested: boolean): number {
  let depth = 1;
  let index = start + open.length;
  while (index < source.length) {
    if (source.startsWith(close, index)) {
      depth--;
      index += close.length;
      if (depth === 0 || !nested) return index;
      continue;
    }
    if (nested && source.startsWith(open, index)) {
      depth++;
      index += open.length;
      continue;
    }
    index++;
  }
  return source.length;
}

function isWordStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
}

function isWordChar(code: number, extra: string): boolean {
  return (
    (code >= 48 && code <= 57) ||
    isWordStart(code) ||
    // Non-ASCII letters; Unicode whitespace here is rare enough to ignore.
    (code > 127 && code !== 0xa0 && code !== 0xfeff) ||
    (extra !== "" && extra.includes(String.fromCharCode(code)))
  );
}

// A character literal such as 'a', '\n' or '\u{1F600}', which in Rust and
// Scala shares its opening quote with lifetimes and symbols ('a, 'sym).
export const readCharLiteral: CustomReader = (source, index) => {
  if (source[index] !== "'") return null;
  if (source[index + 1] === "\\") {
    const close = source.indexOf("'", index + 2);
    if (close === -1 || close - index > 12 || source.slice(index, close).includes("\n")) return null;
    return { end: close + 1, value: "", dynamic: false };
  }
  const codePoint = source.codePointAt(index + 1);
  if (codePoint === undefined || codePoint === 10) return null;
  const width = codePoint > 0xffff ? 2 : 1;
  return source[index + 1 + width] === "'" ? { end: index + 2 + width, value: "", dynamic: false } : null;
};

// Token helpers shared by the analyzers.

// The guards narrow to these, rather than to Token, so a false result does
// not narrow a Token to `never`.
type WordToken = Token & { type: "word" };
type PunctToken = Token & { type: "punct" };

export function isWord(token: Token | undefined, text?: string): token is WordToken {
  return token !== undefined && token.type === "word" && (text === undefined || token.text === text);
}

export function isPunct(token: Token | undefined, text: string): token is PunctToken {
  return token !== undefined && token.type === "punct" && token.text === text;
}

// Tokens grouped into lines, for languages where a statement ends at a line
// break unless brackets are still open.
export function logicalLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [];
  let current: Token[] = [];
  let depth = 0;
  for (const token of tokens) {
    if (token.type === "newline") {
      if (depth > 0) continue;
      if (current.length > 0) lines.push(current);
      current = [];
      continue;
    }
    if (token.type === "punct") {
      if ("([{".includes(token.text)) depth++;
      else if (")]}".includes(token.text) && depth > 0) depth--;
    }
    current.push(token);
  }
  if (current.length > 0) lines.push(current);
  return lines;
}

// Reads a dotted name such as a.b.C starting at `index`: words joined by
// `separator` punctuation (one or more characters, like "." or "::").
export function readQualifiedName(
  tokens: Token[],
  index: number,
  separator = ".",
): { parts: string[]; next: number } | null {
  if (!isWord(tokens[index])) return null;
  const parts = [tokens[index].text];
  let next = index + 1;
  while (true) {
    const after = matchSeparator(tokens, next, separator);
    if (after === null || !isWord(tokens[after])) break;
    parts.push(tokens[after].text);
    next = after + 1;
  }
  return { parts, next };
}

export function matchSeparator(tokens: Token[], index: number, separator: string): number | null {
  for (let i = 0; i < separator.length; i++) {
    if (!isPunct(tokens[index + i], separator[i])) return null;
  }
  return index + separator.length;
}
