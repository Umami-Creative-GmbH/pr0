// Static interoperability fixture; regenerate deliberately when the wire contract changes.
const instanceId = "11111111-1111-4111-8111-111111111111";
const accountId = "33333333-3333-4333-8333-333333333333";
const id = "55555555-5555-4555-8555-555555555555";
const organization = {
  instanceId,
  accountId,
  revision: "2",
  textBytes: 30,
  collections: [],
  tags: [],
};
const prompt = (promptId: string, title: string) => ({
  instanceId,
  accountId,
  id: promptId,
  title,
  description: "",
  content: "  Hello offline\n",
  revision: "1",
  createdAt: "2026-09-20T10:00:00.000Z",
  modifiedAt: "2026-09-20T10:00:00.000Z",
  favorite: false,
  archived: false,
  collectionId: null,
  tagIds: [],
  useCount: 0,
  lastUsedAt: null,
  sourceTitle: null,
});
const pages = [
  {
    id,
    page: 0,
    payload: JSON.stringify({
      organization,
      prompts: [prompt("66666666-6666-4666-8666-666666666666", "First")],
    }),
  },
  {
    id,
    page: 1,
    payload: JSON.stringify({
      organization: null,
      prompts: [prompt("77777777-7777-4777-8777-777777777777", "Second")],
    }),
  },
];
const manifest = {
  instanceId,
  accountId,
  version: 1,
  normalization: "pr0-search-v1-ucd17",
  id,
  epoch: "88888888-8888-4888-8888-888888888888",
  revision: "2",
  expiresAt: "2099-01-01T00:15:00.000Z",
  promptCount: 2,
  pages: pages.map((page) => ({
    digest: new Bun.CryptoHasher("sha256").update(page.payload).digest("hex"),
    bytes: Buffer.byteLength(page.payload),
  })),
};
const malformed = [
  { name: "missing first-page organization", page: 0, organization: null },
  {
    name: "organization from another revision",
    page: 0,
    organization: { ...organization, revision: "1" },
  },
  { name: "organization on a subsequent page", page: 1, organization },
].map((entry) => {
  const payload = JSON.stringify({
    organization: entry.organization,
    prompts: [],
  });
  const digests = manifest.pages.map((digest, index) =>
    index === entry.page
      ? {
          digest: new Bun.CryptoHasher("sha256").update(payload).digest("hex"),
          bytes: Buffer.byteLength(payload),
        }
      : digest
  );
  return {
    name: entry.name,
    manifest: { ...manifest, pages: digests },
    page: { id, page: entry.page, payload },
  };
});
await Bun.write(
  new URL("../src/snapshot-fixtures.json", import.meta.url),
  `${JSON.stringify({ manifest, pages, malformed }, null, 2)}\n`
);
