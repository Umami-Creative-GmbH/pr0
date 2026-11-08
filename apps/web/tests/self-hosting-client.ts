// oxlint-disable eslint/no-await-in-loop, react-doctor/async-await-in-loop -- Retry only the server's explicit transient search preparation at the public HTTP boundary.
import { createPromptClient } from "@pr0/api-client/prompts";

import type { SelfHostingInstance } from "./self-hosting-fixture";

export const selfHostingClient = (
  instance: SelfHostingInstance,
  cookie: string
) =>
  createPromptClient(instance.origin, async (url, init) => {
    const headers = new Headers(init.headers);
    headers.set("Cookie", cookie);
    headers.set("Origin", instance.settings.PR0_ORIGIN);
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, { ...init, headers });
      if (response.status !== 503 || init.method !== "GET" || attempt >= 30) {
        return response;
      }
      await Bun.sleep(1000);
    }
  });
