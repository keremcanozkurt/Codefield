# Codefield

Turns a public GitHub repository into an interactive map of its code.

## What it does

Codefield fetches a public GitHub repository, reads its source files for relationships between files of the repository (imports, includes, module declarations and similar), and renders the result as an explorable constellation: each source file is a star, each relationship is a connecting line. The graph is the product — search, filters and the file inspector help you navigate a repository's structure without reading the code first, and the result can be exported as a PNG.

## Features

- public GitHub repository analysis, from just a repository URL
- optional private repository access through a GitHub App, for repositories the user grants
- static relationship extraction for 17 languages, resolved only to files of the repository
- constellation visualization with directory-aware, deterministic layout
- file inspector (path, size, language, references and referenced-by)
- impact tracing: for a selected file, the files that depend on it directly or through other files, grouped by dependency depth
- repository overview (totals, most-referenced files, busiest directories)
- file search and graph filters (language, directory, connectivity, minimum degree)
- high-resolution PNG export of the current view

## Languages

Codefield only adds an edge when it can resolve a reference to exactly one analyzed file of the repository. Standard libraries and external packages (npm, PyPI, crates.io, Maven, NuGet, Composer, gems, Go modules, pub, Hex, SwiftPM dependencies) never become nodes, and a reference that could mean several files is left out rather than guessed. A sparse graph is preferred over a wrong one.

"Strong" languages name files or modules directly, so most real dependencies show up. "Conservative" languages mostly import namespaces or packages, so only references that map to one file are kept and graphs are sparser.

| Language | Extensions | Relationships | Resolution | Support |
| --- | --- | --- | --- | --- |
| TypeScript, JavaScript | `.ts` `.tsx` `.js` `.jsx` | import, export from, `import()` and `require` with literals | relative paths, index files, `tsconfig.json`/`jsconfig.json` `baseUrl` and `paths` | strong |
| Python | `.py` | `import`, `from ... import`, relative imports | import roots: repository root, `src/`, the parent of each top-level package, the script's own directory; `from pkg import name` targets the submodule `name` if there is one, else `pkg/__init__.py` | strong |
| Go | `.go` | imports | module path from each `go.mod`; a package import points at one representative file of the package (the file named after the directory, else the first non-test file) | conservative |
| Rust | `.rs` | `mod name;`, `use` paths | module tree from crate roots (`Cargo.toml` conventions, `#[path]`); `use crate::`/`self::`/`super::` and other workspace crates, to the file of the longest module prefix | strong |
| Java | `.java` | imports, static imports, same-package type names | index of top-level types by fully qualified name | strong |
| Kotlin | `.kt` `.kts` | imports (with aliases, top-level functions), same-package type names | shared index with Java and Scala | conservative |
| Scala | `.scala` `.sc` | imports (selectors, renames, relative to the package), same-package type names | shared index with Java and Kotlin | conservative |
| C# | `.cs` | `using static`, `using Alias = Type`, type names used in code | enclosing namespaces, then `using` namespaces and the project's global usings; a namespace `using` alone never adds edges | conservative |
| C, C++ | `.c` `.h`, `.cc` `.cpp` `.cxx` `.hh` `.hpp` `.hxx` | `#include "..."` and `#include <...>` | the including file's directory, the repository root and `include`/`inc` directories, then a unique path suffix; no macro expansion | strong |
| PHP | `.php` | `include`/`require` with literal paths (also `__DIR__ . '...'`), `use` imports, class names in code | declared classes and `composer.json` PSR-4 prefixes | strong |
| Ruby | `.rb` | `require_relative`, `require`, `autoload` | the file's directory, and the repository root and `lib/` directories | strong |
| Dart | `.dart` | `import`, `export`, `part`, `part of` | relative URIs and `package:` URIs of packages in this repository (`pubspec.yaml`) | strong |
| Elixir | `.ex` `.exs` | `alias`, `import`, `require`, `use`, module names in code | index of `defmodule` names, exact matches only | strong |
| Lua | `.lua` | `require` with a literal name | `a.b` as `a/b.lua` or `a/b/init.lua` under the root, `lua/`, `src/` or `lib/` | strong |
| Swift | `.swift` | type names in code, including `extension Type` | types declared in the file's module (a Swift package target, or else all other Swift files) and in package targets it imports; `import Module` alone never adds edges | conservative |

Type names used in code (Java, Kotlin, Scala, C#, PHP, Swift, Elixir) are only resolved when exactly one type of that name is in scope, the file does not declare the name itself, and a single file declares the type. Nested types, partial classes and types declared in several files are not resolved. Java, Kotlin and Scala share one index, so a Kotlin file importing a Java class is an edge; other cross-language edges only come from syntax that names a file, such as a TypeScript import of `./x.js`.

Declaration files (`.d.ts`), minified or bundled files (`.min.js`, `.bundle.js`), files larger than 512 KiB, and anything inside common dependency or build output directories are skipped: `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `.next`, `.venv`, `venv`, `__pycache__`, `site-packages`, `target`, `.gradle`, `obj`, `.dart_tool`, `_build`, `deps`, `.build`, `Pods` and similar. At most 500 source files are analyzed per repository, the first 500 by path.

## How it works

GitHub repository URL → repository metadata and file tree (GitHub REST API) → a single ZIP archive of the default branch → each source file handed to the analyzer registered for its language → references resolved against the repository's files and normalized into one dependency graph → the graph is drawn with Graphology and Sigma.js.

TypeScript and JavaScript are parsed with the TypeScript compiler API. The other languages use a shared tokenizer that understands each language's comments and string literals (including raw strings, heredocs and sigils), from which each analyzer reads the few top-level forms it needs. Manifests (`go.mod`, `Cargo.toml`, `composer.json`, `pubspec.yaml`) are read as data. Parsing is syntax-only: nothing is type-checked, compiled or executed, and no project tool is ever run. Only the resulting graph (file paths, sizes, languages and edge counts and kinds) is sent to the browser — source contents, import specifiers and any configured GitHub token stay on the server.

## Run locally

Requires Node.js 20.9 or later (Node.js 22.18 or later to run the test suite, which runs TypeScript test files directly).

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Requests to the GitHub API are anonymous by default, which GitHub limits to 60 per hour per IP address. To raise the limit, copy `.env.example` to `.env.local` and set `GITHUB_TOKEN` to a token with read-only access to public repositories. The token is read on the server only and is never required for the basic public-repository experience. It is never used to read private repositories: a private repository it happens to see is treated as not found.

```bash
npm run build
npm run start
```

builds and runs a production server.

## Private repositories

Private repository access is optional and off unless a GitHub App is configured. Public repositories are always requested anonymously (or with `GITHUB_TOKEN`) first and never require a connection.

When a repository is not publicly visible, Codefield uses the visitor's GitHub App user access token instead. GitHub only accepts that token for repositories the user can read and that the user has granted to the app's installation, so both conditions are enforced by GitHub on every request. Codefield never creates installation tokens and never reads an installation ID from the browser.

The flow:

1. "Connect GitHub" sends the browser to GitHub's authorization page with a random `state`, kept in an encrypted, HttpOnly cookie for 10 minutes.
2. GitHub redirects to `/api/github/callback`. The state is checked, the code is exchanged for a user access token, and the tokens are stored in an encrypted (AES-256-GCM), HttpOnly, SameSite=Lax cookie. Nothing token-related reaches client JavaScript or the URL.
3. If the user has not installed the app anywhere, they are sent on to GitHub's installation page to choose repositories. GitHub then returns to `/api/github/setup`.
4. "Manage access" opens the same GitHub page to change which repositories the app may read. "Disconnect" deletes the cookie and asks GitHub to revoke the access token.

Expiring user tokens are refreshed on the server when needed. A connection ends after 30 days, when its refresh token expires, or when GitHub rejects it.

Source files of a private repository are read from the archive in memory, as for public ones; only the graph (paths, sizes, languages, relationships) is sent to the browser.

### Creating the GitHub App

On GitHub, go to Settings → Developer settings → GitHub Apps → New GitHub App and use:

- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/api/github/callback`
- Expire user authorization tokens: enabled (Codefield also works with it disabled)
- Request user authorization (OAuth) during installation: disabled. Codefield starts authorization itself so it can check `state`; with this enabled GitHub skips the Setup URL and calls the callback without Codefield's state.
- Enable Device Flow: disabled
- Setup URL: `http://localhost:3000/api/github/setup`, with "Redirect on update" enabled
- Webhook: "Active" unchecked; Codefield uses no webhooks
- Repository permissions: Contents: Read-only, Metadata: Read-only (GitHub requires Metadata). Everything else: No access.
- Organization and account permissions: none
- Where can this GitHub App be installed: "Only on this account" is enough for local use

Codefield calls `GET /repos/{owner}/{repo}` (Metadata), `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` and `GET /repos/{owner}/{repo}/zipball/{branch}` (Contents), plus `GET /user` and `GET /user/installations`, which need no extra permissions.

After creating the app, generate a client secret. No private key is needed: Codefield never authenticates as the app itself. Set these in `.env.local`:

```bash
GITHUB_APP_CLIENT_ID=      # "Client ID" on the app's page
GITHUB_APP_CLIENT_SECRET=  # the generated client secret
GITHUB_APP_SLUG=           # the app's URL name, as in github.com/apps/<slug>
GITHUB_SESSION_SECRET=     # at least 32 characters, e.g. `openssl rand -base64 32`
```

For a deployment, use the deployed origin in place of `http://localhost:3000`, ideally with a separate app. Cookies are marked Secure when `NODE_ENV` is `production`, which includes `npm run start`; Chrome and Firefox accept Secure cookies on `http://localhost`, Safari may not.

## Limits / current scope

- private repositories need the GitHub App described below; without it, only public repositories can be analyzed
- static analysis only; relationships that only exist at runtime (dynamically constructed paths, interpolated strings, non-literal `require`/`import()` arguments, `sys.path` changes, `package.path`) are not resolved, and neither are package `exports` maps, JavaScript workspace packages, bundler aliases, C/C++ include paths set by build flags, or Go workspaces (`go.work`)
- Go edges are package-level (one representative file per imported package); files of one Go package never reference each other through imports, so they have no edges between them
- Kotlin top-level functions are only linked through imports, not through unqualified calls
- an import that resolves to an external package is not added to the graph — only repository-internal relationships are shown
- whether a private repository is missing, not readable by the user, or not granted to the app cannot be told apart: GitHub answers all three the same way
- impact tracing follows the same static relationships: it lists files that could be affected by a change, not files that will be, and cannot see dependencies the analysis misses
- repository archives over 50 MiB are not supported, and at most 500 source files are analyzed per repository

## Tech

- Next.js, React, TypeScript
- Tailwind CSS
- Graphology and Sigma.js
- GitHub REST API, TypeScript Compiler API
