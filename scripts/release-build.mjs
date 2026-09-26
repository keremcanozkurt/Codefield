// Builds the production output shipped in the npm package. Runs as `prepack`,
// so `npm pack` and `npm publish` always include a fresh build.
//
// Next.js writes the absolute path of the directory it builds in into its
// output (as module IDs in server bundles and manifests). Building in the
// checkout would publish the maintainer's own paths, such as a home
// directory, so the build runs in a clean copy under a neutral temporary
// directory, with its own `npm ci`, and only the finished .next is copied
// back. The copy's location does not matter at run time: nothing resolves
// those IDs as files.
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const work = workDirectory();
const SOURCES = ["src", "package.json", "package-lock.json", "tsconfig.json", "next-env.d.ts", "postcss.config.mjs"];
// Build-time records Next.js does not read when serving.
const LEFT_OUT = new Set(["cache", "dev", "trace", "trace-build", "diagnostics", "types"]);

const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
// `npm pack --dry-run` still runs prepack. The npm ci below would inherit the
// flag through the environment and install nothing.
delete env.npm_config_dry_run;

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
for (const entry of SOURCES) await cp(join(root, entry), join(work, entry), { recursive: true });

run(npm(), ["ci", "--no-audit", "--no-fund", "--ignore-scripts"]);
run(process.execPath, [join(work, "node_modules", "next", "dist", "bin", "next"), "build", "--webpack"]);

await rm(join(root, ".next"), { recursive: true, force: true });
await cp(join(work, ".next"), join(root, ".next"), {
  recursive: true,
  filter: (source) => !LEFT_OUT.has(source.slice(join(work, ".next").length + 1).split(/[\\/]/)[0]),
});
await rm(work, { recursive: true, force: true });

const leaks = await findPaths(join(root, ".next"), [root + sep, homedir() + sep]);
if (leaks.length > 0) {
  console.error(`The build still contains local paths, in:\n${leaks.slice(0, 10).join("\n")}`);
  process.exit(1);
}

// The temporary directory can itself be inside the home directory (always on
// Windows, sometimes through TMPDIR elsewhere), which would put the user name
// back into the output; the drive root or /tmp do not.
function workDirectory() {
  const candidates =
    process.platform === "win32"
      ? [join(parse(tmpdir()).root, "codefield-release")]
      : [join(tmpdir(), "codefield-release"), "/tmp/codefield-release"];
  return candidates.find((candidate) => !candidate.startsWith(homedir() + sep)) ?? candidates[candidates.length - 1];
}

// npm sets npm_execpath to its own CLI script when running package scripts;
// starting it with node avoids depending on a shell to find npm or npm.cmd.
function npm() {
  return process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ["npm"];
}

function run(command, args) {
  const [program, ...prefix] = Array.isArray(command) ? command : [command];
  const result = spawnSync(program, [...prefix, ...args], {
    cwd: work,
    stdio: "inherit",
    env,
    shell: program === "npm" && process.platform === "win32",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function findPaths(directory, paths) {
  const needles = paths.flatMap((path) => [path, JSON.stringify(path).slice(1, -1)]);
  const found = [];
  for (const entry of await readdir(directory, { recursive: true })) {
    const file = join(directory, entry);
    if (!(await stat(file)).isFile() || !/\.(js|json|html|rsc|txt)$/.test(file)) continue;
    const text = await readFile(file, "utf8");
    if (needles.some((needle) => text.includes(needle))) found.push(file);
  }
  return found;
}
