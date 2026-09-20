// Test-process-only time boundary. Production never imports this file.
const offset = Number(process.env.PR0_TEST_TIME_OFFSET_MS ?? "0");
globalThis.Date = new Proxy(Date, {
  construct(target, args) {
    return Reflect.construct(
      target,
      args.length ? args : [target.now() + offset]
    );
  },
  get(target, property, receiver) {
    if (property === "now") {
      return () => target.now() + offset;
    }
    // oxlint-disable-next-line anti-slop/no-reflect-get -- Preserve native Date symbols and methods in a test-only clock boundary.
    return Reflect.get(target, property, receiver);
  },
});
