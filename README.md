# Codefield

Turns a public GitHub repository into an interactive map of its code.

Early development. Repository analysis and the graph view are not implemented yet.

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

Source files are read from a single ZIP archive of the default branch, so an analysis makes three GitHub API requests: repository metadata, the file tree, and the archive. Archives over 50 MiB are not supported. At most 500 source files are analyzed per repository (the first 500 by path).

## Scripts

- `npm run dev` starts the development server
- `npm run build` creates a production build
- `npm run lint` runs ESLint
- `npm run typecheck` generates Next.js route types and runs `tsc --noEmit`
- `npm test` runs unit tests with Node's built-in test runner (needs Node.js 22.18 or later, which runs TypeScript files directly)
