import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LANGUAGES } from "./languages/registry.ts";
import { CLONE_COMMAND, FAQ, OPEN_COMMAND, SUPPORT_URL } from "./product.ts";

describe("support link", () => {
  it("points at the support site", () => {
    assert.equal(SUPPORT_URL, "https://codefield.keremcanozkurt.com/support");
  });
});

describe("start screen commands", () => {
  it("shows the commands the CLI accepts", () => {
    assert.equal(OPEN_COMMAND, "codefield .");
    assert.match(CLONE_COMMAND, /^codefield clone \S+$/);
  });
});

describe("FAQ", () => {
  const questions = FAQ.map((entry) => entry.question);

  it("answers what a new user asks first", () => {
    for (const question of [
      "Does my source code leave my computer?",
      "Does Codefield upload my repository?",
      "Do I need GitHub?",
      "Can I analyze private repositories?",
      "Does Codefield support GitLab, Bitbucket or self-hosted Git?",
      "Do I need to commit or push changes before Codefield sees them?",
      "Does Codefield watch files automatically?",
      "Do I need to rebuild Codefield after changing my project?",
      "What do Graph and Structure mean?",
      "What does Impact Mode mean?",
      "What does Path Finder mean?",
      "Which languages are supported?",
      "Why is there no drag and drop or Choose Folder?",
      "Is the source available?",
    ]) {
      assert.ok(questions.includes(question), question);
    }
    assert.equal(new Set(questions).size, questions.length);
  });

  it("lists every supported language, grouped by how strongly it is resolved", () => {
    const answer = FAQ.find((entry) => entry.question === "Which languages are supported?")!.answer;
    const [strong, conservative] = answer.split("are resolved strongly");
    for (const language of LANGUAGES) {
      const group = language.strength === "strong" ? strong : conservative.split("are resolved conservatively")[0];
      assert.ok(group.includes(language.name), language.name);
    }
  });

  it("keeps code spans balanced", () => {
    for (const entry of FAQ) assert.equal(entry.answer.split("`").length % 2, 1, entry.question);
  });
});
