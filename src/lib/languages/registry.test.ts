import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ANALYZERS } from "../analysis/analyzers.ts";
import { LANGUAGE_COLORS } from "../visualization/theme.ts";
import {
  compareLanguages,
  isLanguageId,
  LANGUAGE_IDS,
  LANGUAGES,
  languageForExtension,
  languageName,
  SOURCE_EXTENSIONS,
} from "./registry.ts";

describe("language registry", () => {
  it("maps every extension to exactly one language", () => {
    const owners = new Map<string, string[]>();
    for (const language of LANGUAGES) {
      for (const extension of language.extensions) owners.set(extension, [...(owners.get(extension) ?? []), language.id]);
    }
    for (const [extension, languages] of owners) assert.equal(languages.length, 1, `${extension}: ${languages.join(", ")}`);
    for (const extension of SOURCE_EXTENSIONS) assert.equal(languageForExtension(extension)?.extensions.includes(extension as never), true);
  });

  it("has unique IDs and display names", () => {
    assert.equal(new Set(LANGUAGE_IDS).size, LANGUAGES.length);
    assert.equal(new Set(LANGUAGES.map((l) => l.name)).size, LANGUAGES.length);
  });

  it("gives every language an analyzer and a color", () => {
    for (const language of LANGUAGES) {
      assert.equal(typeof ANALYZERS[language.analyzer], "function", language.id);
      assert.ok(LANGUAGE_COLORS[language.id], language.id);
    }
  });

  it("covers the supported set, and nothing else", () => {
    assert.deepEqual(
      [...SOURCE_EXTENSIONS].sort(),
      [".c", ".cc", ".cpp", ".cs", ".cxx", ".dart", ".ex", ".exs", ".go", ".h", ".hh", ".hpp", ".hxx", ".java", ".js", ".jsx", ".kt", ".kts", ".lua", ".php", ".py", ".rb", ".rs", ".sc", ".scala", ".swift", ".ts", ".tsx"],
    );
    for (const extension of [".m", ".pyc", ".json", ".TS", ".d", ""]) assert.equal(languageForExtension(extension), null, extension);
  });

  it("names languages and orders them by registry position", () => {
    assert.equal(languageName("csharp"), "C#");
    assert.equal(languageName("cpp"), "C++");
    assert.ok(isLanguageId("rust") && !isLanguageId("cobol"));
    assert.deepEqual(["swift", "typescript", "python"].sort((a, b) => compareLanguages(a as never, b as never)), ["typescript", "python", "swift"]);
  });
});
