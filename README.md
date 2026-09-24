# Codefield

Turns a public GitHub repository into an interactive map of its code.

Early development. Files can be searched and inspected; there are no filters or image export yet.

## Running locally

Requires Node.js 20.9 or later.

```bash
npm install
npm run dev
```

Then open http://localhost:3000.

Requests to the GitHub API are anonymous by default, which GitHub limits to 60 per hour per IP address. To raise the limit, copy `.env.example` to `.env.local` and set `GITHUB_TOKEN`. The token is only read on the server.

## Supported files

Codefield reads `.ts`, `.tsx`, `.js` and `.jsx` files from the repository's default branch. It skips declaration files (`.d.ts`), minified or bundled files (`.min.js`, `.bundle.js`), files larger than 512 KiB, and anything inside dependency or build output directories such as `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor` and `.next`.

Source files, along with any `tsconfig*.json` and `jsconfig*.json` files, are read from a single ZIP archive of the default branch, so an analysis makes three GitHub API requests: repository metadata, the file tree, and the archive. Archives over 50 MiB are not supported. At most 500 source files are analyzed per repository (the first 500 by path).

## Module relationships

Each source file is parsed with the TypeScript compiler API. Parsing is syntax-only: nothing is type-checked, compiled or executed. Codefield records `import` declarations, `export ... from` declarations, and `import()` and `require()` calls whose argument is a string literal.

A reference becomes a relationship only when it resolves to another loaded source file. Relative specifiers are tried as written, then with `.ts`, `.tsx`, `.js` and `.jsx` appended, then as a directory containing an `index` file with those extensions in the same order. A `.js` specifier also matches a `.ts` or `.tsx` file with the same name. Other specifiers are resolved with `compilerOptions.baseUrl` and `compilerOptions.paths` from the nearest `tsconfig.json` or `jsconfig.json`, following `extends` when it is a relative path to another config file in the repository. Package imports are ignored. Package `exports`, workspace packages and bundler-specific aliases are not resolved.

The dependency graph has one node per loaded source file, including files with no relationships, and one directed edge per pair of files with at least one relationship between them. An edge records how many relationships it combines and of which kinds.

## Graph view

The browser receives only the graph: each file's path, directory, language, size and edge counts, and each edge's endpoints, weight and kinds of relationship (import, re-export, dynamic import, require). Source contents, import specifiers and the GitHub token stay on the server.

The graph is converted to a directed [Graphology](https://graphology.github.io/) graph and drawn with [Sigma.js](https://www.sigmajs.org/), which needs WebGL. Scroll or pinch to zoom and drag to pan.

- A file's radius follows the logarithm of its size in bytes, between fixed bounds at 128 bytes and 64 KiB, so it does not depend on the other files in the repository.
- TypeScript files are drawn in a blue-grey tone and JavaScript files in a warm grey. Files with more edges are drawn slightly brighter and up to 20% larger. Files without edges use the dimmest tone.
- Edges are thin and mostly transparent. An edge that combines several relationships is drawn a little thicker and more opaque.
- Labels show the file name. Larger stars are labelled first, more labels appear when zooming in, and hovering a file shows its name and highlights its edges.

Files are placed by directory: each directory's files form a group, nested directories sit inside their parent's region, and a directory that only contains one other directory is treated as part of it. Groups of sibling directories are packed next to each other, preferring positions near the siblings they import from or are imported by, and imports between files then pull them slightly closer without moving them out of their group. Positions are computed once, before the graph is drawn, and depend only on the graph, so a repository renders the same way on every load.

Clicking a file selects it: the file and the files it shares an edge with stay highlighted, and the rest of the graph dims. A panel lists the file's path, language, size and degree, the files it references and the files that reference it, each with the kind of reference when it is not a plain import. Selecting a file in either list moves the selection there. The search field matches file names and paths without regard to case. Escape, a click on an empty part of the graph, or the panel's close button clears the selection, and Reset view also returns the camera to its initial position. All of this runs in the browser on the graph that was already loaded.

## Scripts

- `npm run dev` starts the development server
- `npm run build` creates a production build
- `npm run lint` runs ESLint
- `npm run typecheck` generates Next.js route types and runs `tsc --noEmit`
- `npm test` runs unit tests with Node's built-in test runner (needs Node.js 22.18 or later, which runs TypeScript files directly)
