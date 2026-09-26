import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

describe("C#", () => {
  it("detects .cs files outside obj", () => {
    assert.deepEqual(languagesOf(["Program.cs", "obj/Debug/GlobalUsings.g.cs", "bin/Tool.cs"]), { "Program.cs": "csharp", "bin/Tool.cs": "csharp" });
  });

  it("never turns a namespace using into edges to the namespace's files", () => {
    const analysis = analyzeFixture({
      "Models/User.cs": "namespace Shop.Models;\npublic class User {}\n",
      "Models/Order.cs": "namespace Shop.Models;\npublic class Order {}\n",
      "Models/Audit.cs": "namespace Shop.Models;\npublic class Audit {}\n",
      "Program.cs": "using Shop.Models;\n\nvar u = new User();\n",
    });

    assert.deepEqual(edges(analysis), ["Program.cs -> Models/User.cs"]);
    assert.equal(analysis.relationships[0].kind, "reference");
  });

  it("resolves using static and using aliases to the declaring file", () => {
    const analysis = analyzeFixture({
      "Util/Guard.cs": "namespace Shop.Util { public static class Guard { } }\n",
      "Util/Clock.cs": "namespace Shop.Util { public sealed record Clock(); }\n",
      "App.cs": "using static Shop.Util.Guard;\nusing Time = Shop.Util.Clock;\nclass App {}\n",
    });

    assert.deepEqual(edgesFrom(analysis, "App.cs"), ["App.cs -> Util/Clock.cs", "App.cs -> Util/Guard.cs"]);
    assert.ok(analysis.relationships.every((r) => r.kind === "import"));
  });

  it("finds types in enclosing namespaces and through several hops", () => {
    const analysis = analyzeFixture({
      "Core/Entity.cs": "namespace Shop.Core { public abstract class Entity {} }\n",
      "Core/Data/Repo.cs": "namespace Shop.Core.Data { class Repo<T> where T : Entity {} }\n",
      "Web/Controller.cs": "namespace Shop.Web { class Controller { Core.Data.Repo<int> r; } }\n",
    });

    assert.deepEqual(edges(analysis), ["Core/Data/Repo.cs -> Core/Entity.cs", "Web/Controller.cs -> Core/Data/Repo.cs"]);
  });

  it("uses global usings within their project only", () => {
    const analysis = analyzeFixture(
      {
        "Api/Usings.cs": "global using Shop.Domain;\n",
        "Api/Handler.cs": "namespace Api; class Handler { Money m; }\n",
        "Worker/Job.cs": "namespace Worker; class Job { Money m; }\n",
        "Domain/Money.cs": "namespace Shop.Domain; public readonly struct Money {}\n",
      },
      { otherFiles: ["Api/Api.csproj", "Worker/Worker.csproj", "Domain/Domain.csproj"] },
    );

    assert.deepEqual(edges(analysis), ["Api/Handler.cs -> Domain/Money.cs"]);
  });

  it("ignores .NET and NuGet types", () => {
    const analysis = analyzeFixture({
      "A.cs": "using System;\nusing System.Collections.Generic;\nusing Newtonsoft.Json;\nclass A { List<string> x; DateTime d; JsonConvert j; }\n",
    });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("reports a missing static type in a known namespace", () => {
    const analysis = analyzeFixture({
      "A.cs": "namespace Shop; class A {}\n",
      "B.cs": "using static Shop.Missing;\nclass B {}\n",
    });

    assert.deepEqual(unresolvedOf(analysis), ["B.cs: Shop.Missing (not_found)"]);
  });

  it("skips partial classes and names found in two using namespaces", () => {
    const analysis = analyzeFixture({
      "Form.cs": "namespace Ui; public partial class Form {}\n",
      "Form.Designer.cs": "namespace Ui; partial class Form {}\n",
      "A/Node.cs": "namespace A; class Node {}\n",
      "B/Node.cs": "namespace B; class Node {}\n",
      "Use.cs": "using A;\nusing B;\nusing Ui;\nclass Use { Node n; Form f; }\n",
    });

    assert.deepEqual(edgesFrom(analysis, "Use.cs"), []);
  });

  it("prefers the enclosing namespace over a using, like the compiler", () => {
    const analysis = analyzeFixture({
      "Shop/Logger.cs": "namespace Shop; class Logger {}\n",
      "Lib/Logger.cs": "namespace Lib; class Logger {}\n",
      "Shop/Service.cs": "using Lib;\nnamespace Shop;\nclass Service { Logger l; }\n",
    });

    assert.deepEqual(edgesFrom(analysis, "Shop/Service.cs"), ["Shop/Service.cs -> Shop/Logger.cs"]);
  });

  it("ignores names in comments, strings, verbatim and raw strings, and using statements", () => {
    const analysis = analyzeFixture({
      "Helper.cs": "namespace P; class Helper {}\n",
      "A.cs": 'namespace P;\n// Helper\nclass A {\n  string a = "Helper";\n  string b = @"say ""Helper""";\n  string c = """\nHelper\n""";\n  void F() { using (var s = Open()) {} }\n}\n',
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("keeps going after malformed code", () => {
    const analysis = analyzeFixture({ "Bad.cs": 'namespace P; class Bad { Good g; "unterminated', "Good.cs": "namespace P; class Good {}" });

    assert.deepEqual(edges(analysis), ["Bad.cs -> Good.cs"]);
  });
});
