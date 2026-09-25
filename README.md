# Codefield

Turns a public GitHub repository into an interactive map of its code.

## What it does

Codefield fetches a public GitHub repository, parses its JavaScript and TypeScript files for local import relationships, and renders the result as an explorable constellation: each source file is a star, each relationship is a connecting line. The graph is the product — search, filters and the file inspector help you navigate a repository's structure without reading the code first, and the result can be exported as a PNG.

## Features

- public GitHub repository analysis, from just a repository URL
- optional private repository access through a GitHub App, for repositories the user grants
- JS/TS import, re-export, dynamic import and require relationship extraction
- constellation visualization with directory-aware, deterministic layout
- file inspector (path, size, language, references and referenced-by)
- impact tracing: for a selected file, the files that depend on it directly or through other files, grouped by dependency depth
- repository overview (totals, most-referenced files, busiest directories)
- file search and graph filters (language, directory, connectivity, minimum degree)
- high-resolution PNG export of the current view

## Supported files

- `.ts`
- `.tsx`
- `.js`
- `.jsx`

Declaration files (`.d.ts`), minified or bundled files (`.min.js`, `.bundle.js`), files larger than 512 KiB, and anything inside common dependency or build output directories (`node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `.next`, and similar) are skipped. At most 500 source files are analyzed per repository, the first 500 by path.

## How it works

GitHub repository URL → repository metadata and file tree (GitHub REST API) → a single ZIP archive of the default branch → source files parsed with the TypeScript compiler API → local imports resolved and normalized into a dependency graph → the graph is drawn with Graphology and Sigma.js.

Parsing is syntax-only: nothing is type-checked, compiled or executed. Only the resulting graph (file paths, sizes, languages and edge counts and kinds) is sent to the browser — source contents, import specifiers and any configured GitHub token stay on the server.

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
- JavaScript and TypeScript (`.ts`, `.tsx`, `.js`, `.jsx`) only
- static import analysis only; relationships that only exist at runtime (dynamically constructed paths, non-literal `require`/`import()` arguments, package `exports` maps, workspace packages, bundler-specific aliases) are not resolved
- an import that resolves to an external package is not added to the graph — only repository-internal relationships are shown
- whether a private repository is missing, not readable by the user, or not granted to the app cannot be told apart: GitHub answers all three the same way
- impact tracing follows the same static relationships: it lists files that could be affected by a change, not files that will be, and cannot see dependencies the analysis misses
- repository archives over 50 MiB are not supported, and at most 500 source files are analyzed per repository

## Tech

- Next.js, React, TypeScript
- Tailwind CSS
- Graphology and Sigma.js
- GitHub REST API, TypeScript Compiler API
