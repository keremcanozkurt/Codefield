import type { SourceFile } from "../source-files.ts";
import { readProjectConfigs, type ConfigFile, type ConfigStatus } from "./config.ts";
import { extractModuleReferences, type ReferenceKind } from "./imports.ts";
import { compareStrings } from "./paths.ts";
import { createModuleResolver, type UnresolvedReason } from "./resolve.ts";

export type AnalysisSource = Pick<SourceFile, "path" | "content" | "extension">;

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
  configFiles?: ConfigFile[];
  // All blob paths in the repository tree, used to report references to
  // files that exist but are not analyzed.
  repositoryPaths?: Iterable<string>;
};

// Relationships only connect files in `files`. External packages are dropped,
// a file referring to itself is ignored, and repeated identical references
// are reported once.
export function analyzeModuleRelationships(
  files: AnalysisSource[],
  { configFiles = [], repositoryPaths }: AnalysisOptions = {},
): ModuleAnalysis {
  const configs = readProjectConfigs(configFiles);
  const resolve = createModuleResolver({
    sourcePaths: new Set(files.map((file) => file.path)),
    repositoryPaths: repositoryPaths === undefined ? undefined : new Set(repositoryPaths),
    configFor: configs.configFor,
  });

  const relationships = new Map<string, ModuleRelationship>();
  const unresolved = new Map<string, UnresolvedReference>();
  const skipped: SkippedAnalysis[] = [];

  for (const file of files) {
    let references;
    try {
      references = extractModuleReferences(file.path, file.content, file.extension);
    } catch {
      skipped.push({ path: file.path, reason: "parse_failed" });
      continue;
    }

    for (const { specifier, kind } of references) {
      const result = resolve(file.path, specifier);

      if (result.status === "resolved") {
        if (result.path === file.path) continue;
        const key = [file.path, result.path, kind, specifier].join("\0");
        relationships.set(key, { sourcePath: file.path, targetPath: result.path, kind, specifier });
      } else if (result.status === "unresolved") {
        const key = [file.path, specifier, kind].join("\0");
        unresolved.set(key, { sourcePath: file.path, specifier, kind, reason: result.reason });
      }
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
    configs: configs.statuses,
    stats: {
      filesAnalyzed: files.length - skipped.length,
      filesSkipped: skipped.length,
      relationships: sortedRelationships.length,
      unresolvedReferences: sortedUnresolved.length,
    },
  };
}
