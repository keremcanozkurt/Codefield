// Blanks out heredoc bodies, keeping line breaks, so their contents are never
// read as code. The lexer cannot do this itself because a heredoc body starts
// on the line after its opening marker, while the rest of that line is still
// code. `opener` matches a marker and returns its terminator name; `closes`
// says whether a line ends the body. Markers after `lineComment` are ignored.
export function blankHeredocs(
  source: string,
  opener: RegExp,
  closes: (line: string, name: string) => boolean,
  lineComment?: string,
): string {
  if (!source.includes("<<")) return source;
  const lines = source.split("\n");
  const pending: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (pending.length > 0) {
      if (closes(line, pending[0])) pending.shift();
      lines[i] = " ".repeat(line.length);
      continue;
    }
    const comment = lineComment === undefined ? -1 : line.indexOf(lineComment);
    for (const match of (comment === -1 ? line : line.slice(0, comment)).matchAll(opener)) {
      const name = match.slice(1).find((group) => group !== undefined);
      if (name !== undefined) pending.push(name);
    }
  }
  return lines.join("\n");
}
