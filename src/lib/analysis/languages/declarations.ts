import type { FileReference } from "../analyzer.ts";
import { resolved, unresolved } from "../analyzer.ts";

// A repository-wide index of declared type names for languages whose imports
// name types or namespaces rather than files (Java, Kotlin, Scala, C#, PHP,
// Swift, Elixir). A qualified name maps to the files declaring it; more than
// one file (duplicates, or C# partial classes) makes it ambiguous.
export class DeclarationIndex {
  private readonly byQualified = new Map<string, Set<string>>();
  private readonly namespaces = new Set<string>();
  private readonly bySimple = new Map<string, Set<string>>();

  private readonly separator: string;
  private readonly caseInsensitive: boolean;

  constructor(separator: string, caseInsensitive = false) {
    this.separator = separator;
    this.caseInsensitive = caseInsensitive;
  }

  private key(name: string): string {
    return this.caseInsensitive ? name.toLowerCase() : name;
  }

  add(namespace: string, name: string, file: string) {
    const qualified = namespace === "" ? name : `${namespace}${this.separator}${name}`;
    const key = this.key(qualified);
    const files = this.byQualified.get(key) ?? new Set();
    files.add(file);
    this.byQualified.set(key, files);
    const simple = this.bySimple.get(this.key(name)) ?? new Set();
    simple.add(qualified);
    this.bySimple.set(this.key(name), simple);
    let prefix = namespace;
    while (prefix !== "") {
      this.namespaces.add(this.key(prefix));
      const cut = prefix.lastIndexOf(this.separator);
      prefix = cut === -1 ? "" : prefix.slice(0, cut);
    }
  }

  // The files declaring exactly this qualified name.
  files(qualified: string): Set<string> | undefined {
    return this.byQualified.get(this.key(qualified));
  }

  hasNamespace(namespace: string): boolean {
    return this.namespaces.has(this.key(namespace));
  }

  // Qualified names declared with this simple name.
  qualifiedNames(simple: string): Set<string> | undefined {
    return this.bySimple.get(this.key(simple));
  }

  // Resolves a qualified name to its one declaring file, or null when it is
  // not declared here. With allowTrailing, trailing parts are dropped while
  // what remains ends in a capitalized name, so a.b.Outer.Inner and
  // a.b.Type.member find a.b.Outer and a.b.Type, but a.b.c never becomes a.b.
  lookup(parts: string[], allowTrailing = true): FileReference["resolution"] | null {
    for (let length = parts.length; length >= (allowTrailing ? 1 : parts.length); length--) {
      if (length < parts.length && !/^[A-Z]/.test(parts[length - 1])) break;
      const files = this.files(parts.slice(0, length).join(this.separator));
      if (files !== undefined) return files.size === 1 ? resolved([...files][0]) : unresolved("ambiguous");
    }
    return null;
  }

  // The one type named `simple` among the given namespaces, if exactly one of
  // them declares it and a single file declares that type.
  inNamespaces(simple: string, namespaces: Iterable<string>): string | "ambiguous" | null {
    const candidates = new Set<string>();
    for (const namespace of namespaces) {
      const qualified = namespace === "" ? simple : `${namespace}${this.separator}${simple}`;
      const files = this.files(qualified);
      if (files === undefined) continue;
      if (files.size > 1) return "ambiguous";
      candidates.add([...files][0]);
    }
    if (candidates.size === 0) return null;
    return candidates.size === 1 ? [...candidates][0] : "ambiguous";
  }
}
