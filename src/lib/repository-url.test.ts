import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRepositoryUrl } from "./repository-url.ts";

function assertParses(input: string, owner: string, repo: string) {
  assert.deepEqual(parseRepositoryUrl(input), {
    ok: true,
    repository: { owner, repo },
  });
}

function assertRejects(input: string, error: string) {
  assert.deepEqual(parseRepositoryUrl(input), { ok: false, error });
}

describe("parseRepositoryUrl", () => {
  describe("accepts", () => {
    it("a standard https URL", () => {
      assertParses("https://github.com/vercel/next.js", "vercel", "next.js");
    });

    it("an http URL", () => {
      assertParses("http://github.com/vercel/next.js", "vercel", "next.js");
    });

    it("a URL without a protocol", () => {
      assertParses("github.com/vercel/next.js", "vercel", "next.js");
    });

    it("the www host", () => {
      assertParses("https://www.github.com/vercel/next.js", "vercel", "next.js");
      assertParses("www.github.com/vercel/next.js", "vercel", "next.js");
    });

    it("a trailing slash", () => {
      assertParses("https://github.com/vercel/next.js/", "vercel", "next.js");
    });

    it("a .git suffix", () => {
      assertParses("https://github.com/vercel/next.js.git", "vercel", "next.js");
      assertParses("https://github.com/vercel/next.js.git/", "vercel", "next.js");
    });

    it("surrounding whitespace", () => {
      assertParses("  https://github.com/vercel/next.js \n", "vercel", "next.js");
    });

    it("an uppercase scheme and host while keeping the path's case", () => {
      assertParses("HTTPS://GitHub.com/Microsoft/TypeScript", "Microsoft", "TypeScript");
    });

    it("a query string or fragment", () => {
      assertParses(
        "https://github.com/vercel/next.js?tab=readme-ov-file#getting-started",
        "vercel",
        "next.js",
      );
    });

    it("names with hyphens, underscores and dots", () => {
      assertParses("https://github.com/some-org/my_repo.v2", "some-org", "my_repo.v2");
    });
  });

  describe("rejects", () => {
    it("empty input", () => {
      assertRejects("", "Enter a GitHub repository URL.");
    });

    it("whitespace-only input", () => {
      assertRejects("   \t\n", "Enter a GitHub repository URL.");
    });

    it("malformed input", () => {
      assertRejects("https://", "Enter a valid URL.");
      assertRejects("https:github.com/vercel/next.js", "Enter a valid URL.");
      assertRejects("https://github.com/vercel/next .js", "Enter a valid URL.");
      assertRejects("https://github.com\\vercel\\next.js", "Enter a valid URL.");
      assertRejects("https://git\nhub.com/vercel/next.js", "Enter a valid URL.");
    });

    it("other domains", () => {
      const error = "Only github.com repository URLs are supported.";
      assertRejects("https://gitlab.com/vercel/next.js", error);
      assertRejects("https://github.com.evil.com/vercel/next.js", error);
      assertRejects("https://gist.github.com/vercel/abc123", error);
      assertRejects("https://github.com:8443/vercel/next.js", error);
      assertRejects("vercel/next.js", error);
    });

    it("a missing owner", () => {
      const error = "The URL is missing the repository owner.";
      assertRejects("https://github.com", error);
      assertRejects("https://github.com/", error);
      assertRejects("https://github.com//next.js", error);
    });

    it("a missing repository", () => {
      const error = "The URL is missing the repository name.";
      assertRejects("https://github.com/vercel", error);
      assertRejects("https://github.com/vercel/", error);
    });

    it("an issues URL", () => {
      assertRejects(
        "https://github.com/vercel/next.js/issues",
        "Use the repository URL, not a page inside it.",
      );
    });

    it("a tree URL", () => {
      assertRejects(
        "https://github.com/vercel/next.js/tree/main",
        "Use the repository URL, not a page inside it.",
      );
    });

    it("unsupported and dangerous schemes", () => {
      const error = "Only http and https URLs are supported.";
      assertRejects("javascript:alert(1)", error);
      assertRejects("JavaScript://github.com/vercel/next.js", error);
      assertRejects("data:text/html,<script>alert(1)</script>", error);
      assertRejects("ftp://github.com/vercel/next.js", error);
      assertRejects("git@github.com:vercel/next.js.git", "Enter a valid URL.");
    });

    it("embedded credentials", () => {
      const error = "Remove the username and password from the URL.";
      assertRejects("https://user:token@github.com/vercel/next.js", error);
      assertRejects("https://token@github.com/vercel/next.js", error);
    });

    it("invalid owner segments", () => {
      const error = "The repository owner is not valid.";
      assertRejects("https://github.com/-vercel/next.js", error);
      assertRejects("https://github.com/ver_cel/next.js", error);
      assertRejects(`https://github.com/${"a".repeat(40)}/next.js`, error);
    });

    it("invalid repository segments", () => {
      const error = "The repository name is not valid.";
      assertRejects("https://github.com/vercel/next%20js", error);
      assertRejects("https://github.com/vercel/next!js", error);
      assertRejects("https://github.com/vercel/.git", error);
      assertRejects(`https://github.com/vercel/${"a".repeat(101)}`, error);
    });
  });
});
