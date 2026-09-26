import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

describe("Swift", () => {
  it("detects .swift files outside .build and Pods", () => {
    assert.deepEqual(languagesOf(["App.swift", ".build/x.swift", "Pods/Lib/y.swift"]), { "App.swift": "swift" });
  });

  it("resolves types used across files of one module, without imports", () => {
    const analysis = analyzeFixture({
      "App/ContentView.swift": "import SwiftUI\n\nstruct ContentView: View {\n  @StateObject var model = CartModel()\n}\n",
      "App/CartModel.swift": "import Foundation\n\nfinal class CartModel: ObservableObject {\n  var items: [Item] = []\n}\n",
      "App/Item.swift": "struct Item: Identifiable { let id: UUID }\n",
    });

    assert.deepEqual(edges(analysis), ["App/CartModel.swift -> App/Item.swift", "App/ContentView.swift -> App/CartModel.swift"]);
  });

  it("links an extension to the file that declares the type", () => {
    const analysis = analyzeFixture({
      "Item.swift": "struct Item {}\n",
      "Item+Formatting.swift": "extension Item {\n  var label: String { \"\" }\n}\n",
    });

    assert.deepEqual(edges(analysis), ["Item+Formatting.swift -> Item.swift"]);
  });

  it("keeps package targets separate unless one imports the other", () => {
    const analysis = analyzeFixture({
      "Package.swift": 'import PackageDescription\nlet package = Package(name: "Shop")\n',
      "Sources/Core/Money.swift": "public struct Money {}\n",
      "Sources/App/Main.swift": "import Core\nlet price = Money()\n",
      "Sources/Other/Uses.swift": "let m = Money()\n",
      "Tests/CoreTests/MoneyTests.swift": "@testable import Core\nfinal class MoneyTests { let m = Money() }\n",
    });

    assert.deepEqual(edges(analysis), [
      "Sources/App/Main.swift -> Sources/Core/Money.swift",
      "Tests/CoreTests/MoneyTests.swift -> Sources/Core/Money.swift",
    ]);
  });

  it("never turns an import into an edge and ignores framework types", () => {
    const analysis = analyzeFixture({ "A.swift": "import UIKit\nimport Combine\nclass A: UIViewController { let s = Set<AnyCancellable>() }\n" });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("skips types declared in several files and nested types", () => {
    const analysis = analyzeFixture({
      "One/Config.swift": "struct Config {}\n",
      "Two/Config.swift": "struct Config {}\n",
      "Outer.swift": "struct Outer { struct Inner {} }\n",
      "Use.swift": "let c = Config()\nlet i = Inner()\n",
    });

    assert.deepEqual(edgesFrom(analysis, "Use.swift"), []);
  });

  it("does not read class func or class var as declarations", () => {
    const analysis = analyzeFixture({
      "Factory.swift": "class Factory { class func make() -> Widget { Widget() } }\n",
      "Widget.swift": "class Widget {}\n",
    });

    assert.deepEqual(edges(analysis), ["Factory.swift -> Widget.swift"]);
  });

  it("ignores names in comments and strings", () => {
    const analysis = analyzeFixture({
      "A.swift": '// Helper\n/* /* Helper */ Helper */\nlet s = "Helper \\(x)"\nlet r = #"Helper"#\nlet m = """\nHelper\n"""\n',
      "Helper.swift": "struct Helper {}\n",
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "Bad.swift": 'struct Bad { let g = Good(\n"unterminated', "Good.swift": "struct Good {}" });

    assert.deepEqual(edges(analysis), ["Bad.swift -> Good.swift"]);
  });
});
