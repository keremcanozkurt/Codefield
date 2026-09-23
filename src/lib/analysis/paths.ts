// Repository paths are always "/"-separated and relative to the repository
// root, with no leading "./". These helpers never use node:path, so the result
// does not depend on the host operating system.

export function directoryOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

// Resolves `relative` against the repository directory `base`. Returns null
// when the result would leave the repository root.
export function joinRepositoryPath(base: string, relative: string): string | null {
  const segments = base === "" ? [] : base.split("/");

  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }

  return segments.join("/");
}

export function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === "." ||
    specifier === ".." ||
    specifier.startsWith("./") ||
    specifier.startsWith("../")
  );
}

// Code-unit comparison, so ordering does not depend on the server's locale.
export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
