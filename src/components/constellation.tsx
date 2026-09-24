"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import type Sigma from "sigma";
import type { CameraState, SigmaEvents } from "sigma/types";

import { listen } from "@/lib/visualization/events";
import {
  CAMERA,
  closerRatio,
  focusEdge,
  focusNode,
  focusRatio,
  isComfortablyVisible,
  labelsAllFiles,
  type FocusState,
} from "@/lib/visualization/focus";
import { toGraphology, type VisualGraph } from "@/lib/visualization/graphology";
import type { Neighborhood } from "@/lib/visualization/inspection";
import { RENDERER_SETTINGS } from "@/lib/visualization/settings";
import type { EdgeAttributes, NodeAttributes, RenderGraph } from "@/lib/visualization/types";

export type ConstellationHandle = {
  // Brings a file to the middle of the view, zooming in on dense graphs.
  focus(id: string): void;
  resetView(): void;
};

type ConstellationProps = {
  graph: RenderGraph;
  label: string;
  neighborhood: Neighborhood | null;
  onSelect(id: string | null): void;
  ref?: Ref<ConstellationHandle>;
};

type Session = {
  sigma: Sigma<NodeAttributes, EdgeAttributes>;
  visual: VisualGraph;
  state: FocusState;
};

// "reveal" pans only if the file is near the edge of the view, "center" always
// centres it, and "closer" also zooms in.
type CameraMove = "reveal" | "center" | "closer";

export function Constellation({ graph, label, neighborhood, onSelect, ref }: ConstellationProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  const neighborhoodRef = useRef(neighborhood);
  const onSelectRef = useRef(onSelect);
  // A camera move waiting for its selection to be applied, since the
  // inspector opening changes the size of the graph area first.
  const pendingMoveRef = useRef<{ id: string; move: CameraMove } | null>(null);
  const [failedGraph, setFailedGraph] = useState<RenderGraph | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useImperativeHandle(
    ref,
    () => ({
      focus: (id) => requestMove(sessionRef.current, pendingMoveRef, id, "center"),
      resetView: () => {
        const session = sessionRef.current;
        if (session === null) return;
        moveCameraTo(session, {
          x: 0.5,
          y: 0.5,
          ratio: session.visual.getAttribute("initialRatio"),
          angle: 0,
        });
      },
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (container === null || graph.nodes.length === 0) return;

    let session: Session | null = null;
    let unlisten = () => {};
    let observer: ResizeObserver | null = null;
    let cancelled = false;

    // Sigma reads WebGL globals when its module is evaluated, so it is loaded
    // here rather than imported at the top, which would also run on the server.
    import("sigma")
      .then(({ default: Sigma }) => {
        if (cancelled) return;
        const visual = toGraphology(graph);
        // Mutated in place by the handlers below and by the selection effect;
        // the reducers read it on every refresh.
        const state: FocusState = {
          neighborhood: neighborhoodRef.current,
          hovered: null,
          labelAll: labelsAllFiles(visual.order),
        };

        const sigma = new Sigma<NodeAttributes, EdgeAttributes>(visual, container, {
          ...RENDERER_SETTINGS,
          nodeReducer: (node, data) => focusNode(node, data, state),
          edgeReducer: (edge, data) => focusEdge(visual.source(edge), visual.target(edge), data, state),
        });

        // Frames small layouts with margin instead of stretching them to the
        // viewport. Sigma applies the box when it processes the graph, so this
        // needs a full refresh; both run before the first frame is drawn.
        sigma.setCustomBBox(visual.getAttribute("frame"));
        sigma.getCamera().setState({ x: 0.5, y: 0.5, ratio: visual.getAttribute("initialRatio"), angle: 0 });
        sigma.refresh();

        const current: Session = { sigma, visual, state };
        session = current;
        sessionRef.current = current;

        // Hover changes one node and its edges, so only those are repainted.
        const repaint = (node: string) =>
          sigma.refresh({
            partialGraph: { nodes: [node], edges: visual.edges(node) },
            skipIndexation: true,
          });
        unlisten = listen<SigmaEvents>(sigma, {
          enterNode: ({ node }) => {
            state.hovered = node;
            repaint(node);
          },
          leaveNode: ({ node }) => {
            state.hovered = null;
            repaint(node);
          },
          clickNode: ({ node }) => {
            requestMove(current, pendingMoveRef, node, "reveal");
            onSelectRef.current(node);
          },
          clickStage: () => onSelectRef.current(null),
          doubleClickNode: (event) => {
            event.preventSigmaDefault();
            requestMove(current, pendingMoveRef, event.node, "closer");
          },
        });

        // Sigma only listens for window resizes; the graph area also changes
        // width when the inspector opens or the page gains a scrollbar.
        observer = new ResizeObserver(() => sigma.scheduleRender());
        observer.observe(container);
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
      unlisten();
      observer?.disconnect();
      if (session !== null) {
        if (sessionRef.current === session) sessionRef.current = null;
        session.sigma.kill();
      }
      pendingMoveRef.current = null;
    };
  }, [graph]);

  useEffect(() => {
    neighborhoodRef.current = neighborhood;
    const session = sessionRef.current;
    if (session === null) return;

    session.state.neighborhood = neighborhood;
    session.sigma.resize();
    session.sigma.refresh();

    const pending = pendingMoveRef.current;
    if (pending !== null && pending.id === neighborhood?.selected) {
      pendingMoveRef.current = null;
      moveCamera(session, pending.id, pending.move);
    }
  }, [neighborhood]);

  if (graph.nodes.length === 0) return null;
  const failed = failedGraph === graph;

  return (
    <div className="absolute inset-0">
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

// Runs the move now if the file is already the applied selection, otherwise
// once the selection effect has applied it.
function requestMove(
  session: Session | null,
  pendingMoveRef: { current: { id: string; move: CameraMove } | null },
  id: string,
  move: CameraMove,
) {
  if (session !== null && session.state.neighborhood?.selected === id) {
    moveCamera(session, id, move);
  } else {
    pendingMoveRef.current = { id, move };
  }
}

function moveCamera(session: Session, id: string, move: CameraMove) {
  const { sigma, visual } = session;
  const display = sigma.getNodeDisplayData(id);
  if (display === undefined) return;
  const { ratio } = sigma.getCamera().getState();

  if (move === "reveal") {
    if (isComfortablyVisible(sigma.framedGraphToViewport(display), sigma.getDimensions())) return;
    moveCameraTo(session, { x: display.x, y: display.y });
  } else if (move === "center") {
    const initialRatio = visual.getAttribute("initialRatio");
    moveCameraTo(session, { x: display.x, y: display.y, ratio: focusRatio(ratio, visual.order, initialRatio) });
  } else {
    moveCameraTo(session, { x: display.x, y: display.y, ratio: closerRatio(ratio) });
  }
}

function moveCameraTo(session: Session, target: Partial<CameraState>) {
  const camera = session.sigma.getCamera();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    camera.setState(target);
  } else {
    void camera.animate(target, { duration: CAMERA.duration, easing: "quadraticOut" });
  }
}
