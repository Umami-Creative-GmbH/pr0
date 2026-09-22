import { expect, test } from "bun:test";

import fixtures from "../../../packages/api-contract/src/excerpt-fixtures.json";
import { copyBrowser } from "./copy-browser-fixture";
import {
  promptBrowser,
  promptClient,
  promptEdit,
  promptOperation,
  promptState,
} from "./prompt-fixture";

test("REST summaries preview content literally and keep bounded excerpts after edits", async () => {
  const account = await promptBrowser();
  const operation = promptOperation({
    title: "Excerpt example",
    description: "Not the preview",
    content: "  Hello\n\t{{name}}  <b>world</b> ",
  });
  const created = await account.mutate([operation]);
  expect(created.status).toBe(200);
  const client = promptClient(account.Cookie);
  const page = await client.getPrompts({});
  expect(page.prompts[0]).toMatchObject({
    excerpt: "Hello {{name}} <b>world</b>",
  });
  expect(page.prompts[0]).not.toHaveProperty("content");
  const original = await client.getPrompt(operation.promptId);
  const changed = await account.mutate([
    promptEdit(original, {
      title: original.title,
      description: "",
      content: "😀".repeat(141),
    }),
  ]);
  expect(changed.status).toBe(200);
  const search = await client.getPrompts({ query: "Excerpt" });
  expect(search.prompts[0]).toMatchObject({ excerpt: "😀".repeat(140) });
  expect(search.prompts[0]).not.toHaveProperty("content");
  const edited = await client.getPrompt(operation.promptId);
  await account.mutate([promptState(edited, "favorite", true)]);
  const favorites = await client.getPrompts({ view: "favorites" });
  expect(favorites.prompts[0]).toMatchObject({ excerpt: "😀".repeat(140) });
});

test.each(fixtures)(
  "REST excerpt agrees with the native rule: $content",
  async ({ content, excerpt }) => {
    const account = await promptBrowser();
    await account.mutate([
      promptOperation({ title: "Parity", description: "", content }),
    ]);
    const page = await promptClient(account.Cookie).getPrompts();
    expect(page.prompts[0]).toMatchObject({ excerpt });
  }
);

test("library rows display content and variables as literal text", async () => {
  const account = await promptBrowser();
  await account.mutate([
    promptOperation({
      title: "Literal preview",
      description: "",
      content: "  Hello\n{{name}} <b>world</b> ",
    }),
  ]);
  const ui = await copyBrowser(account.Cookie);
  try {
    const page = await ui.open();
    const row = page
      .locator("[data-prompt-row]")
      .filter({ hasText: "Literal preview" });
    await row.waitFor();
    expect(
      await row.locator(".wf-row-preview").textContent({ timeout: 3000 })
    ).toBe("Hello {{name}} <b>world</b>");
    expect(await row.locator("b, input").count()).toBe(0);
  } finally {
    await ui.browser.close();
  }
});
