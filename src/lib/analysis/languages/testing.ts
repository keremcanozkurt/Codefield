// Helpers for the language analyzer tests: run the real repository pipeline
// on a small in-memory repository and read the result as edge strings.
import { languageForExtension } from "../../languages/registry.ts";
import { selectSourceFiles } from "../../source-files.ts";
import { analyzeModuleRelationships, type ModuleAnalysis } from "../relationships.ts";

export type Fixture = Record<string, string>;

export function analyzeFixture(
  sources: Fixture,
  { configs = {}, otherFiles = [] }: { configs?: Fixture; otherFiles?: string[] } = {},
): ModuleAnalysis {
  const files = Object.entries(sources).map(([path, content]) => {
    const extension = path.slice(path.lastIndexOf("."));
    if (languageForExtension(extension) === null) throw new Error(`not a source file: ${path}`);
    return { path, content, extension: extension as never };
  });
  return analyzeModuleRelationships(files, {
    configFiles: Object.entries(configs).map(([path, content]) => ({ path, content })),
    repositoryPaths: [...Object.keys(sources), ...Object.keys(configs), ...otherFiles],
  });
}

// "a -> b" for every relationship, sorted.
export function edges(analysis: ModuleAnalysis): string[] {
  return [...new Set(analysis.relationships.map((r) => `${r.sourcePath} -> ${r.targetPath}`))].sort();
}

export function edgesFrom(analysis: ModuleAnalysis, path: string): string[] {
  return edges(analysis).filter((edge) => edge.startsWith(`${path} -> `));
}

// "path: specifier (reason)" for every unresolved reference.
export function unresolvedOf(analysis: ModuleAnalysis): string[] {
  return analysis.unresolved.map((u) => `${u.sourcePath}: ${u.specifier} (${u.reason})`);
}

export function languagesOf(paths: string[]): Record<string, string> {
  const blobs = paths.map((path) => ({ path, type: "blob" as const, sha: path, size: 10 }));
  return Object.fromEntries(selectSourceFiles(blobs).candidates.map((c) => [c.path, c.language]));
}
