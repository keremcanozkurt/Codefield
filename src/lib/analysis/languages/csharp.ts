import type { FileReference, LanguageAnalyzer, RepositoryContext } from "../analyzer.ts";
import { readEach, resolved, unresolved } from "../analyzer.ts";
import { isPunct, isWord, readQualifiedName, tokenize, type CustomReader, type Token } from "../lexer.ts";
import { directoryOf } from "../paths.ts";
import { DeclarationIndex } from "./declarations.ts";

// Verbatim (@"..."), interpolated ($"..."), both, and raw ("""...""")
// strings. Interpolated strings may contain nested quotes inside {...}, which
// are not tracked: the string simply ends at the first unescaped quote.
const readCSharpString: CustomReader = (source, index) => {
  const match = /^(\$*@?\$*)("""+|")/.exec(source.slice(index, index + 12));
  if (match === null || (index > 0 && /\w/.test(source[index - 1]))) return null;
  const prefix = match[1];
  const quote = match[2];
  const dynamic = prefix.includes("$");
  let i = index + match[0].length;
  if (quote.length >= 3) {
    const close = source.indexOf(quote, i);
    return { end: close === -1 ? source.length : close + quote.length, value: "", dynamic };
  }
  const verbatim = prefix.includes("@");
  let value = "";
  while (i < source.length) {
    const char = source[i];
    if (char === '"') {
      if (verbatim && source[i + 1] === '"') {
        value += '"';
        i += 2;
        continue;
      }
      return { end: i + 1, value, dynamic };
    }
    if (char === "\n" && !verbatim) break;
    if (char === "\\" && !verbatim) {
      value += source[i + 1] ?? "";
      i += 2;
      continue;
    }
    value += char;
    i++;
  }
  return { end: i, value, dynamic };
};

const CSHARP_SYNTAX = {
  lineComments: ["//"],
  blockComments: [{ open: "/*", close: "*/" }],
  custom: [readCSharpString],
  quotes: [{ open: "'", close: "'", escapes: true }],
} as const;

const TYPE_KEYWORDS = new Set(["class", "struct", "interface", "enum", "record"]);

type Using =
  | { type: "namespace"; name: string[]; global: boolean }
  | { type: "static"; name: string[]; global: boolean }
  | { type: "alias"; alias: string; name: string[]; global: boolean };

export type CSharpFile = {
  usings: Using[];
  // Types declared directly in a namespace, with their namespace.
  types: { namespace: string; name: string }[];
  // Every type name declared in the file, at any depth.
  declared: Set<string>;
  // Names used in code with the namespace they appear in: capitalized single
  // names, and dotted names.
  names: { parts: string[]; namespace: string }[];
};

export function readCSharpFile(content: string): CSharpFile {
  const tokens = tokenize(content, CSHARP_SYNTAX);
  const file: CSharpFile = { usings: [], types: [], declared: new Set(), names: [] };
  // Block namespaces, each with the brace depth of its body.
  const stack: { name: string; depth: number }[] = [];
  let fileNamespace = "";
  let depth = 0;
  const namespace = () => [fileNamespace, ...stack.map((entry) => entry.name)].filter((n) => n !== "").join(".");
  const namespaceDepth = () => stack.at(-1)?.depth ?? 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (isPunct(token, "{")) {
      depth++;
      continue;
    }
    if (isPunct(token, "}")) {
      depth = Math.max(0, depth - 1);
      while (stack.length > 0 && stack.at(-1)!.depth > depth) stack.pop();
      continue;
    }
    if (!isWord(token)) continue;
    const previous = tokens[i - 1];
    if (isPunct(previous, ".")) continue;

    if (token.text === "namespace") {
      const name = readQualifiedName(tokens, i + 1);
      if (name === null) continue;
      if (isPunct(tokens[name.next], ";")) fileNamespace = name.parts.join(".");
      else stack.push({ name: name.parts.join("."), depth: depth + 1 });
      i = name.next - 1;
      continue;
    }

    if ((token.text === "using" || (token.text === "global" && isWord(tokens[i + 1], "using"))) && depth === namespaceDepth()) {
      const global = token.text === "global";
      let next = global ? i + 2 : i + 1;
      if (isPunct(tokens[next], "(")) continue;
      const isStatic = isWord(tokens[next], "static");
      if (isStatic) next++;
      if (isWord(tokens[next]) && isPunct(tokens[next + 1], "=")) {
        const target = readQualifiedName(tokens, next + 2);
        if (target !== null) {
          file.usings.push({ type: "alias", alias: tokens[next].text, name: target.parts, global });
          i = target.next;
        }
        continue;
      }
      const name = readQualifiedName(tokens, next);
      if (name === null || !isPunct(tokens[name.next], ";")) continue;
      file.usings.push({ type: isStatic ? "static" : "namespace", name: name.parts, global });
      i = name.next;
      continue;
    }

    if (TYPE_KEYWORDS.has(token.text) || token.text === "delegate") {
      let nameToken: Token | undefined;
      if (token.text === "delegate") {
        // delegate ReturnType Name(...). The search is bounded so a file of
        // malformed delegates cannot make this quadratic.
        let open = -1;
        for (let j = i + 1; j < Math.min(tokens.length, i + 64); j++) {
          if (isPunct(tokens[j], "(") || isPunct(tokens[j], ";") || isPunct(tokens[j], "{")) {
            open = j;
            break;
          }
        }
        let j = open - 1;
        if (isPunct(tokens[j], ">")) {
          let angle = 0;
          do {
            if (isPunct(tokens[j], ">")) angle++;
            if (isPunct(tokens[j], "<")) angle--;
            j--;
          } while (j > i && angle > 0);
        }
        if (open !== -1 && isPunct(tokens[open], "(")) nameToken = tokens[j];
      } else {
        nameToken = tokens[i + 1];
        // record struct Name, record class Name
        if (token.text === "record" && (isWord(nameToken, "struct") || isWord(nameToken, "class"))) nameToken = tokens[i + 2];
      }
      if (isWord(nameToken) && !TYPE_KEYWORDS.has(nameToken.text) && /^[A-Z_]/i.test(nameToken.text)) {
        file.declared.add(nameToken.text);
        if (depth === namespaceDepth()) file.types.push({ namespace: namespace(), name: nameToken.text });
        if (token.text !== "delegate") i = tokens.indexOf(nameToken);
      }
      continue;
    }

    if (!/^[A-Z]/.test(token.text) && !(isPunct(tokens[i + 1], ".") && /^[A-Z]/.test(tokens[i + 2]?.text ?? ""))) continue;
    const chain = readQualifiedName(tokens, i);
    if (chain === null) continue;
    file.names.push({ parts: chain.parts, namespace: namespace() });
    i = chain.next - 1;
  }
  return file;
}

// The directory of the nearest .csproj above a file: global usings apply to
// the project they are declared in.
function projectOf(path: string, projects: string[]): string {
  let best = "";
  for (const project of projects) {
    if ((project === "" || path.startsWith(`${project}/`)) && project.length >= best.length) best = project;
  }
  return best;
}

function enclosingNamespaces(namespace: string): string[] {
  const parts = namespace === "" ? [] : namespace.split(".");
  return parts.map((_, i) => parts.slice(0, parts.length - i).join(".")).concat([""]);
}

// C#: `using Namespace;` only brings a namespace into scope, so it never
// becomes an edge by itself. Edges come from `using static Type`,
// `using Alias = Type`, and from type names used in code that resolve to
// exactly one declaring file: C#'s lookup order is followed (the enclosing
// namespaces from the innermost out, then the usings of the file and the
// global usings of its project), and a name with several candidates at the
// first level that has any is skipped. Types declared in several files
// (partial classes) are skipped as well.
export const analyzeCSharp: LanguageAnalyzer = (files, repository: RepositoryContext) => {
  const { parsed, failed } = readEach(files, (file) => readCSharpFile(file.content));
  const index = new DeclarationIndex(".");
  for (const { file, value } of parsed) {
    for (const type of value.types) index.add(type.namespace, type.name, file.path);
  }

  const projects = [...(repository.repositoryPaths ?? [])]
    .filter((path) => path.endsWith(".csproj"))
    .map((path) => directoryOf(path));
  const globalUsings = new Map<string, string[]>();
  for (const { file, value } of parsed) {
    const project = projectOf(file.path, projects);
    for (const using of value.usings) {
      if (using.global && using.type === "namespace") {
        globalUsings.set(project, [...(globalUsings.get(project) ?? []), using.name.join(".")]);
      }
    }
  }

  const references = new Map<string, FileReference[]>();
  for (const { file, value } of parsed) {
    const found: FileReference[] = [];
    const aliases = new Set<string>();
    const usingNamespaces = [...(globalUsings.get(projectOf(file.path, projects)) ?? [])];

    for (const using of value.usings) {
      const specifier = using.name.join(".");
      if (using.type === "namespace") {
        usingNamespaces.push(specifier);
        continue;
      }
      if (using.type === "alias") aliases.add(using.alias);
      const target = index.lookup(using.name, false);
      if (target !== null) found.push({ specifier, kind: "import", resolution: target });
      else if (using.type === "static" && index.hasNamespace(using.name.slice(0, -1).join("."))) {
        found.push({ specifier, kind: "import", resolution: unresolved("not_found") });
      }
    }

    const resolveName = (parts: string[], namespace: string): string | null => {
      // A qualified name, from the enclosing namespaces outwards: A.B.Type.
      if (parts.length > 1) {
        for (const base of enclosingNamespaces(namespace)) {
          const target = index.lookup(base === "" ? parts : [...base.split("."), ...parts]);
          if (target !== null) return target.status === "resolved" ? target.path : null;
        }
      }
      const name = parts[0];
      if (!/^[A-Z]/.test(name) || value.declared.has(name) || aliases.has(name)) return null;
      const levels = [...enclosingNamespaces(namespace).map((n) => [n]), usingNamespaces];
      for (const level of levels) {
        const target = index.inNamespaces(name, level);
        if (target === null) continue;
        return target === "ambiguous" ? null : target;
      }
      return null;
    };

    for (const { parts, namespace } of value.names) {
      const target = resolveName(parts, namespace);
      if (target !== null) found.push({ specifier: parts.join("."), kind: "reference", resolution: resolved(target) });
    }
    references.set(file.path, found);
  }
  return { references, failed };
};
