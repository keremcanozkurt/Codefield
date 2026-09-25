# Codefield

Turns a public GitHub repository into an interactive map of its code.

## What it does

Codefield fetches a public GitHub repository, parses its JavaScript and TypeScript files for local import relationships, and renders the result as an explorable constellation: each source file is a star, each relationship is a connecting line. The graph is the product — search, filters and the file inspector help you navigate a repository's structure without reading the code first, and the result can be exported as a PNG.

## Features

- public GitHub repository analysis, from just a repository URL
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

Requests to the GitHub API are anonymous by default, which GitHub limits to 60 per hour per IP address. To raise the limit, copy `.env.example` to `.env.local` and set `GITHUB_TOKEN` to a token with read-only access to public repositories. The token is read on the server only and is never required for the basic public-repository experience.

```bash
npm run build
npm run start
```

builds and runs a production server.

## Limits / current scope

- public repositories only — no authentication, so private repositories are not accessible
- JavaScript and TypeScript (`.ts`, `.tsx`, `.js`, `.jsx`) only
- static import analysis only; relationships that only exist at runtime (dynamically constructed paths, non-literal `require`/`import()` arguments, package `exports` maps, workspace packages, bundler-specific aliases) are not resolved
- an import that resolves to an external package is not added to the graph — only repository-internal relationships are shown
- impact tracing follows the same static relationships: it lists files that could be affected by a change, not files that will be, and cannot see dependencies the analysis misses
- repository archives over 50 MiB are not supported, and at most 500 source files are analyzed per repository

## Tech

- Next.js, React, TypeScript
- Tailwind CSS
- Graphology and Sigma.js
- GitHub REST API, TypeScript Compiler API
