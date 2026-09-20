// oxlint-disable eslint/no-bitwise -- Compact exact postings use a 10,000-slot bitmap.
import type { Database } from "bun:sqlite";

const slotCount = 10_000;
export class SearchSlots {
  private readonly bits = new Uint8Array(slotCount / 8);
  constructor(slots: Iterable<number>) {
    for (const slot of slots) {
      this.bits[slot >> 3] = (this.bits[slot >> 3] ?? 0) | (1 << (slot & 7));
    }
  }
  has(slot: number) {
    return Boolean((this.bits[slot >> 3] ?? 0) & (1 << (slot & 7)));
  }
}
interface Posting {
  representation: "sparse" | "bitmap" | "runs";
  payload: Uint8Array;
  count: number;
}
const decode = (posting: Posting | null) => {
  const slots = new Set<number>();
  if (!posting) {
    return slots;
  }
  const { payload, representation } = posting;
  const view = new DataView(
    payload.buffer,
    payload.byteOffset,
    payload.byteLength
  );
  if (representation === "bitmap") {
    for (let slot = 0; slot < payload.length * 8; slot += 1) {
      if ((payload[slot >> 3] ?? 0) & (1 << (slot & 7))) {
        slots.add(slot);
      }
    }
  } else {
    for (
      let offset = 0;
      offset < payload.length;
      offset += representation === "sparse" ? 2 : 4
    ) {
      const start = view.getUint16(offset, true);
      const length =
        representation === "sparse" ? 1 : view.getUint16(offset + 2, true);
      for (let slot = start; slot < start + length; slot += 1) {
        slots.add(slot);
      }
    }
  }
  return slots;
};
const encode = (slots: Set<number>, capacity: number): Posting => {
  const sorted = [...slots];
  sorted.sort((a, b) => a - b);
  const runs: { start: number; length: number }[] = [];
  for (const slot of sorted) {
    const last = runs.at(-1);
    if (last && last.start + last.length === slot) {
      last.length += 1;
    } else {
      runs.push({ start: slot, length: 1 });
    }
  }
  const sparseBytes = sorted.length * 2;
  const runBytes = runs.length * 4;
  const bitmapBytes = Math.ceil(capacity / 8);
  if (bitmapBytes < sparseBytes && bitmapBytes < runBytes) {
    const payload = new Uint8Array(bitmapBytes);
    for (const slot of sorted) {
      payload[slot >> 3] = (payload[slot >> 3] ?? 0) | (1 << (slot & 7));
    }
    return { representation: "bitmap", payload, count: sorted.length };
  }
  const representation = runBytes < sparseBytes ? "runs" : "sparse";
  const payload = new Uint8Array(Math.min(sparseBytes, runBytes));
  const view = new DataView(payload.buffer);
  if (representation === "runs") {
    for (const [index, run] of runs.entries()) {
      view.setUint16(index * 4, run.start, true);
      view.setUint16(index * 4 + 2, run.length, true);
    }
  } else {
    for (const [index, slot] of sorted.entries()) {
      view.setUint16(index * 2, slot, true);
    }
  }
  return { representation, payload, count: sorted.length };
};
const shortGrams = (value: string) => {
  const grams = new Set<string>();
  let previous = "";
  for (const point of value) {
    grams.add(point);
    if (previous) {
      grams.add(previous + point);
    }
    previous = point;
  }
  return grams;
};
export const shortPostings = (db: Database, capacity = slotCount) => {
  const read = db.query<Posting, [string, Uint8Array]>(
    "SELECT representation,payload,count FROM search_short WHERE field=? AND gram=CAST(? AS TEXT)"
  );
  const write = db.query(
    "INSERT OR REPLACE INTO search_short(field,gram,representation,payload,count) VALUES (?,CAST(? AS TEXT),?,?,?)"
  );
  const remove = db.query(
    "DELETE FROM search_short WHERE field=? AND gram=CAST(? AS TEXT)"
  );
  return {
    get: (field: string, gram: string) =>
      new SearchSlots(decode(read.get(field, Buffer.from(gram)))),
    update(field: string, slot: number, before: string, after: string) {
      const old = shortGrams(before);
      const next = shortGrams(after);
      const change = (gram: string, add: boolean) => {
        const key = Buffer.from(gram);
        const previous = read.get(field, key);
        // Initial builds allocate increasing slots. Extending a final run keeps
        // the smallest representation without expanding a common key to 10,000 entries.
        if (add && previous?.representation === "runs") {
          const payload = new Uint8Array(previous.payload);
          const view = new DataView(payload.buffer);
          const tail = payload.length - 4;
          const length = view.getUint16(tail + 2, true);
          if (view.getUint16(tail, true) + length === slot) {
            view.setUint16(tail + 2, length + 1, true);
            write.run(field, key, "runs", payload, previous.count + 1);
            return;
          }
        }
        const slots = decode(previous);
        if (add) {
          slots.add(slot);
        } else {
          slots.delete(slot);
        }
        if (!slots.size) {
          remove.run(field, key);
          return;
        }
        const posting = encode(slots, capacity);
        write.run(
          field,
          key,
          posting.representation,
          posting.payload,
          posting.count
        );
      };
      for (const gram of old) {
        if (!next.has(gram)) {
          change(gram, false);
        }
      }
      for (const gram of next) {
        if (!old.has(gram)) {
          change(gram, true);
        }
      }
    },
  };
};
