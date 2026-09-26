// How one file refers to another, normalized across languages. The graph
// only needs "file A depends on file B"; the kind is kept for the inspector.
//
// import          import/use of a module, package or declared type
// reexport        a re-export (JavaScript `export ... from`, Dart `export`, Rust `pub use`)
// dynamic_import  JavaScript `import("...")` with a literal
// require         a runtime load by path or module name (require, require_relative, Lua require)
// include         textual inclusion (C/C++ #include, PHP include/require)
// module          module structure (Rust `mod x;`, Dart `part`/`part of`)
// reference       a declared type or module named in code without an import,
//                 resolved to exactly one declaring file
export const REFERENCE_KINDS = [
  "import",
  "reexport",
  "dynamic_import",
  "require",
  "include",
  "module",
  "reference",
] as const;

export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export type KindCounts = Record<ReferenceKind, number>;

export function emptyKindCounts(): KindCounts {
  return { import: 0, reexport: 0, dynamic_import: 0, require: 0, include: 0, module: 0, reference: 0 };
}
