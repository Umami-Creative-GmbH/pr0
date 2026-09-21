// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Samples and database fixture setup run sequentially against public REST/browser controls.
import { expect, test } from "bun:test";
import { readdir, stat } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import path from "node:path";

import { SQL } from "bun";
import { chromium } from "playwright";

import { origin } from "./http-fixture";
import { promptBrowser } from "./prompt-fixture";

test("records maximum-size five-field search including real debounce and rendering", async () => {
  const account = await promptBrowser();
  const url = process.env.DATABASE_URL;
  if (url !== "postgres://pr0:local-social-test-only@localhost:55426/pr0") {
    throw new Error("Requires isolated capacity database");
  }
  const sql = new SQL(url);
  const phrase =
    "write concise answer useful examples clear steps review following document identify important changes explain reasoning preserve exact names punctuation summarize meeting notes actions owners dates common C++ abc bcd ";
  try {
    await sql.begin(async (tx) => {
      await tx`SELECT account_id FROM library WHERE account_id=${account.identity.accountId} FOR UPDATE`;
      await tx`INSERT INTO prompt(instance_id,account_id,id,title,description,content,revision,title_revision,description_revision,content_revision,created_at,modified_at)
        SELECT ${account.identity.instanceId}::uuid,${account.identity.accountId},gen_random_uuid(),'Prompt '||lpad(n::text,5,'0'),'description',
        left(repeat(${phrase},100),10485 + CASE WHEN n<=7600 THEN 1 ELSE 0 END - 24 - CASE WHEN n<=800 THEN 1 ELSE 0 END),n,n,n,n,
        '2026-01-01T00:00:00Z'::timestamptz,'2026-01-01T00:00:00Z'::timestamptz FROM generate_series(1,10000) n`;
      await tx`INSERT INTO collection(instance_id,account_id,id,name,identity_key,revision)
        SELECT ${account.identity.instanceId}::uuid,${account.identity.accountId},gen_random_uuid(),'Collection '||lpad(n::text,3,'0'),'collection '||lpad(n::text,3,'0'),1 FROM generate_series(1,200) n`;
      await tx`INSERT INTO tag(instance_id,account_id,id,name,identity_key,revision)
        SELECT ${account.identity.instanceId}::uuid,${account.identity.accountId},gen_random_uuid(),'Tag '||lpad(n::text,4,'0'),'tag '||lpad(n::text,4,'0'),1 FROM generate_series(1,1000) n`;
      await tx`WITH numbered AS (SELECT id,row_number() OVER(ORDER BY name) AS n FROM collection WHERE account_id=${account.identity.accountId})
        UPDATE prompt p SET collection_id=c.id FROM numbered c WHERE p.account_id=${account.identity.accountId} AND c.n=(p.revision-1)%200+1`;
      await tx`INSERT INTO prompt_tag(instance_id,account_id,prompt_id,tag_id,add_revision)
        SELECT p.instance_id,p.account_id,p.id,t.id,p.revision FROM prompt p
        JOIN tag t ON t.instance_id=p.instance_id AND t.account_id=p.account_id
        WHERE p.account_id=${account.identity.accountId} AND (right(t.name,4)::int-1)/20=(p.revision-1)%50`;
      await tx`UPDATE library SET collection_count=200,tag_count=1000 WHERE account_id=${account.identity.accountId}`;
      await tx`INSERT INTO library_operation(instance_id,account_id,operation_id,epoch,installation_id,canonical_version,request_hash,kind,prompt_id,revision,accepted_at)
        SELECT instance_id,account_id,gen_random_uuid(),${account.identity.epoch}::uuid,${account.identity.installationId}::uuid,1,'search-capacity','prompt.create',id,revision,created_at FROM prompt WHERE account_id=${account.identity.accountId}`;
      await tx`INSERT INTO library_change(instance_id,account_id,revision,operation_id,kind,prompt_id,accepted_at)
        SELECT instance_id,account_id,revision,operation_id,kind,prompt_id,accepted_at FROM library_operation WHERE account_id=${account.identity.accountId}`;
      await tx`UPDATE library SET revision=10000,prompt_count=10000,text_bytes=10800+(SELECT sum(octet_length(title)+octet_length(description)+octet_length(content)) FROM prompt WHERE account_id=${account.identity.accountId}) WHERE account_id=${account.identity.accountId}`;
    });
  } finally {
    await sql.close();
  }
  const coldStart = performance.now();
  let first: Response | undefined;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    first = await account.get("?query=common");
    if (first.ok) {
      break;
    }
    expect(await first.json()).toMatchObject({ code: "search_preparing" });
    await Bun.sleep(2000);
  }
  expect(first?.ok).toBe(true);
  const coldMs = performance.now() - coldStart;
  expect(await first?.json()).toMatchObject({
    usage: { promptCount: 10_000, textBytes: 104_857_600 },
  });
  const queries = [
    "a",
    "C++",
    "common",
    "abcd",
    "prompt description common tag collection",
    "tag",
    "collection",
    phrase.slice(0, 197),
  ];
  const rest = [];
  for (const query of queries) {
    const samples = [];
    const server = [];
    for (let sample = 0; sample < 11; sample += 1) {
      const start = performance.now();
      const response = await account.get(`?query=${encodeURIComponent(query)}`);
      expect(response.status).toBe(200);
      const page = await response.json();
      expect(page.prompts.length).toBe(query === "abcd" ? 0 : 50);
      if (sample) {
        samples.push(performance.now() - start);
        server.push(response.headers.get("Server-Timing"));
      }
    }
    rest.push({ query, samples, server });
  }
  const browser = await chromium.launch({
    channel: process.env.PR0_BROWSER_CHANNEL ?? "chrome",
    headless: true,
  });
  const rendering = [];
  try {
    const context = await browser.newContext();
    await context.addCookies(
      account.Cookie.split("; ").map((cookie) => {
        const split = cookie.indexOf("=");
        return {
          name: cookie.slice(0, split),
          value: cookie.slice(split + 1),
          url: origin,
        };
      })
    );
    const page = await context.newPage();
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Prompt 00001 description", exact: true })
      .waitFor();
    for (const query of [
      "prompt description common tag collection",
      "tag",
      "collection",
      "abcd",
    ]) {
      const duration = await page.evaluate(async (value) => {
        const input = document.querySelector<HTMLInputElement>(
          'input[type="search"]'
        );
        if (!input) {
          throw new Error("Missing search box");
        }
        const start = performance.now();
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        )?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // Observe committed results, then include the next painted frame.
        // oxlint-disable-next-line promise/avoid-new -- Measure DOM commitment and paint through the browser observer boundary.
        await new Promise<void>((resolve, reject) => {
          // oxlint-disable-next-line eslint/prefer-const -- The observer and timeout callbacks cancel one another.
          let timeout: ReturnType<typeof setTimeout>;
          const observer = new MutationObserver(() => {
            const results = document.querySelector(
              'section[aria-labelledby="prompts-heading"]'
            );
            const complete =
              value === "abcd"
                ? results?.textContent?.includes("No matching prompts")
                : results?.querySelectorAll("li").length === 50;
            const updating = [...document.querySelectorAll("output")].some(
              (item) => item.textContent?.includes("Updating search")
            );
            if (complete && !updating) {
              clearTimeout(timeout);
              observer.disconnect();
              requestAnimationFrame(() =>
                requestAnimationFrame(() => resolve())
              );
            }
          });
          timeout = setTimeout(() => {
            observer.disconnect();
            reject(new Error("Render timeout"));
          }, 10_000);
          observer.observe(document.body, {
            subtree: true,
            childList: true,
            characterData: true,
          });
        });
        return performance.now() - start;
      }, query);
      rendering.push({ query, duration });
    }
  } finally {
    await browser.close();
  }
  const directory = path.resolve(
    process.env.PR0_SEARCH_DIRECTORY ?? "apps/web/.data/search"
  );
  const files = await readdir(directory);
  const file = files.find(
    (name) =>
      name ===
      `${account.identity.instanceId}-${account.identity.accountId}.sqlite`
  );
  const fileInfo = file ? await stat(path.join(directory, file)) : null;
  const bytes = fileInfo?.size ?? null;
  await Bun.write(
    "docs/research/web-full-search-measurements.json",
    `${JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        runtime: Bun.version,
        platform: process.platform,
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
        fixture:
          "Synthetic repeated prose, 10000 prompts, exactly 100 MiB of canonical text including 1000 tags and 200 collections; 20 tags and one collection per prompt; all five fields; local loopback production build.",
        coldMs,
        indexBytes: bytes,
        rest,
        rendering,
        releaseGate:
          "The final all-field 150 ms end-to-end gate on supported hardware remains required; these local all-field measurements do not certify release.",
      },
      null,
      2
    )}\n`
  );
}, 600_000);
