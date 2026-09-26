import { languageForExtension, type AnalyzerId } from "../languages/registry.ts";
import type { AnalysisSource, AnalyzedFile, FileReference, RepositoryContext } from "./analyzer.ts";
import { ANALYZERS } from "./analyzers.ts";
import { isProjectConfigName, readProjectConfigs, type ConfigFile, type ConfigStatus } from "./config.ts";
import type { ReferenceKind } from "./kinds.ts";
import { compareStrings } from "./paths.ts";
import type { UnresolvedReason } from "./resolve.ts";

export type { AnalysisSource } from "./analyzer.ts";

export type ModuleRelationship = {
  sourcePath: string;
  targetPath: string;
  kind: ReferenceKind;
  specifier: string;
};

export type UnresolvedReference = {
  sourcePath: string;
  specifier: string;
  kind: ReferenceKind;
  reason: UnresolvedReason;
};

export type SkippedAnalysis = {
  path: string;
  reason: "parse_failed";
};

export type ModuleAnalysis = {
  relationships: ModuleRelationship[];
  unresolved: UnresolvedReference[];
  skipped: SkippedAnalysis[];
  configs: ConfigStatus[];
  stats: {
    filesAnalyzed: number;
    filesSkipped: number;
    relationships: number;
    unresolvedReferences: number;
  };
};

export type AnalysisOptions = {
  // tsconfig.json, go.mod, Cargo.toml and the other auxiliary files that
  // selectConfigFiles picks.
  configFiles?: ConfigFile[];
  // All blob paths in the repository tree, used to report references to
  // files that exist but are not analyzed.
  repositoryPaths?: Iterable<string>;
};

// Relationships only connect files in `files`. Each file goes to the analyzer
// its language is registered with; external packages are dropped, a file
// referring to itself is ignored, and repeated identical references are
// reported once. The result is the same for every language, so the graph is
// built the same way whatever the repository contains.
export function analyzeModuleRelationships(
  files: AnalysisSource[],
  { configFiles = [], repositoryPaths }: AnalysisOptions = {},
): ModuleAnalysis {
  const repository: RepositoryContext = {
    sourcePaths: new Set(files.map((file) => file.path)),
    repositoryPaths: repositoryPaths === undefined ? undefined : new Set(repositoryPaths),
    configFiles,
  };

  const groups = new Map<AnalyzerId, AnalyzedFile[]>();
  for (const file of files) {
    const language = languageForExtension(file.extension);
    if (language === null) continue;
    const group = groups.get(language.analyzer) ?? [];
    group.push({ ...file, language: language.id });
    groups.set(language.analyzer, group);
  }

  const relationships = new Map<string, ModuleRelationship>();
  const unresolved = new Map<string, UnresolvedReference>();
  const skipped: SkippedAnalysis[] = [];

  const record = (sourcePath: string, { specifier, kind, resolution }: FileReference) => {
    if (resolution.status === "resolved") {
      if (resolution.path === sourcePath || !repository.sourcePaths.has(resolution.path)) return;
      const key = [sourcePath, resolution.path, kind, specifier].join("\0");
      relationships.set(key, { sourcePath, targetPath: resolution.path, kind, specifier });
    } else if (resolution.status === "unresolved") {
      const key = [sourcePath, specifier, kind].join("\0");
      unresolved.set(key, { sourcePath, specifier, kind, reason: resolution.reason });
    }
  };

  for (const [analyzer, group] of groups) {
    const result = ANALYZERS[analyzer](group, repository);
    for (const path of result.failed) skipped.push({ path, reason: "parse_failed" });
    for (const [sourcePath, references] of result.references) {
      for (const reference of references) record(sourcePath, reference);
    }
  }

  const sortedRelationships = [...relationships.values()].sort(
    (a, b) =>
      compareStrings(a.sourcePath, b.sourcePath) ||
      compareStrings(a.targetPath, b.targetPath) ||
      compareStrings(a.kind, b.kind) ||
      compareStrings(a.specifier, b.specifier),
  );
  const sortedUnresolved = [...unresolved.values()].sort(
    (a, b) =>
      compareStrings(a.sourcePath, b.sourcePath) ||
      compareStrings(a.specifier, b.specifier) ||
      compareStrings(a.kind, b.kind),
  );
  skipped.sort((a, b) => compareStrings(a.path, b.path));

  return {
    relationships: sortedRelationships,
    unresolved: sortedUnresolved,
    skipped,
    configs: readProjectConfigs(configFiles.filter((file) => isProjectConfigName(file.path))).statuses,
    stats: {
      filesAnalyzed: files.length - skipped.length,
      filesSkipped: skipped.length,
      relationships: sortedRelationships.length,
      unresolvedReferences: sortedUnresolved.length,
    },
  };
}
