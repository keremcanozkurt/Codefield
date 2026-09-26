import { compareStrings } from "../analysis/paths.ts";
import { compareLanguages, type LanguageId } from "../languages/registry.ts";
import type { LanguageCounts } from "./types.ts";

// The fields insights read. Both the dependency graph and the browser payload
// have them, so the same facts come out of either.
export type InsightNode = {
  id: string;
  path: string;
  directory: string;
  language: LanguageId;
  size: number;
  // Unique graph edges, as counted by buildDependencyGraph.
  incoming: number;
  outgoing: number;
  degree: number;
};

export type InsightEdge = {
  source: string;
  target: string;
  // Module relationships the edge combines.
  weight: number;
};

export type InsightGraph = {
  nodes: readonly InsightNode[];
  edges: readonly InsightEdge[];
};

export type FileRef = { id: string; path: string; name: string; directory: string };

// The file with the highest value; ties go to the first path in code-unit
// order, and `ties` counts the other files with the same value.
export type FileFact = { file: FileRef; value: number; ties: number };

export type DirectoryMetrics = {
  // "" for files at the repository root.
  path: string;
  // Files directly in this directory; subdirectories are separate entries.
  fileCount: number;
  totalBytes: number;
  // Sums of the files' unique-edge counts, so an edge between two files of
  // the same directory counts once in `incoming` and once in `outgoing`.
  incoming: number;
  outgoing: number;
  degree: number;
  // Edges with both ends in this directory.
  internalEdges: number;
  isolatedFiles: number;
};

export type DirectoryFact = { path: string; value: number; ties: number };

export type RepositoryInsights = {
  totals: {
    files: number;
    edges: number;
    // Module relationships, which can exceed edges: an edge merges every
    // relationship between the same two files.
    relationships: number;
    directories: number;
    totalBytes: number;
    isolatedFiles: number;
    // Only languages with at least one file.
    languages: LanguageCounts;
  };
  // Null when no file has a value above zero, such as the most referenced file
  // of a graph without edges.
  files: {
    mostReferenced: FileFact | null;
    mostOutgoing: FileFact | null;
    highestDegree: FileFact | null;
    largest: FileFact | null;
  };
  // Files without incoming or outgoing edges, sorted by path.
  isolated: FileRef[];
  // Sorted by path.
  directories: DirectoryMetrics[];
  directoryFacts: {
    mostFiles: DirectoryFact | null;
    mostIncoming: DirectoryFact | null;
    mostOutgoing: DirectoryFact | null;
    highestDegree: DirectoryFact | null;
  };
};

export function deriveRepositoryInsights(graph: InsightGraph): RepositoryInsights {
  const nodes = [...graph.nodes].sort((a, b) => compareStrings(a.path, b.path) || compareStrings(a.id, b.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const directories = new Map<string, DirectoryMetrics>();
  const languages: LanguageCounts = {};
  let totalBytes = 0;
  const isolated: FileRef[] = [];

  for (const node of nodes) {
    languages[node.language] = (languages[node.language] ?? 0) + 1;
    totalBytes += node.size;
    if (node.degree === 0) isolated.push(fileRef(node));

    let directory = directories.get(node.directory);
    if (directory === undefined) {
      directory = {
        path: node.directory,
        fileCount: 0,
        totalBytes: 0,
        incoming: 0,
        outgoing: 0,
        degree: 0,
        internalEdges: 0,
        isolatedFiles: 0,
      };
      directories.set(node.directory, directory);
    }
    directory.fileCount++;
    directory.totalBytes += node.size;
    directory.incoming += node.incoming;
    directory.outgoing += node.outgoing;
    directory.degree += node.degree;
    if (node.degree === 0) directory.isolatedFiles++;
  }

  let edges = 0;
  let relationships = 0;
  for (const edge of graph.edges) {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (source === undefined || target === undefined || source === target) continue;
    edges++;
    relationships += edge.weight;
    if (source.directory === target.directory) directories.get(source.directory)!.internalEdges++;
  }

  const directoryList = [...directories.values()].sort((a, b) => compareStrings(a.path, b.path));

  return {
    totals: {
      files: nodes.length,
      edges,
      relationships,
      directories: directoryList.length,
      totalBytes,
      isolatedFiles: isolated.length,
      languages,
    },
    files: {
      mostReferenced: topFile(nodes, (node) => node.incoming),
      mostOutgoing: topFile(nodes, (node) => node.outgoing),
      highestDegree: topFile(nodes, (node) => node.degree),
      largest: topFile(nodes, (node) => node.size),
    },
    isolated,
    directories: directoryList,
    directoryFacts: {
      mostFiles: topDirectory(directoryList, (directory) => directory.fileCount),
      mostIncoming: topDirectory(directoryList, (directory) => directory.incoming),
      mostOutgoing: topDirectory(directoryList, (directory) => directory.outgoing),
      highestDegree: topDirectory(directoryList, (directory) => directory.degree),
    },
  };
}

// `items` must already be in path order, so the first maximum wins ties.
function top<T>(items: readonly T[], value: (item: T) => number): { item: T; value: number; ties: number } | null {
  let best: T | null = null;
  let bestValue = 0;
  let ties = 0;
  for (const item of items) {
    const current = value(item);
    if (current > bestValue) {
      best = item;
      bestValue = current;
      ties = 0;
    } else if (current === bestValue && best !== null) {
      ties++;
    }
  }
  return best === null ? null : { item: best, value: bestValue, ties };
}

function topFile(nodes: readonly InsightNode[], value: (node: InsightNode) => number): FileFact | null {
  const result = top(nodes, value);
  return result === null ? null : { file: fileRef(result.item), value: result.value, ties: result.ties };
}

function topDirectory(
  directories: readonly DirectoryMetrics[],
  value: (directory: DirectoryMetrics) => number,
): DirectoryFact | null {
  const result = top(directories, value);
  return result === null ? null : { path: result.item.path, value: result.value, ties: result.ties };
}

function fileRef(node: InsightNode): FileRef {
  return {
    id: node.id,
    path: node.path,
    name: node.path.slice(node.path.lastIndexOf("/") + 1),
    directory: node.directory,
  };
}

export type FileFactKind = keyof RepositoryInsights["files"];

export type FileHighlight = {
  file: FileRef;
  facts: { kind: FileFactKind; value: number; ties: number }[];
};

const FILE_FACT_ORDER: readonly FileFactKind[] = ["mostReferenced", "mostOutgoing", "highestDegree", "largest"];

// The file facts grouped by file, in a fixed order, so a small repository where
// one file leads every category shows that file once with all of its facts.
export function fileHighlights(insights: RepositoryInsights): FileHighlight[] {
  return group(FILE_FACT_ORDER, (kind) => insights.files[kind], (fact) => fact.file.id).map(
    ({ first, facts }) => ({ file: first.file, facts }),
  );
}

export type DirectoryFactKind = keyof RepositoryInsights["directoryFacts"];

export type DirectoryHighlight = {
  path: string;
  facts: { kind: DirectoryFactKind; value: number; ties: number }[];
};

const DIRECTORY_FACT_ORDER: readonly DirectoryFactKind[] = [
  "mostFiles",
  "mostIncoming",
  "mostOutgoing",
  "highestDegree",
];

// The directory facts grouped by directory, like fileHighlights.
export function directoryHighlights(insights: RepositoryInsights): DirectoryHighlight[] {
  return group(DIRECTORY_FACT_ORDER, (kind) => insights.directoryFacts[kind], (fact) => fact.path).map(
    ({ first, facts }) => ({ path: first.path, facts }),
  );
}

function group<Kind, Fact extends { value: number; ties: number }>(
  kinds: readonly Kind[],
  factOf: (kind: Kind) => Fact | null,
  keyOf: (fact: Fact) => string,
): { first: Fact; facts: { kind: Kind; value: number; ties: number }[] }[] {
  const groups = new Map<string, { first: Fact; facts: { kind: Kind; value: number; ties: number }[] }>();
  for (const kind of kinds) {
    const fact = factOf(kind);
    if (fact === null) continue;
    const entry = { kind, value: fact.value, ties: fact.ties };
    const existing = groups.get(keyOf(fact));
    if (existing === undefined) groups.set(keyOf(fact), { first: fact, facts: [entry] });
    else existing.facts.push(entry);
  }
  return [...groups.values()];
}

// Languages with their file counts, most files first; ties in registry order.
export function languageBreakdown(counts: LanguageCounts): { language: LanguageId; files: number }[] {
  return (Object.entries(counts) as [LanguageId, number][])
    .filter(([, files]) => files > 0)
    .map(([language, files]) => ({ language, files }))
    .sort((a, b) => b.files - a.files || compareLanguages(a.language, b.language));
}
