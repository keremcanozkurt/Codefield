import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

describe("PHP", () => {
  it("detects .php files outside vendor", () => {
    assert.deepEqual(languagesOf(["index.php", "vendor/autoload.php"]), { "index.php": "php" });
  });

  it("resolves include and require with literal paths", () => {
    const analysis = analyzeFixture({
      "public/index.php": "<?php\nrequire_once __DIR__ . '/../bootstrap.php';\ninclude 'partials/header.php';\n",
      "public/partials/header.php": "<h1>Title</h1>",
      "bootstrap.php": "<?php require(dirname(__FILE__) . '/config.php');",
      "config.php": "<?php return [];",
    });

    assert.deepEqual(edges(analysis), [
      "bootstrap.php -> config.php",
      "public/index.php -> bootstrap.php",
      "public/index.php -> public/partials/header.php",
    ]);
  });

  it("resolves use imports through declared classes and PSR-4", () => {
    const analysis = analyzeFixture(
      {
        "src/Http/Controller.php": "<?php\nnamespace App\\Http;\n\nuse App\\Models\\User;\nuse App\\Services\\{Mailer, Billing as Bills};\n\nclass Controller {}\n",
        "src/Models/User.php": "<?php\nnamespace App\\Models;\nfinal class User {}\n",
        "src/Services/Mailer.php": "<?php\nnamespace App\\Services;\ninterface Mailer {}\n",
        // Found through composer.json, not a declaration: the file is empty.
        "src/Services/Billing.php": "<?php\n",
      },
      { configs: { "composer.json": JSON.stringify({ autoload: { "psr-4": { "App\\": "src/" } } }) } },
    );

    assert.deepEqual(edgesFrom(analysis, "src/Http/Controller.php"), [
      "src/Http/Controller.php -> src/Models/User.php",
      "src/Http/Controller.php -> src/Services/Billing.php",
      "src/Http/Controller.php -> src/Services/Mailer.php",
    ]);
  });

  it("resolves class names used in the same namespace and fully qualified names", () => {
    const analysis = analyzeFixture({
      "src/Order.php": "<?php\nnamespace Shop;\nclass Order extends Model {\n  public function total() { return new \\Shop\\Money\\Price(); }\n  public function tax() { return TaxRule::for($this); }\n}\n",
      "src/Model.php": "<?php namespace Shop; abstract class Model {}",
      "src/TaxRule.php": "<?php namespace Shop; class TaxRule {}",
      "src/Money/Price.php": "<?php namespace Shop\\Money; class Price {}",
    });

    assert.deepEqual(edgesFrom(analysis, "src/Order.php"), [
      "src/Order.php -> src/Model.php",
      "src/Order.php -> src/Money/Price.php",
      "src/Order.php -> src/TaxRule.php",
    ]);
  });

  it("ignores Composer packages and built-in classes", () => {
    const analysis = analyzeFixture({
      "app.php": "<?php\nuse Illuminate\\Support\\Str;\nuse Psr\\Log\\LoggerInterface;\n$d = new \\DateTime();\nrequire 'vendor/autoload.php';\n",
    }, { otherFiles: ["vendor/autoload.php"] });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), ["app.php: vendor/autoload.php (not_source)"]);
  });

  it("reports a missing class in a namespace the repository declares, and dynamic includes", () => {
    const analysis = analyzeFixture({
      "a.php": "<?php namespace App; use App\\Missing; include \"$dir/x.php\";",
      "b.php": "<?php namespace App; class B {}",
    });

    assert.deepEqual(unresolvedOf(analysis), ["a.php: $dir/x.php (unsupported_dynamic)", "a.php: App\\Missing (not_found)"]);
  });

  it("skips a class declared in two files and grouped use of functions", () => {
    const analysis = analyzeFixture({
      "a/Dup.php": "<?php namespace X; class Dup {}",
      "b/Dup.php": "<?php namespace X; class Dup {}",
      "c.php": "<?php use X\\Dup; use function X\\helper;",
    });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), ["c.php: X\\Dup (ambiguous)"]);
  });

  it("ignores HTML, comments, strings and heredocs, but not trait uses", () => {
    const analysis = analyzeFixture({
      "page.php": [
        "<p>require 'b.php';</p>",
        "<?php",
        "// require 'b.php';",
        "# require 'b.php';",
        "/* require 'b.php'; */",
        "$s = 'require \"b.php\";';",
        "$h = <<<EOT",
        "require 'b.php';",
        "EOT;",
        "#[Attribute]",
        "class Page { use Helpers; }",
        "?>",
        "<footer>include 'b.php'</footer>",
      ].join("\n"),
      "b.php": "<?php",
      "Helpers.php": "<?php trait Helpers {}",
    });

    assert.deepEqual(edges(analysis), ["page.php -> Helpers.php"]);
    assert.equal(analysis.relationships[0].kind, "reference");
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "bad.php": "<?php class { 'unterminated\nrequire 'ok.php';", "ok.php": "<?php" });

    assert.deepEqual(analysis.skipped, []);
  });
});
