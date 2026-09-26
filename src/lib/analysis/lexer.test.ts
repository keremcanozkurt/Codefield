import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { logicalLines, readCharLiteral, tokenize, type LexerSyntax } from "./lexer.ts";

const C_LIKE: LexerSyntax = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/" }],
  quotes: [{ open: '"', close: '"', escapes: true, interpolation: ["${"] }],
  newlines: true,
};

function texts(source: string, syntax: LexerSyntax = C_LIKE) {
  return tokenize(source, syntax).map((t) => `${t.type}:${t.text}`);
}

describe("tokenize", () => {
  it("drops comments and decodes strings", () => {
    assert.deepEqual(texts('a /* x */ "b\\"c" // d\ne'), ["word:a", 'string:b"c', "newline:\n", "word:e"]);
  });

  it("keeps one newline for a comment spanning lines", () => {
    assert.deepEqual(texts("a /*\n\n*/ b"), ["word:a", "newline:\n", "word:b"]);
  });

  it("ends a single-line string at the line break", () => {
    const tokens = tokenize('"open\nnext', C_LIKE);
    assert.deepEqual(tokens.map((t) => t.type), ["string", "newline", "word"]);
  });

  it("marks interpolated strings as dynamic", () => {
    const [plain, dynamic] = tokenize('"a" "${b}"', C_LIKE);
    assert.equal(plain.dynamic, false);
    assert.equal(dynamic.dynamic, true);
  });

  it("supports nested block comments where the language has them", () => {
    const syntax: LexerSyntax = { blockComments: [{ open: "/*", close: "*/", nested: true }] };
    assert.deepEqual(texts("/* a /* b */ c */ d", syntax), ["word:d"]);
  });

  it("joins lines ending in a backslash", () => {
    assert.deepEqual(texts("a \\\nb"), ["word:a", "word:b"]);
  });

  it("tracks line numbers, and does not repeat newlines", () => {
    const tokens = tokenize('a\n"x\\\ny"\n/*\n*/ b', { ...C_LIKE, quotes: [{ open: '"', close: '"', escapes: true, multiline: true }] });
    assert.deepEqual(tokens.map((t) => `${t.type}@${t.line}`), ["word@1", "newline@1", "string@2", "newline@3", "word@5"]);
  });

  it("does not start a prefixed string inside a word", () => {
    const syntax: LexerSyntax = { quotes: [{ open: 'r"', close: '"' }, { open: '"', close: '"' }] };
    assert.deepEqual(texts('bar"x" r"y"', syntax), ["word:bar", "string:x", "string:y"]);
  });

  it("tells character literals from lifetimes and symbols", () => {
    assert.ok(readCharLiteral("'a'", 0, undefined));
    assert.ok(readCharLiteral("'\\n'", 0, undefined));
    assert.ok(readCharLiteral("'😀'", 0, undefined));
    assert.equal(readCharLiteral("'a: &str", 0, undefined), null);
    assert.equal(readCharLiteral("'sym)", 0, undefined), null);
  });

  it("handles an unterminated block comment and empty input", () => {
    assert.deepEqual(texts("a /* never closed"), ["word:a"]);
    assert.deepEqual(texts(""), []);
  });
});

describe("logicalLines", () => {
  it("continues a line while brackets are open", () => {
    const lines = logicalLines(tokenize("a (\nb\n)\nc", C_LIKE));
    assert.deepEqual(lines.map((line) => line.map((t) => t.text).join(" ")), ["a ( b )", "c"]);
  });
});
