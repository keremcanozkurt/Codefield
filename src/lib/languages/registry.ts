// The one list of languages Codefield analyzes. Source selection, language
// names, filters, statistics and colors are all keyed by these IDs, and every
// language's analyzer is chosen through `analyzer`. Safe to import from client
// components: nothing here parses code.
//
// Java, Kotlin and Scala share the "jvm" analyzer because they share one
// classpath: a Kotlin file importing a Java class is an ordinary edge.
//
// `strength` describes how many real file-level relationships static syntax
// can reveal for the language, not how carefully it is analyzed: "strong"
// languages name files or modules directly; "conservative" ones mostly import
// namespaces or packages, so only references that map to exactly one file are
// kept and graphs are sparser.

export const LANGUAGES = [
  { id: "typescript", name: "TypeScript", extensions: [".ts", ".tsx"], analyzer: "ecmascript", strength: "strong" },
  { id: "javascript", name: "JavaScript", extensions: [".js", ".jsx"], analyzer: "ecmascript", strength: "strong" },
  { id: "python", name: "Python", extensions: [".py"], analyzer: "python", strength: "strong" },
  { id: "go", name: "Go", extensions: [".go"], analyzer: "go", strength: "conservative" },
  { id: "rust", name: "Rust", extensions: [".rs"], analyzer: "rust", strength: "strong" },
  { id: "java", name: "Java", extensions: [".java"], analyzer: "jvm", strength: "strong" },
  { id: "kotlin", name: "Kotlin", extensions: [".kt", ".kts"], analyzer: "jvm", strength: "conservative" },
  { id: "csharp", name: "C#", extensions: [".cs"], analyzer: "csharp", strength: "conservative" },
  { id: "c", name: "C", extensions: [".c", ".h"], analyzer: "c-family", strength: "strong" },
  {
    id: "cpp",
    name: "C++",
    extensions: [".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx"],
    analyzer: "c-family",
    strength: "strong",
  },
  { id: "php", name: "PHP", extensions: [".php"], analyzer: "php", strength: "strong" },
  { id: "ruby", name: "Ruby", extensions: [".rb"], analyzer: "ruby", strength: "strong" },
  { id: "dart", name: "Dart", extensions: [".dart"], analyzer: "dart", strength: "strong" },
  { id: "elixir", name: "Elixir", extensions: [".ex", ".exs"], analyzer: "elixir", strength: "strong" },
  { id: "scala", name: "Scala", extensions: [".scala", ".sc"], analyzer: "jvm", strength: "conservative" },
  { id: "lua", name: "Lua", extensions: [".lua"], analyzer: "lua", strength: "strong" },
  { id: "swift", name: "Swift", extensions: [".swift"], analyzer: "swift", strength: "conservative" },
] as const;

type Language = (typeof LANGUAGES)[number];

export type LanguageId = Language["id"];
export type SourceExtension = Language["extensions"][number];
export type AnalyzerId = Language["analyzer"];
export type SupportStrength = Language["strength"];

export type LanguageDefinition = {
  id: LanguageId;
  name: string;
  extensions: readonly SourceExtension[];
  analyzer: AnalyzerId;
  strength: SupportStrength;
};

export const LANGUAGE_IDS: readonly LanguageId[] = LANGUAGES.map((language) => language.id);

const BY_ID = new Map<LanguageId, LanguageDefinition>(LANGUAGES.map((language) => [language.id, language]));
const BY_EXTENSION = new Map<string, LanguageDefinition>(
  LANGUAGES.flatMap((language) => language.extensions.map((extension) => [extension, language] as const)),
);

export const SOURCE_EXTENSIONS: readonly SourceExtension[] = LANGUAGES.flatMap((language) => language.extensions);

export function languageDefinition(id: LanguageId): LanguageDefinition {
  return BY_ID.get(id)!;
}

// Extensions are matched exactly, so ".H" or ".PY" are not source files. Git
// repositories are case-sensitive and these spellings are almost never used.
export function languageForExtension(extension: string): LanguageDefinition | null {
  return BY_EXTENSION.get(extension) ?? null;
}

export function isSourceExtension(value: string): value is SourceExtension {
  return BY_EXTENSION.has(value);
}

export function isLanguageId(value: string): value is LanguageId {
  return BY_ID.has(value as LanguageId);
}

export function languageName(id: LanguageId): string {
  return languageDefinition(id).name;
}

// Registry order, which keeps related languages next to each other in lists.
export function compareLanguages(a: LanguageId, b: LanguageId): number {
  return LANGUAGE_IDS.indexOf(a) - LANGUAGE_IDS.indexOf(b);
}
