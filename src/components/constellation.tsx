"use client";

import { useEffect, useRef, useState } from "react";
import type Sigma from "sigma";

import { toGraphology } from "@/lib/visualization/graphology";
import type { EdgeAttributes, NodeAttributes, RenderGraph } from "@/lib/visualization/types";

type ConstellationProps = {
  graph: RenderGraph;
  label: string;
};

export function Constellation({ graph, label }: ConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failedGraph, setFailedGraph] = useState<RenderGraph | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || graph.nodes.length === 0) return;

    let renderer: Sigma<NodeAttributes, EdgeAttributes> | null = null;
    let cancelled = false;

    // Sigma reads WebGL globals when its module is evaluated, so it is loaded
    // here rather than imported at the top, which would also run on the server.
    Promise.all([import("sigma"), import("sigma/rendering")])
      .then(([{ default: Sigma }, { drawDiscNodeLabel }]) => {
        if (cancelled) return;
        renderer = new Sigma(toGraphology(graph), container, {
          defaultEdgeType: "arrow",
          labelFont: "ui-sans-serif, system-ui, sans-serif",
          labelSize: 12,
          labelColor: { color: "#8b8f99" },
          // Sigma's default hover draws the label on a white box.
          defaultDrawNodeHover: drawDiscNodeLabel,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Could not render the dependency graph.", error);
        // A constructor that fails partway can leave canvases behind.
        container.replaceChildren();
        setFailedGraph(graph);
      });

    return () => {
      cancelled = true;
      renderer?.kill();
    };
  }, [graph]);

  if (graph.nodes.length === 0) {
    return (
      <p className="rounded-md border border-line px-4 py-10 text-center text-sm text-muted">
        No supported source files were found.
      </p>
    );
  }

  const failed = failedGraph === graph;

  return (
    <div className="relative h-[min(72svh,880px)] min-h-80 w-full overflow-hidden rounded-md border border-line bg-surface">
      <div
        ref={containerRef}
        role="img"
        aria-label={label}
        className={failed ? "invisible absolute inset-0" : "absolute inset-0"}
      />
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted">
          The graph could not be displayed in this browser.
        </p>
      )}
    </div>
  );
}
