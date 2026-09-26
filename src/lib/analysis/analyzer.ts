import type { LanguageId, SourceExtension } from "../languages/registry.ts";
import type { ConfigFile } from "./config.ts";
import type { ReferenceKind } from "./kinds.ts";
import type { Resolution } from "./resolve.ts";

// The contract between the repository pipeline and each language family. An
// analyzer receives every source file of its languages at once, so it can
// build a repository-wide index (declared types, module paths, package
// directories) a single time, and returns each file's references already
// resolved against the repository. The pipeline turns resolved references
// into graph relationships; nothing past this point knows about languages.

export type AnalysisSource = {
  path: string;
  content: string;
  extension: SourceExtension;
};

export type AnalyzedFile = AnalysisSource & { language: LanguageId };

export type RepositoryContext = {
  // Every analyzed source file, of every language.
  sourcePaths: ReadonlySet<string>;
  // Every file path in the repository tree, when known.
  repositoryPaths?: ReadonlySet<string>;
  // Auxiliary files loaded for resolution: tsconfig.json, go.mod, Cargo.toml,
  // composer.json, pubspec.yaml and similar. Read as data, never executed.
  configFiles: readonly ConfigFile[];
};

export type FileReference = {
  // What the source says, such as "./util", "app.models.user" or "Foo\\Bar".
  specifier: string;
  kind: ReferenceKind;
  resolution: Resolution;
};

export type AnalyzerResult = {
  references: Map<string, FileReference[]>;
  // Files the analyzer could not read at all.
  failed: string[];
};

export type LanguageAnalyzer = (files: AnalyzedFile[], repository: RepositoryContext) => AnalyzerResult;

// Runs `read` on every file, collecting files it throws on instead of
// failing the repository.
export function readEach<T>(files: AnalyzedFile[], read: (file: AnalyzedFile) => T) {
  const parsed: { file: AnalyzedFile; value: T }[] = [];
  const failed: string[] = [];
  for (const file of files) {
    try {
      parsed.push({ file, value: read(file) });
    } catch {
      failed.push(file.path);
    }
  }
  return { parsed, failed };
}

export const EXTERNAL: Resolution = { status: "external" };

export function unresolved(reason: Extract<Resolution, { status: "unresolved" }>["reason"]): Resolution {
  return { status: "unresolved", reason };
}

export function resolved(path: string): Resolution {
  return { status: "resolved", path };
}

// Picks the one analyzed source file among `candidates`. Several distinct
// matches are ambiguous; a match that exists in the repository but is not an
// analyzed source is reported as such; no match returns `otherwise`.
export function pickCandidate(
  candidates: Iterable<string>,
  repository: RepositoryContext,
  otherwise: Resolution = unresolved("not_found"),
): Resolution {
  const found = new Set<string>();
  let exists = false;
  for (const candidate of candidates) {
    if (repository.sourcePaths.has(candidate)) found.add(candidate);
    else if (repository.repositoryPaths?.has(candidate)) exists = true;
  }
  if (found.size === 1) return resolved([...found][0]);
  if (found.size > 1) return unresolved("ambiguous");
  if (exists) return unresolved("not_source");
  return otherwise;
}

export function configFile(repository: RepositoryContext, path: string): ConfigFile | undefined {
  return repository.configFiles.find((file) => file.path === path);
}

export function configFilesNamed(repository: RepositoryContext, test: (name: string) => boolean): ConfigFile[] {
  return repository.configFiles.filter((file) => test(file.path.slice(file.path.lastIndexOf("/") + 1)));
}
