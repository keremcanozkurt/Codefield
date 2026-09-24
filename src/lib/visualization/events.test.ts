import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import { listen } from "./events.ts";

type Events = {
  clickNode: (payload: { node: string }) => void;
  clickStage: () => void;
};

describe("listen", () => {
  it("registers each listener once and removes exactly those listeners", () => {
    const emitter = new EventEmitter();
    const other = () => {};
    emitter.on("clickStage", other);
    const clicks: string[] = [];

    const stop = listen<Events>(emitter, {
      clickNode: ({ node }) => clicks.push(node),
      clickStage: () => clicks.push("stage"),
    });
    assert.equal(emitter.listenerCount("clickNode"), 1);
    assert.equal(emitter.listenerCount("clickStage"), 2);

    emitter.emit("clickNode", { node: "a.ts" });
    emitter.emit("clickStage");
    assert.deepEqual(clicks, ["a.ts", "stage"]);

    stop();
    assert.equal(emitter.listenerCount("clickNode"), 0);
    assert.deepEqual(emitter.listeners("clickStage"), [other]);
    emitter.emit("clickNode", { node: "b.ts" });
    assert.deepEqual(clicks, ["a.ts", "stage"]);
  });

  it("can be stopped more than once", () => {
    const emitter = new EventEmitter();
    const stop = listen<Events>(emitter, { clickStage: () => {} });

    stop();
    stop();
    assert.equal(emitter.listenerCount("clickStage"), 0);
  });

  it("does not accumulate listeners across renderer lifecycles", () => {
    const emitter = new EventEmitter();
    let calls = 0;
    for (let lifecycle = 0; lifecycle < 5; lifecycle++) {
      const stop = listen<Events>(emitter, { clickStage: () => calls++ });
      emitter.emit("clickStage");
      stop();
    }

    assert.equal(calls, 5);
    assert.equal(emitter.listenerCount("clickStage"), 0);
  });
});
