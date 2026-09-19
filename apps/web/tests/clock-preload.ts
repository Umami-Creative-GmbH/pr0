// Installed only by the isolated acceptance Compose override, never the production command.
import { readFileSync } from "node:fs";

const offset = () => {
  try {
    return Number(readFileSync("/tmp/pr0-test-clock", "utf-8"));
  } catch {
    return 0;
  }
};
globalThis.Date = new Proxy(Date, {
  construct(target, args) {
    return Reflect.construct(
      target,
      args.length ? args : [target.now() + offset()]
    );
  },
  get(target, property, receiver) {
    if (property === "now") {
      return () => target.now() + offset();
    }
    // oxlint-disable-next-line anti-slop/no-reflect-get -- Preserve the native Date constructor's symbols and static methods in this clock-only test proxy.
    return Reflect.get(target, property, receiver);
  },
});
