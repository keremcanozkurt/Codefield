import ts from "typescript";

import type { SourceExtension } from "../source-files.ts";
import type { ReferenceKind } from "./kinds.ts";

export type { ReferenceKind } from "./kinds.ts";

export type ModuleReference = {
  specifier: string;
  kind: ReferenceKind;
};

export type EcmaScriptExtension = Extract<SourceExtension, ".ts" | ".tsx" | ".js" | ".jsx">;

const SCRIPT_KINDS: Record<EcmaScriptExtension, ts.ScriptKind> = {
  ".ts": ts.ScriptKind.TS,
  ".tsx": ts.ScriptKind.TSX,
  ".js": ts.ScriptKind.JS,
  ".jsx": ts.ScriptKind.JSX,
};

// Parses a single file without a Program, so nothing is type-checked and no
// other file is read. The parser recovers from most syntax errors and still
// returns a tree; it throws only in rare cases such as very deep nesting, which
// the caller handles.
export function extractModuleReferences(
  path: string,
  content: string,
  extension: EcmaScriptExtension,
): ModuleReference[] {
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    false,
    SCRIPT_KINDS[extension],
  );

  const references: ModuleReference[] = [];
  const stack: ts.Node[] = [sourceFile];

  // Iterative walk, since deeply nested code that the parser accepted could
  // still exhaust the stack in a recursive one.
  while (stack.length > 0) {
    const node = stack.pop()!;
    const reference = referenceFrom(node);
    if (reference !== null) references.push(reference);

    const children: ts.Node[] = [];
    ts.forEachChild(node, (child) => {
      children.push(child);
    });
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
  }

  return references;
}

function referenceFrom(node: ts.Node): ModuleReference | null {
  if (ts.isImportDeclaration(node)) {
    return literalReference(node.moduleSpecifier, "import");
  }

  if (ts.isExportDeclaration(node)) {
    return node.moduleSpecifier ? literalReference(node.moduleSpecifier, "reexport") : null;
  }

  // import x = require("./x")
  if (ts.isImportEqualsDeclaration(node)) {
    const reference = node.moduleReference;
    return ts.isExternalModuleReference(reference)
      ? literalReference(reference.expression, "require")
      : null;
  }

  if (ts.isCallExpression(node)) {
    const [argument] = node.arguments;
    if (argument === undefined) return null;

    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      return literalReference(argument, "dynamic_import");
    }
    if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
      return literalReference(argument, "require");
    }
  }

  return null;
}

// Only plain string literals and templates without substitutions count.
// Anything computed at runtime is skipped rather than guessed.
function literalReference(
  expression: ts.Expression,
  kind: ReferenceKind,
): ModuleReference | null {
  if (!ts.isStringLiteralLike(expression) || expression.text === "") return null;
  return { specifier: expression.text, kind };
}
