import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

const cargo = { "Cargo.toml": '[package]\nname = "shop-core"\nversion = "0.1.0"\nauthors = ["A"]\n\n[dependencies]\nserde = "1"\n' };

describe("Rust", () => {
  it("detects .rs files outside target", () => {
    assert.deepEqual(languagesOf(["src/lib.rs", "target/debug/build/out.rs"]), { "src/lib.rs": "rust" });
  });

  it("follows mod declarations to name.rs and name/mod.rs", () => {
    const analysis = analyzeFixture(
      {
        "src/lib.rs": "pub mod cart;\nmod storage;\n",
        "src/cart.rs": "mod pricing;\n",
        "src/cart/pricing.rs": "",
        "src/storage/mod.rs": "pub mod disk;\n",
        "src/storage/disk.rs": "",
      },
      { configs: cargo },
    );

    assert.deepEqual(edges(analysis), [
      "src/cart.rs -> src/cart/pricing.rs",
      "src/lib.rs -> src/cart.rs",
      "src/lib.rs -> src/storage/mod.rs",
      "src/storage/mod.rs -> src/storage/disk.rs",
    ]);
    assert.ok(analysis.relationships.every((r) => r.kind === "module"));
  });

  it("resolves crate::, self:: and super:: paths to the longest module prefix", () => {
    const analysis = analyzeFixture(
      {
        "src/lib.rs": "mod cart;\nmod money;\npub use money::Price;\n",
        "src/money.rs": "pub struct Price;\n",
        "src/cart.rs": "mod line;\nuse crate::money::Price;\nuse self::line::Line;\n",
        "src/cart/line.rs": "use super::super::money::{self, Price as P};\nuse crate::Price;\n",
      },
      { configs: cargo },
    );

    assert.deepEqual(edgesFrom(analysis, "src/cart.rs"), ["src/cart.rs -> src/cart/line.rs", "src/cart.rs -> src/money.rs"]);
    assert.deepEqual(edgesFrom(analysis, "src/cart/line.rs"), ["src/cart/line.rs -> src/lib.rs", "src/cart/line.rs -> src/money.rs"]);
    const reexport = analysis.relationships.find((r) => r.sourcePath === "src/lib.rs" && r.targetPath === "src/money.rs" && r.kind === "reexport");
    assert.ok(reexport);
  });

  it("resolves other crates of the workspace by package name", () => {
    const analysis = analyzeFixture(
      {
        "core/src/lib.rs": "pub mod api;\n",
        "core/src/api.rs": "",
        "cli/src/main.rs": "use shop_core::api::Client;\nuse std::io;\n",
        "core/tests/smoke.rs": "use shop_core::api;\n",
      },
      { configs: { "core/Cargo.toml": cargo["Cargo.toml"], "cli/Cargo.toml": '[package]\nname = "cli"\n' } },
    );

    assert.deepEqual(edges(analysis), [
      "cli/src/main.rs -> core/src/api.rs",
      "core/src/lib.rs -> core/src/api.rs",
      "core/tests/smoke.rs -> core/src/api.rs",
    ]);
  });

  it("ignores std and external crates", () => {
    const analysis = analyzeFixture({ "src/main.rs": "use std::collections::HashMap;\nuse serde::{Deserialize, Serialize};\nextern crate log;\n" }, { configs: cargo });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("reports a mod declaration without a file", () => {
    const analysis = analyzeFixture({ "src/lib.rs": "mod missing;\nmod inline { fn f() {} }\n" }, { configs: cargo });

    assert.deepEqual(unresolvedOf(analysis), ["src/lib.rs: mod missing (not_found)"]);
  });

  it("skips a module that exists as both name.rs and name/mod.rs", () => {
    const analysis = analyzeFixture({ "src/lib.rs": "mod a;\n", "src/a.rs": "", "src/a/mod.rs": "" }, { configs: cargo });

    assert.deepEqual(unresolvedOf(analysis), ["src/lib.rs: mod a (ambiguous)"]);
  });

  it("handles #[path], inline modules and use groups", () => {
    const analysis = analyzeFixture(
      {
        "src/main.rs": '#[path = "platform/linux.rs"]\nmod os;\nmod net {\n    pub mod http;\n}\nuse crate::{os::open, net::http::{get, post}};\n',
        "src/platform/linux.rs": "",
        "src/net/http.rs": "",
      },
      { configs: cargo },
    );

    assert.deepEqual(edgesFrom(analysis, "src/main.rs"), ["src/main.rs -> src/net/http.rs", "src/main.rs -> src/platform/linux.rs"]);
  });

  it("ignores mod and use in comments, strings and raw strings", () => {
    const analysis = analyzeFixture(
      {
        "src/lib.rs": '// mod a;\n/* /* nested */ mod a; */\nconst S: &str = "mod a;";\nconst R: &str = r#"mod a;"#;\nfn f<\'a>(x: &\'a str) -> char { \'"\' }\nmod b;\n',
        "src/a.rs": "",
        "src/b.rs": "",
      },
      { configs: cargo },
    );

    assert.deepEqual(edges(analysis), ["src/lib.rs -> src/b.rs"]);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "src/lib.rs": 'mod ok;\nfn broken( { "unterminated', "src/ok.rs": "" }, { configs: cargo });

    assert.deepEqual(edges(analysis), ["src/lib.rs -> src/ok.rs"]);
  });
});
