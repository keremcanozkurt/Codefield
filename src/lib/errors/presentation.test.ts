import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CONNECTION_LOST,
  EMPTY_REPOSITORY,
  NO_READABLE_SOURCE_FILES,
  NO_SUPPORTED_SOURCE_FILES,
  presentRepositoryError,
  type RepositoryErrorCode,
} from "./presentation.ts";

const CODES: RepositoryErrorCode[] = ["root_unavailable", "not_a_directory", "resources_exceeded", "failed"];

describe("presentRepositoryError", () => {
  it("produces a non-empty title and message for every code", () => {
    for (const code of CODES) {
      const presented = presentRepositoryError(code);
      assert.ok(presented.title.length > 0, code);
      assert.ok(presented.message.length > 0, code);
      assert.equal(typeof presented.retryable, "boolean", code);
    }
  });

  it("never names a path, a host service or a product limit", () => {
    for (const code of CODES) {
      const { title, message } = presentRepositoryError(code);
      const text = `${title} ${message}`.toLowerCase();
      for (const word of ["github", "/home", "c:\\", "500", "mib", "token", "upload"]) {
        assert.ok(!text.includes(word), `${code}: ${word}`);
      }
    }
  });

  it("does not offer a retry for problems a retry cannot fix", () => {
    assert.equal(presentRepositoryError("not_a_directory").retryable, false);
    assert.equal(presentRepositoryError("resources_exceeded").retryable, false);
  });
});

describe("non-error notices", () => {
  it("describes an empty folder without calling it an error", () => {
    assert.ok(!EMPTY_REPOSITORY.title.toLowerCase().includes("error"));
    assert.ok(EMPTY_REPOSITORY.message.length > 0);
  });

  it("describes a folder with no supported files without calling it an error", () => {
    assert.ok(!NO_SUPPORTED_SOURCE_FILES.title.toLowerCase().includes("error"));
    assert.ok(NO_SUPPORTED_SOURCE_FILES.detail.includes("Swift"));
    assert.ok(NO_READABLE_SOURCE_FILES.message.length > 0);
  });

  it("explains a lost connection as the local process having stopped", () => {
    assert.match(CONNECTION_LOST.message, /terminal/);
  });
});
