type Emitter<Events> = {
  on<E extends keyof Events>(type: E, listener: Events[E]): unknown;
  removeListener<E extends keyof Events>(type: E, listener: Events[E]): unknown;
};

// Registers a set of listeners and returns a function that removes exactly
// those listeners. Calling it more than once is harmless.
export function listen<Events>(
  emitter: Emitter<Events>,
  listeners: Partial<NoInfer<Events>>,
): () => void {
  const entries = Object.entries(listeners) as [keyof Events, Events[keyof Events]][];
  for (const [type, listener] of entries) emitter.on(type, listener);

  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    for (const [type, listener] of entries) emitter.removeListener(type, listener);
  };
}
