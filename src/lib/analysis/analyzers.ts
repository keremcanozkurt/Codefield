import type { AnalyzerId } from "../languages/registry.ts";
import type { LanguageAnalyzer } from "./analyzer.ts";
import { analyzeCFamily } from "./languages/c-family.ts";
import { analyzeCSharp } from "./languages/csharp.ts";
import { analyzeDart } from "./languages/dart.ts";
import { analyzeEcmaScript } from "./languages/ecmascript.ts";
import { analyzeElixir } from "./languages/elixir.ts";
import { analyzeGo } from "./languages/go.ts";
import { analyzeJvm } from "./languages/jvm.ts";
import { analyzeLua } from "./languages/lua.ts";
import { analyzePhp } from "./languages/php.ts";
import { analyzePython } from "./languages/python.ts";
import { analyzeRuby } from "./languages/ruby.ts";
import { analyzeRust } from "./languages/rust.ts";
import { analyzeSwift } from "./languages/swift.ts";

export const ANALYZERS: Record<AnalyzerId, LanguageAnalyzer> = {
  ecmascript: analyzeEcmaScript,
  python: analyzePython,
  go: analyzeGo,
  rust: analyzeRust,
  jvm: analyzeJvm,
  csharp: analyzeCSharp,
  "c-family": analyzeCFamily,
  php: analyzePhp,
  ruby: analyzeRuby,
  dart: analyzeDart,
  elixir: analyzeElixir,
  lua: analyzeLua,
  swift: analyzeSwift,
};
