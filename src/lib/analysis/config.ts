import ts from "typescript";

import type { TreeEntry } from "../github/types.ts";
import { isIgnoredPath } from "../source-files.ts";
import { compareStrings, directoryOf, isRelativeSpecifier, joinRepositoryPath } from "./paths.ts";

export const MAX_CONFIG_FILE_BYTES = 64 * 1024;
export const MAX_CONFIG_FILES = 200;

// tsconfig.json and jsconfig.json apply to the files below them. Other names
// such as tsconfig.base.json are only read as `extends` targets.
const CONFIG_FILE_PATTERN = /^[jt]sconfig(\.[\w-]+)*\.json$/;
// TypeScript prefers tsconfig.json when both exist in one directory.
const PROJECT_CONFIG_NAMES = ["tsconfig.json", "jsconfig.json"];
const MAX_EXTENDS_DEPTH = 8;

export type ConfigCandidate = {
  path: string;
  sha: string;
  size: number;
};

export type ConfigFile = {
  path: string;
  content: string;
};

export type ConfigStatus = {
  path: string;
  valid: boolean;
};

export type PathAlias = {
  pattern: string;
  prefix: string;
  // Undefined for patterns without "*", which only match exactly.
  suffix: string | undefined;
  targets: string[];
};

export type AliasConfig = {
  configPath: string;
  // Repository directory from compilerOptions.baseUrl, or null when unset.
  baseUrl: string | null;
  paths: PathAlias[];
  // `paths` targets are relative to baseUrl when it is set, otherwise to the
  // directory of the config file that declares them.
  pathsBase: string;
};

export type ProjectConfigs = {
  configFor(sourcePath: string): AliasConfig | null;
  statuses: ConfigStatus[];
};

type RawConfig = {
  path: string;
  baseUrl?: string;
  paths?: PathAlias[];
  extends: string[];
};

export function isProjectConfigName(path: string): boolean {
  return CONFIG_FILE_PATTERN.test(path.slice(path.lastIndexOf("/") + 1));
}

// Manifests other analyzers read to map imports onto repository files. Only
// data files, or files whose relevant part is a plain literal, are listed;
// none of them is ever executed.
const MANIFEST_NAMES = new Set([
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "pubspec.yaml",
]);

export function isAuxiliaryFileName(name: string): boolean {
  return CONFIG_FILE_PATTERN.test(name) || MANIFEST_NAMES.has(name);
}

export function selectConfigFiles(entries: TreeEntry[]): ConfigCandidate[] {
  const candidates: ConfigCandidate[] = [];

  for (const entry of entries) {
    if (entry.type !== "blob" || entry.size === undefined) continue;
    if (entry.size > MAX_CONFIG_FILE_BYTES || isIgnoredPath(entry.path)) continue;

    const name = entry.path.slice(entry.path.lastIndexOf("/") + 1);
    if (!isAuxiliaryFileName(name)) continue;

    candidates.push({ path: entry.path, sha: entry.sha, size: entry.size });
  }

  candidates.sort((a, b) => compareStrings(a.path, b.path));
  return candidates.slice(0, MAX_CONFIG_FILES);
}

// Reads only compilerOptions.baseUrl, compilerOptions.paths and `extends`.
// `extends` is followed when it is a relative path to another loaded config
// file; package names such as "@tsconfig/next" are ignored. A config that
// cannot be parsed provides no aliases, and files under it fall back to
// relative resolution only.
export function readProjectConfigs(files: ConfigFile[]): ProjectConfigs {
  const loaded = new Set(files.map((file) => file.path));
  const parsed = new Map<string, RawConfig>();
  const statuses: ConfigStatus[] = [];

  for (const file of files) {
    const config = parseConfig(file);
    if (config !== null) parsed.set(file.path, config);
    statuses.push({ path: file.path, valid: config !== null });
  }
  statuses.sort((a, b) => compareStrings(a.path, b.path));

  function resolveExtends(from: string, target: string): string | null {
    if (!isRelativeSpecifier(target)) return null;
    const path = joinRepositoryPath(directoryOf(from), target);
    if (path === null) return null;
    if (loaded.has(path)) return path;
    return loaded.has(`${path}.json`) ? `${path}.json` : null;
  }

  // Configs ordered from highest to lowest precedence: the file itself, then
  // its `extends` entries, last one first.
  function chainOf(path: string, visiting: Set<string>): RawConfig[] {
    const config = parsed.get(path);
    if (config === undefined || visiting.has(path) || visiting.size >= MAX_EXTENDS_DEPTH) {
      return [];
    }

    visiting.add(path);
    const chain = [config];
    for (let i = config.extends.length - 1; i >= 0; i--) {
      const target = resolveExtends(path, config.extends[i]);
      if (target !== null) chain.push(...chainOf(target, visiting));
    }
    visiting.delete(path);
    return chain;
  }

  function effectiveConfig(path: string): AliasConfig | null {
    const chain = chainOf(path, new Set());
    if (chain.length === 0) return null;

    const baseUrlOwner = chain.find((config) => config.baseUrl !== undefined);
    let baseUrl: string | null = null;
    if (baseUrlOwner !== undefined) {
      baseUrl = joinRepositoryPath(directoryOf(baseUrlOwner.path), baseUrlOwner.baseUrl!);
      // A baseUrl outside the repository cannot resolve anything here.
      if (baseUrl === null) return null;
    }

    const pathsOwner = chain.find((config) => config.paths !== undefined);
    return {
      configPath: path,
      baseUrl,
      paths: pathsOwner?.paths ?? [],
      pathsBase: baseUrl ?? (pathsOwner ? directoryOf(pathsOwner.path) : directoryOf(path)),
    };
  }

  const byDirectory = new Map<string, AliasConfig | null>();

  function configFor(sourcePath: string): AliasConfig | null {
    const visited: string[] = [];
    let directory: string | null = directoryOf(sourcePath);
    let result: AliasConfig | null = null;

    while (directory !== null) {
      const cached = byDirectory.get(directory);
      if (cached !== undefined) {
        result = cached;
        break;
      }
      visited.push(directory);

      const prefix = directory === "" ? "" : `${directory}/`;
      const project = PROJECT_CONFIG_NAMES.map((name) => prefix + name).find((p) => loaded.has(p));
      if (project !== undefined) {
        result = effectiveConfig(project);
        break;
      }

      directory = directory === "" ? null : directoryOf(directory);
    }

    for (const entry of visited) byDirectory.set(entry, result);
    return result;
  }

  return { configFor, statuses };
}

function parseConfig(file: ConfigFile): RawConfig | null {
  let result: { config?: unknown; error?: ts.Diagnostic };
  try {
    // Accepts comments and trailing commas, as tsc does.
    result = ts.parseConfigFileTextToJson(file.path, file.content);
  } catch {
    return null;
  }
  if (result.error !== undefined || !isRecord(result.config)) return null;

  const { compilerOptions, extends: extendsValue } = result.config;
  const config: RawConfig = { path: file.path, extends: [] };

  if (typeof extendsValue === "string") {
    config.extends = [extendsValue];
  } else if (Array.isArray(extendsValue)) {
    config.extends = extendsValue.filter((value) => typeof value === "string");
  }

  if (isRecord(compilerOptions)) {
    if (typeof compilerOptions.baseUrl === "string") config.baseUrl = compilerOptions.baseUrl;
    if (isRecord(compilerOptions.paths)) config.paths = readPaths(compilerOptions.paths);
  }

  return config;
}

// TypeScript allows at most one "*" in a pattern and in each target. Entries
// that break this are skipped instead of invalidating the whole config.
function readPaths(paths: Record<string, unknown>): PathAlias[] {
  const aliases: PathAlias[] = [];

  for (const [pattern, value] of Object.entries(paths)) {
    if (!Array.isArray(value) || countWildcards(pattern) > 1) continue;

    const targets = value.filter(
      (target): target is string => typeof target === "string" && countWildcards(target) <= 1,
    );
    if (targets.length === 0) continue;

    const star = pattern.indexOf("*");
    aliases.push({
      pattern,
      prefix: star === -1 ? pattern : pattern.slice(0, star),
      suffix: star === -1 ? undefined : pattern.slice(star + 1),
      targets,
    });
  }

  return aliases;
}

function countWildcards(value: string): number {
  return value.split("*").length - 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
