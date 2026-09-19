import { expect, test } from "bun:test";

import { corsHeaders, preflightResponse } from "./cors";

test.each([
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
])("allows a native desktop request from %s", (origin) => {
  const request = new Request("https://api.example.com/api/v1/health", {
    headers: { Origin: origin },
  });
  const headers = corsHeaders(request);

  expect(headers.get("Access-Control-Allow-Origin")).toBe(origin);
  expect(headers.get("Vary")).toBe("Origin");
  expect(preflightResponse(request).status).toBe(204);
});

test("does not grant unknown browser origins access", () => {
  const request = new Request("https://api.example.com/api/v1/health", {
    headers: { Origin: "https://untrusted.example.com" },
  });

  expect(corsHeaders(request).has("Access-Control-Allow-Origin")).toBe(false);
  expect(preflightResponse(request).status).toBe(403);
});

test("does not add a wildcard origin to same-origin or non-browser requests", () => {
  const request = new Request("https://api.example.com/api/v1/health");
  expect(corsHeaders(request).has("Access-Control-Allow-Origin")).toBe(false);
});
