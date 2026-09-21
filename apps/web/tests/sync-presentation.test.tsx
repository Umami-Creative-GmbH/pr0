import { expect, test, setSystemTime, afterEach } from "bun:test";

import { downloadStatusSchema } from "@pr0/api-contract/snapshots";
import { renderToStaticMarkup } from "react-dom/server";

import cases from "../../../packages/api-contract/src/sync-presentation-fixtures.json";
import { LocalLibraryStatus } from "../../desktop/src/local-library-status";

afterEach(() => setSystemTime());
for (const fixture of cases) {
  test(`synchronization UI: ${fixture.name}`, () => {
    setSystemTime(new Date("2026-09-21T12:00:00.000Z"));
    const status = downloadStatusSchema.parse({
      instanceId: "11111111-1111-4111-8111-111111111111",
      accountId: "22222222-2222-4222-8222-222222222222",
      recoveryCount: 0,
      total: 4,
      downloaded: 4,
      pendingChanges: fixture.pending,
      complete: true,
      revision: "4",
      textBytes: 50,
      paused: false,
      replacement: false,
      catchingUp: false,
      totalPages: 1,
      appliedPages: 1,
      error: fixture.downloadError,
      recoveryError: null,
    });
    const html = renderToStaticMarkup(
      <LocalLibraryStatus
        status={status}
        signedIn={fixture.signedIn}
        offline={fixture.offline}
        saveFailure={fixture.saveFailure}
        changes={{
          error: fixture.error,
          updating: fixture.updating,
          retryAfterMs: fixture.retryAfterMs,
          lastCheckedAt: "2026-09-21T10:00:00.000Z",
        }}
        upload={{
          waiting: fixture.pending,
          awaitingDownload: fixture.awaitingDownload,
          attentionError: fixture.attentionError,
          error: null,
          retryAfterMs: 0,
          lastCheckedAt: null,
          mappings: [],
          pending: [],
          errors: fixture.rejected
            ? [
                {
                  promptId: "11111111-1111-4111-8111-111111111111",
                  code: "quota_exceeded",
                },
              ]
            : [],
        }}
        onOpen={() => {}}
        onRetry={() => {}}
      />
    );
    expect(html).toContain(
      renderToStaticMarkup(<summary>{fixture.summary}</summary>)
    );
    for (const text of fixture.details) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain('role="alert"');
  });
}
