import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { analyzeFixture, edges, edgesFrom, languagesOf, unresolvedOf } from "./testing.ts";

describe("Python", () => {
  it("detects .py files", () => {
    assert.deepEqual(languagesOf(["app/main.py", "app/main.pyc", "setup.py"]), {
      "app/main.py": "python",
      "setup.py": "python",
    });
  });

  it("resolves absolute imports of packages and modules", () => {
    const analysis = analyzeFixture({
      "app/__init__.py": "",
      "app/service.py": "import app.repository\nfrom app import models\n",
      "app/repository.py": "from app.db import connect\n",
      "app/db.py": "",
      "app/models/__init__.py": "",
    });

    assert.deepEqual(edges(analysis), [
      "app/repository.py -> app/db.py",
      "app/service.py -> app/models/__init__.py",
      "app/service.py -> app/repository.py",
    ]);
  });

  it("resolves relative imports, including through parent packages", () => {
    const analysis = analyzeFixture({
      "pkg/__init__.py": "from . import core\n",
      "pkg/core.py": "from .util import helper\nfrom ..outside import x\n",
      "pkg/util.py": "",
      "pkg/sub/__init__.py": "",
      "pkg/sub/leaf.py": "from .. import util\nfrom ..core import thing\n",
    });

    assert.deepEqual(edges(analysis), [
      "pkg/__init__.py -> pkg/core.py",
      "pkg/core.py -> pkg/util.py",
      "pkg/sub/leaf.py -> pkg/core.py",
      "pkg/sub/leaf.py -> pkg/util.py",
    ]);
    assert.deepEqual(unresolvedOf(analysis), ["pkg/core.py: ..outside (not_found)"]);
  });

  it("supports the src layout", () => {
    const analysis = analyzeFixture({
      "src/shop/__init__.py": "",
      "src/shop/cart.py": "from shop.pricing import total\n",
      "src/shop/pricing.py": "",
      "tests/test_cart.py": "import shop.cart\n",
    });

    assert.deepEqual(edges(analysis), [
      "src/shop/cart.py -> src/shop/pricing.py",
      "tests/test_cart.py -> src/shop/cart.py",
    ]);
  });

  it("ignores the standard library and installed packages", () => {
    const analysis = analyzeFixture({
      "app.py": "import os, sys\nimport numpy as np\nfrom collections import OrderedDict\nfrom django.db import models\n",
    });

    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), []);
  });

  it("reports a local package module that does not exist", () => {
    const analysis = analyzeFixture({
      "app/__init__.py": "",
      "app/main.py": "import app.missing\n",
    });

    assert.deepEqual(unresolvedOf(analysis), ["app/main.py: app.missing (not_found)"]);
  });

  it("points `from package import name` at a submodule, or else at the package", () => {
    const analysis = analyzeFixture({
      "lib/__init__.py": "from .settings import DEBUG\n",
      "lib/settings.py": "",
      "lib/views.py": "",
      "main.py": "from lib import views, DEBUG\n",
    });

    assert.deepEqual(edgesFrom(analysis, "main.py"), ["main.py -> lib/__init__.py", "main.py -> lib/views.py"]);
  });

  it("skips a module found under two import roots", () => {
    const analysis = analyzeFixture({
      "utils.py": "",
      "src/utils.py": "",
      "main.py": "import utils\n",
      "tools/run.py": "import utils\n",
    });

    // main.py sits in the repository root, so both roots apply to it too.
    assert.deepEqual(edges(analysis), []);
    assert.deepEqual(unresolvedOf(analysis), ["main.py: utils (ambiguous)", "tools/run.py: utils (ambiguous)"]);
  });

  it("imports a sibling module next to a script", () => {
    const analysis = analyzeFixture({ "scripts/run.py": "import helpers\n", "scripts/helpers.py": "" });

    assert.deepEqual(edges(analysis), ["scripts/run.py -> scripts/helpers.py"]);
  });

  it("ignores imports in strings, comments and docstrings", () => {
    const analysis = analyzeFixture({
      "a.py": '"""\nimport b\n"""\n# import b\nx = "import b"\ny = f"from b import c"\n',
      "b.py": "",
    });

    assert.deepEqual(edges(analysis), []);
  });

  it("reads multi-line and parenthesized imports", () => {
    const analysis = analyzeFixture({
      "pkg/__init__.py": "",
      "pkg/a.py": "from pkg import (\n    b,\n    c,  # comment\n)\nimport pkg.d \\\n    as d; import pkg.e\n",
      "pkg/b.py": "",
      "pkg/c.py": "",
      "pkg/d.py": "",
      "pkg/e.py": "",
    });

    assert.deepEqual(edgesFrom(analysis, "pkg/a.py"), [
      "pkg/a.py -> pkg/b.py",
      "pkg/a.py -> pkg/c.py",
      "pkg/a.py -> pkg/d.py",
      "pkg/a.py -> pkg/e.py",
    ]);
  });

  it("keeps going after a file with broken syntax", () => {
    const analysis = analyzeFixture({
      "broken.py": 'def f(:\n    """unterminated\nimport good\n',
      "main.py": "import good\n",
      "good.py": "",
    });

    assert.deepEqual(edgesFrom(analysis, "main.py"), ["main.py -> good.py"]);
    assert.deepEqual(analysis.skipped, []);
  });
});
