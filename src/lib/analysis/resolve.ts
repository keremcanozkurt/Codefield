import type { AliasConfig, PathAlias } from "./config.ts";
import { directoryOf, isRelativeSpecifier, joinRepositoryPath } from "./paths.ts";

// Extensionless specifiers try these in order, first as "<path><ext>" and then
// as "<path>/index<ext>". A file therefore wins over a directory with the same
// name, as in TypeScript and Node.
export const RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"] as const;

// TypeScript lets "./x.js" refer to x.ts, which is how ESM packages written
// in TypeScript import each other. The literal .js file is still tried first.
const TYPESCRIPT_COUNTERPARTS: [string, string[]][] = [
  [".js", [".ts", ".tsx"]],
  [".jsx", [".tsx"]],
];

export type UnresolvedReason =
  // A repository-local specifier that matches no loaded source file.
  | "not_found"
  // It names a file that exists in the repository but was not analyzed, such
  // as a stylesheet, JSON, a declaration file, or a skipped source file.
  | "not_source"
  | "outside_repository"
  // Looks like a path alias, but no tsconfig.json or jsconfig.json maps it.
  | "unsupported_alias"
  // More than one repository file could be meant, so none is chosen.
  | "ambiguous"
  // Built at runtime, such as an interpolated string.
  | "unsupported_dynamic"
  // Syntax that names something Codefield does not map to files, such as a
  // wildcard import or a namespace.
  | "unsupported_resolution";

export type Resolution =
  | { status: "resolved"; path: string }
  | { status: "unresolved"; reason: UnresolvedReason }
  | { status: "external" };

export type ResolverOptions = {
  sourcePaths: ReadonlySet<string>;
  // Every file path in the repository tree. Only used to tell "not_source"
  // apart from "not_found".
  repositoryPaths?: ReadonlySet<string>;
  configFor?: (sourcePath: string) => AliasConfig | null;
};

export type ModuleResolver = (fromPath: string, specifier: string) => Resolution;

export function candidatePaths(target: string, directoryOnly = false): string[] {
  const candidates: string[] = [];

  if (!directoryOnly && target !== "") {
    candidates.push(target);
    for (const [extension, replacements] of TYPESCRIPT_COUNTERPARTS) {
      if (!target.endsWith(extension)) continue;
      const stem = target.slice(0, -extension.length);
      for (const replacement of replacements) candidates.push(stem + replacement);
    }
    for (const extension of RESOLUTION_EXTENSIONS) candidates.push(target + extension);
  }

  const prefix = target === "" ? "" : `${target}/`;
  for (const extension of RESOLUTION_EXTENSIONS) candidates.push(`${prefix}index${extension}`);

  return candidates;
}

export function createModuleResolver({
  sourcePaths,
  repositoryPaths,
  configFor,
}: ResolverOptions): ModuleResolver {
  function lookup(target: string, directoryOnly: boolean): Resolution {
    const candidates = candidatePaths(target, directoryOnly);
    const found = candidates.find((candidate) => sourcePaths.has(candidate));
    if (found !== undefined) return { status: "resolved", path: found };

    if (repositoryPaths !== undefined) {
      const prefix = target === "" ? "" : `${target}/`;
      const declarations = directoryOnly
        ? [`${prefix}index.d.ts`]
        : [`${target}.d.ts`, `${prefix}index.d.ts`];
      if ([...candidates, ...declarations].some((path) => repositoryPaths.has(path))) {
        return { status: "unresolved", reason: "not_source" };
      }
    }

    return { status: "unresolved", reason: "not_found" };
  }

  function resolveAlias(config: AliasConfig, alias: PathAlias, captured: string): Resolution {
    let local = 0;
    let escaped = 0;
    let notSource = false;

    for (const target of alias.targets) {
      // Absolute targets point outside the repository model.
      if (target.startsWith("/")) {
        escaped++;
        continue;
      }
      const substituted = target.replace("*", captured);
      const path = joinRepositoryPath(config.pathsBase, substituted);
      if (path === null) {
        escaped++;
        continue;
      }
      // Targets inside node_modules map to packages, which are never analyzed.
      if (path.split("/").includes("node_modules")) continue;

      local++;
      const result = lookup(path, isDirectorySpecifier(substituted));
      if (result.status === "resolved") return result;
      if (result.status === "unresolved" && result.reason === "not_source") notSource = true;
    }

    if (notSource) return { status: "unresolved", reason: "not_source" };
    if (local > 0) return { status: "unresolved", reason: "not_found" };
    if (escaped > 0) return { status: "unresolved", reason: "outside_repository" };
    return { status: "external" };
  }

  return function resolve(fromPath, specifier) {
    if (isRelativeSpecifier(specifier)) {
      const target = joinRepositoryPath(directoryOf(fromPath), specifier);
      if (target === null) return { status: "unresolved", reason: "outside_repository" };
      return lookup(target, isDirectorySpecifier(specifier));
    }

    const config = configFor?.(fromPath) ?? null;
    let aliasFailure: Resolution | null = null;

    if (config !== null) {
      const match = matchAlias(config.paths, specifier);
      if (match !== null) {
        const result = resolveAlias(config, match.alias, match.captured);
        if (result.status === "resolved") return result;
        // A bare "*" pattern matches every specifier, including packages, so
        // a miss there says nothing about the specifier being local.
        if (match.alias.pattern !== "*" && result.status === "unresolved") aliasFailure = result;
      }

      // Like TypeScript, fall back to baseUrl after `paths`. Bare package
      // names reach this lookup too, so a miss is not reported.
      if (config.baseUrl !== null && !specifier.startsWith("/")) {
        const path = joinRepositoryPath(config.baseUrl, specifier);
        if (path !== null) {
          const result = lookup(path, isDirectorySpecifier(specifier));
          if (result.status === "resolved") return result;
        }
      }
    }

    if (aliasFailure !== null) return aliasFailure;
    if (looksLikeAlias(specifier)) return { status: "unresolved", reason: "unsupported_alias" };
    return { status: "external" };
  };
}

// Exact patterns win; otherwise the wildcard pattern with the longest prefix,
// matching TypeScript's rule.
function matchAlias(
  aliases: PathAlias[],
  specifier: string,
): { alias: PathAlias; captured: string } | null {
  let best: { alias: PathAlias; captured: string } | null = null;

  for (const alias of aliases) {
    if (alias.suffix === undefined) {
      if (alias.pattern === specifier) return { alias, captured: "" };
      continue;
    }

    const { prefix, suffix } = alias;
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      (best === null || prefix.length > best.alias.prefix.length)
    ) {
      best = { alias, captured: specifier.slice(prefix.length, specifier.length - suffix.length) };
    }
  }

  return best;
}

function isDirectorySpecifier(specifier: string): boolean {
  const last = specifier.slice(specifier.lastIndexOf("/") + 1);
  return last === "" || last === "." || last === "..";
}

// "@/x" and "~/x" cannot be npm package names, "#x" is a package.json
// subpath import, and "/x" is resolved from the project root by some bundlers.
// None of these are external packages, but only tsconfig/jsconfig paths are
// supported for resolving them.
function looksLikeAlias(specifier: string): boolean {
  return (
    specifier.startsWith("@/") ||
    specifier.startsWith("~/") ||
    specifier.startsWith("#") ||
    specifier.startsWith("/")
  );
}
