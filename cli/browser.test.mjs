import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { browserCommand } from "./browser.mjs";

describe("browserCommand", () => {
  const url = "http://127.0.0.1:4173/open?token=abc";

  it("uses each platform's opener, with the URL as a single argument", () => {
    assert.deepEqual(browserCommand("linux", url), { command: "xdg-open", args: [url] });
    assert.deepEqual(browserCommand("darwin", url), { command: "open", args: [url] });
    assert.deepEqual(browserCommand("win32", url), { command: "rundll32.exe", args: ["url.dll,FileProtocolHandler", url] });
  });

  it("never goes through a shell such as cmd.exe", () => {
    for (const platform of ["linux", "darwin", "win32"]) {
      assert.ok(!/cmd|sh$|powershell/i.test(browserCommand(platform, url).command), platform);
    }
  });
});
