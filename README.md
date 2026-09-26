# Codefield

Understand a local codebase visually.

Codefield reads a repository on your machine, finds the relationships between its source files (imports, includes, module declarations and similar) and opens it in your browser in two views: a graph of how the files depend on each other, and a structure view of where they live. It runs locally, needs no account and no configuration, and your source code stays on your machine.

## Install

Codefield needs Node.js 20.9 or later. Git is only needed for `codefield clone`.

Codefield is not on the npm registry yet. The name `codefield` on npm belongs to an unrelated package, so `npm install codefield` and `npx codefield` do not install this project.

Until it is published, install it from the package file that `npm pack` makes from a checkout of this repository (see [Packaging](#packaging)). The package file already contains the production build, so installing it does not build anything:

```bash
npm install --global ./codefield-0.1.0.tgz
```

This puts a `codefield` command on your PATH. To run it once without installing:

```bash
npx --package ./codefield-0.1.0.tgz codefield .
```

Codefield is written for Linux and Windows. It has been tested on Linux with Node.js 20.9 and 22; it has not been tested on a Windows machine yet. A separate native macOS app is planned.

## Quick start

```bash
cd my-project
codefield .
```

Codefield prints the folder it is reading and a local address, opens that address in your default browser, and keeps running until you press Ctrl+C:

```text
Codefield
Analyzing /home/user/my-project
Opening http://127.0.0.1:4173/open?token=…
Press Ctrl+C to stop.
```

The token in the address is the key to this session and changes every time Codefield starts.

| Command or option | Meaning |
| --- | --- |
| `codefield [folder]` | Analyze a folder; the current folder when none is given. |
| `codefield clone <remote> [folder]` | Clone a Git repository, then analyze it. |
| `--port <number>` | Serve on this port. By default Codefield uses 4173, or the next free port up to 4192. |
| `--no-open` | Print the address instead of opening the browser. |
| `-h`, `--help` | Show the usage. |
| `-v`, `--version` | Show the version. |

Codefield reflects your current working tree: the files as they are on disk, committed or not. Commit and push are not needed for changes to appear. Run "Analyze again" in the browser after changing the repository; the view, selection and filters stay where they were, as far as the files still exist.

The FAQ link at the top of the page answers the common questions about privacy, cloning, the two views and language support.

## What it does

- open any local folder with `codefield .`, whether or not it is a Git repository
- clone any Git repository with your existing Git and SSH setup: GitHub, GitLab, Bitbucket, Codeberg, Gitea or a self-hosted server
- static relationship extraction for 17 languages, resolved only to files of the repository
- Graph: a constellation of the files and their dependencies, with a deterministic, directory-aware layout
- Structure: a spatial explorer of the directory hierarchy, one level at a time, with a full-screen mode
- file inspector: path, size, language, references and referenced-by, and a button to copy the file's path
- Impact Mode: the files that depend on the selected file, directly or through other files, grouped by depth
- Path Finder: the shortest chain of dependencies from one file to another
- repository overview: totals, most-referenced files, busiest directories
- file search and filters by language, directory, connectivity and minimum degree
- PNG export of the graph, including Impact Mode and Path Finder highlighting
- no limit on the number of files or the size of a repository

## Open a local repository

`codefield <folder>` works with any folder. When the folder, or one of its parents, is a Git repository, the current branch and the origin's host and path are shown next to the repository name. They are read from the files in `.git`; Codefield does not run `git` on a repository it opens, because a repository's own Git configuration can make some Git commands run programs.

## Clone a Git repository

```bash
codefield clone git@github.com:user/project.git
codefield clone git@gitlab.com:group/project.git work/project
codefield clone https://git.company.com/team/project.git
```

The repository is cloned with your installed `git` into the folder you name, or, like `git clone`, into a folder named after the repository in the current directory. The clone is an ordinary Git working copy: Codefield never deletes or updates it, and you can open it again later with `codefield <folder>`. Cloning stops if the destination exists and is not empty.

### Git and SSH authentication

Codefield does not handle credentials. It runs `git clone` with your environment, so your SSH keys, SSH agent, `~/.ssh/config`, `known_hosts`, `GIT_SSH_COMMAND` and Git credential helpers work exactly as they do in your terminal. If `git clone <remote>` works for you, `codefield clone <remote>` works too. Codefield never reads SSH keys, never asks for passwords or tokens, and never accepts an unknown host key for you: if SSH asks you to confirm a host, it asks in the terminal, as it would for `git clone`.

When a clone fails, Git's own output is shown, followed by a short explanation where the cause is clear (host key verification, a refused SSH key, failed authentication, an unreachable host, a missing repository). Some hosts answer the same way for a missing repository as for one you cannot access, and the message says so rather than guessing.

## Graph and Structure

The two views show the same analysis and share the selection, search, filters and inspector. Switching between them keeps the selected file.

- **Graph** shows how the codebase is connected: each file is a node placed near the rest of its directory, each dependency an arrow.
- **Structure** shows where everything is. The directory in focus is shown large in the middle, with its parent above, its neighbouring directories at its sides and its subdirectories and files below. Choosing a subdirectory moves it into focus; the breadcrumb leads back. Directories that only contain a single directory, such as each level of `src/main/java/com/example`, are passed through in one step. Each directory shows its number of files and subdirectories, and how many dependency edges stay inside it.

Selecting a file in Structure opens it in the inspector. "Show in graph" and "Show in structure" move between the views with the file still selected, and search reveals a file in whichever view is showing. Trace impact and Find path draw on the graph, so starting either from Structure switches to the graph. Filters apply to both views; in Structure, directories stay in place and their counts show how many of their files are hidden.

Full screen (the button in the toolbar or in the Structure header) gives the workspace the whole window, and the whole screen where the browser allows it.

Structure only renders the level in focus, and long lists of files or directories only render the rows in view, so a directory with thousands of files stays responsive.

Keyboard: arrow keys move between items in Structure, Enter opens a directory or selects a file, and Backspace or Alt+Left goes up a level. Escape leaves full screen first, then Impact Mode or Path Finder, then clears the selection.

## Impact Mode

Select a file and choose "Trace impact" to see what could be affected by changing it: the files that import it, the files that import those, and so on, grouped by depth. It follows the static graph, so it lists files that could be affected, not files that will be.

## Path Finder

Select a file, choose "Find path", then choose a destination in the graph, in the inspector's reference lists, or with search. Codefield shows the shortest chain of dependencies from the first file to the second. A path runs in the direction of the edges: A → B means A imports B. It is found by breadth-first search, which is safe on cycles, and ties between paths of equal length are broken by file path, so the same path is shown every time. When there is no path in that direction, the inspector says so and offers the reverse direction; a missing path means only that the static graph has none.

Impact Mode and Path Finder both work on the full graph, not only on the files the current filters show; files hidden by filters are counted and marked as hidden. Only one of the two is active at a time. Escape cancels choosing a destination or leaves the mode; a second Escape clears the selection.

## Privacy

Everything runs on your machine. The Codefield server listens on 127.0.0.1 only, reads the one folder it was started with, and sends the browser only the graph: file paths relative to the repository, sizes, languages and relationship counts. Source text stays in the local process. Codefield makes no network requests of its own and collects no analytics; the only network access is `git clone`, when you ask for it.

## Supported languages

Codefield only adds an edge when it can resolve a reference to exactly one analyzed file of the repository. Standard libraries and external packages (npm, PyPI, crates.io, Maven, NuGet, Composer, gems, Go modules, pub, Hex, SwiftPM dependencies) never become nodes, and a reference that could mean several files is left out rather than guessed.

"Strong" languages name files or modules directly, so most real dependencies show up. "Conservative" languages mostly import namespaces or packages; only references that map to one file are kept, and graphs are sparser.

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

Declaration files (`.d.ts`), minified or bundled files (`.min.js`, `.bundle.js`) and anything inside version control, dependency or build output directories are not analyzed: `.git`, `node_modules`, `dist`, `build`, `out`, `coverage`, `vendor`, `.next`, `.venv`, `venv`, `__pycache__`, `site-packages`, `target`, `.gradle`, `obj`, `.dart_tool`, `_build`, `deps`, `.build`, `Pods` and similar.

## How analysis works

1. The folder is listed recursively. Ignored directories are skipped without being entered, and symbolic links are never followed, so the listing cannot leave the folder or loop. Only names are read at this point.
2. Source files are selected by extension and path. Only the selected files, and the configuration files analyzers read (`tsconfig.json`, `jsconfig.json`, `go.mod`, `Cargo.toml`, `composer.json`, `pubspec.yaml`), are opened.
3. Each file goes to the analyzer for its language. References are resolved against the repository's files and normalized into one dependency graph.
4. The graph is sent to the browser, laid out, and drawn with Graphology and Sigma.js.

The browser shows each stage as it happens (reading the repository, reading source files, analyzing dependencies, building the graph, rendering) with real file counts; there are no estimated percentages.

TypeScript and JavaScript are parsed with the TypeScript compiler API. The other languages use a shared tokenizer that understands each language's comments and string literals (including raw strings, heredocs and sigils), from which each analyzer reads the top-level forms it needs. Configuration files and manifests are read as data.

Files that are selected but not shown are reported with a reason, never dropped silently:

- larger than 1 MiB (such files are almost always generated)
- symbolic links, which are not followed
- not valid UTF-8, or not readable
- shown without relationships, because the file could not be parsed
- inside a directory that could not be listed (counted per directory)

## Static-analysis philosophy

Nothing is type-checked, compiled, installed or executed, and no build tool or project script is run. Codefield reads syntax and applies each language's resolution rules as far as they can be followed from the files alone. When a reference is ambiguous, it is left out: Codefield prefers missing an uncertain edge over inventing a false one.

## Large repositories

There is no limit on the number of files or the size of a repository. Two guards protect the process: a single file over 1 MiB is skipped and reported, and an analysis whose selected source text exceeds 768 MiB stops with an error instead of running out of memory.

For very large repositories, the browser is usually the slower part. Measured once on a Linux VM with shallow clones, from the start of the analysis to the finished graph data (layout and rendering in the browser come after):

| Repository | Source files | Edges | Analysis |
| --- | --- | --- | --- |
| django/django | 2,977 | 9,139 | 1.9 s |
| facebook/react | 4,537 | 4,794 | 3.5 s |
| golang/go | 10,712 | 2,536 | 3.5 s |
| microsoft/vscode | 13,739 | 130,659 | 18 s |

The whole graph is sent to the browser and laid out there. vscode's graph is about 45 MB of data, so rendering graphs of that size depends on the viewer's hardware.

## Security

- Repository code is never executed, and no project script, build tool or Git hook is run. Parsing is syntax-only.
- The server binds to 127.0.0.1 and serves one repository, fixed when Codefield starts. No request can name a path: the analysis endpoint takes no input, and files are only reached by walking the folder.
- Every request must carry the Host header of this address (which defeats DNS rebinding), must come from a Codefield page itself (Origin and Sec-Fetch-Site are checked, so other websites and other local ports cannot use it), and must present a random session token. The token is generated for each run, printed in the terminal, and exchanged at `/open` for an HttpOnly, SameSite=Strict cookie. Each port uses its own cookie.
- Symbolic links are never followed. Files are opened without following links where the platform allows it, and each opened file's real path must still be inside the folder.
- `git clone` is started without a shell, with the remote and destination as separate arguments after `--`. Remotes that start with `-`, remote-helper forms such as `ext::`, and unknown transports are refused, and `protocol.ext.allow=never` is passed to Git.
- Credentials never pass through Codefield. Remote URLs shown in the browser have any user name, password or token removed.

## Troubleshooting

| Message | What to do |
| --- | --- |
| `Codefield needs Node.js 20.9 or later` | Install a newer Node.js. `node --version` shows the one on your PATH. |
| `Port <number> is already in use` | Another program uses the port given with `--port`. Choose another one, or leave out `--port` to let Codefield pick a free port. |
| `No free port between 4173 and 4192` | Choose a port yourself with `--port <number>`. |
| `Could not open a browser` | Usual over SSH or without a desktop session. Open the printed address in a browser on the same machine. |
| `Folder not found`, `Not a folder`, `Permission denied` | Check the path. It is resolved from the directory you run `codefield` in. |
| `Git is not installed or not on PATH` | Only `codefield clone` needs Git. Install Git, or clone the repository yourself and run `codefield <folder>`. |

The address only works on the machine running Codefield, because the server listens on 127.0.0.1.

## Limitations

- Static analysis only. Relationships that exist only at runtime are not resolved: dynamically built paths, interpolated strings, non-literal `require`/`import()` arguments, `sys.path` changes and `package.path`. Neither are package `exports` maps, JavaScript workspace packages, bundler aliases, C/C++ include paths set by build flags, or Go workspaces (`go.work`).
- Go edges are package-level: one representative file per imported package. Files of one Go package never import each other, so they have no edges between them.
- Kotlin top-level functions are only linked through imports, not through unqualified calls.
- Imports of external packages are not shown; only relationships between files of the repository are.
- Configuration and manifest files larger than 64 KiB are not read.
- The whole graph is sent to the browser; very large graphs make rendering slow on modest hardware.
- One repository per Codefield process. To look at another, start Codefield again. The browser cannot open folders itself: Codefield only reads the folder it was started with.
- Changes on disk are picked up when you run "Analyze again"; Codefield does not watch the folder.
- Opening a file in an editor or a file manager is not built in yet; "Copy path" copies the repository-relative path.

## Development

Running Codefield from a checkout needs Node.js 20.9 or later; the test suite runs TypeScript files directly and needs Node.js 22.18 or later.

```bash
npm install
npm run dev -- ../some-repository   # development server with hot reload
npm test
npm run typecheck
npm run lint
npm run build
npm start -- ../some-repository     # the production build, as `codefield` runs it
```

`npm run dev` without a folder opens this repository itself. Folders are resolved from the directory you run npm in. Next.js collects anonymous telemetry during development builds unless it is disabled with `npx next telemetry disable`; the `codefield` command always disables it.

The command-line launcher is in `cli/`. It starts the Next.js app on 127.0.0.1 in the same process and passes it the repository through the environment. The analysis lives in `src/lib` and has no dependency on how the repository was obtained: `src/lib/local` lists and reads the folder, `src/lib/analysis` holds the analyzers, `src/lib/graph` builds the graph, and `src/lib/visualization` and `src/components` draw it.

Built with Next.js, React, TypeScript, Tailwind CSS, Graphology, Sigma.js and the TypeScript compiler API.

### Packaging

```bash
npm pack
```

`npm pack` runs `scripts/release-build.mjs` first. It copies the sources to a temporary folder outside your home directory, installs the locked dependencies there with `npm ci`, runs a production build with webpack, and copies the build into `.next`. Next.js writes the absolute path of the build folder into its output, which is why the build does not run in the checkout; the script fails if the build still contains the checkout's path or your home directory.

The package contains the launcher in `cli/`, the production build in `.next`, `README.md` and `LICENSE`. Installing it downloads the runtime dependencies (Next.js, React, TypeScript, Graphology and Sigma.js) and needs no build step. `npm pack --dry-run` runs the same build and lists the files without writing the package file.

## Support

Codefield is free and open source. You can support its continued development at [support.codefield.dev](https://support.codefield.dev).

## License

MIT. See [LICENSE](LICENSE).
