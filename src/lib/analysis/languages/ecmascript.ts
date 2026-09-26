import type { LanguageAnalyzer } from "../analyzer.ts";
import { readEach } from "../analyzer.ts";
import { isProjectConfigName, readProjectConfigs } from "../config.ts";
import { extractModuleReferences, type EcmaScriptExtension } from "../imports.ts";
import { createModuleResolver } from "../resolve.ts";

// TypeScript and JavaScript: the TypeScript compiler's parser for imports,
// re-exports, require and literal dynamic import(), resolved with Node/TypeScript
// rules and tsconfig.json/jsconfig.json baseUrl and paths.
export const analyzeEcmaScript: LanguageAnalyzer = (files, repository) => {
  const configs = readProjectConfigs(repository.configFiles.filter((file) => isProjectConfigName(file.path)));
  const resolve = createModuleResolver({
    sourcePaths: repository.sourcePaths,
    repositoryPaths: repository.repositoryPaths,
    configFor: configs.configFor,
  });

  const { parsed, failed } = readEach(files, (file) =>
    extractModuleReferences(file.path, file.content, file.extension as EcmaScriptExtension),
  );

  const references = new Map(
    parsed.map(({ file, value }) => [
      file.path,
      value.map(({ specifier, kind }) => ({ specifier, kind, resolution: resolve(file.path, specifier) })),
    ]),
  );
  return { references, failed };
};
