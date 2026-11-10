import { expect, test } from "bun:test";

import { desktopStatusSchema } from "./desktop-session";
import { capabilitiesSchema } from "./device";
import fixtures from "./device-fixtures.json";
import { deviceSchemas } from "./device-openapi";
import { legalLinksSchema } from "./legal";
import { openApiDocument } from "./openapi";

test("legal links accept operator HTTPS pages and omit unconfigured links", () => {
  expect(
    legalLinksSchema.parse({
      impressum: "https://example.org/impressum",
      terms: "https://example.org/terms?lang=de#top",
    })
  ).toEqual({
    impressum: "https://example.org/impressum",
    terms: "https://example.org/terms?lang=de#top",
  });
  expect(legalLinksSchema.parse({})).toEqual({});
});

test("legal links reject unsafe, credentialed, oversized and unknown values", () => {
  for (const value of [
    "http://example.org/privacy",
    `${"javascript"}:alert(1)`,
    "data:text/html,hi",
    "https://user:secret@example.org/privacy",
    "/privacy",
    "",
    `https://example.org/${"a".repeat(2048)}`,
  ]) {
    expect(legalLinksSchema.safeParse({ privacy: value }).success).toBe(false);
  }
  expect(
    legalLinksSchema.safeParse({ cookies: "https://example.org/cookies" })
      .success
  ).toBe(false);
});

test("negotiated discovery and native status carry optional legal links", () => {
  const legal = { privacy: "https://example.org/privacy" };
  expect(
    capabilitiesSchema.parse({ ...fixtures.capabilities, legal }).legal
  ).toEqual(legal);
  expect(capabilitiesSchema.parse(fixtures.capabilities).legal).toBeUndefined();
  const status = {
    state: "signed_out",
    generation: 1,
    origin: null,
    email: null,
    accountId: null,
    instanceId: null,
    userCode: null,
    message: "",
    pollAfterMs: 0,
  };
  expect(desktopStatusSchema.parse({ ...status, legal }).legal).toEqual(legal);
  expect(desktopStatusSchema.parse({ ...status, legal: null }).legal).toBe(
    null
  );
  expect(
    desktopStatusSchema.safeParse({
      ...status,
      legal: { terms: "http://example.org/terms" },
    }).success
  ).toBe(false);
});

test("OpenAPI documents the legal links in negotiated discovery", () => {
  const legal = deviceSchemas.Capabilities?.properties?.legal;
  expect(JSON.stringify(legal)).toContain('"impressum"');
  expect(deviceSchemas.Capabilities?.required).not.toContain("legal");
  expect(openApiDocument.components.schemas).toMatchObject({
    Capabilities: deviceSchemas.Capabilities,
  });
});
