import "server-only";
import type { SocialProvider } from "@pr0/api-contract/accounts";
import { github, google } from "better-auth/social-providers";

import { secret } from "./config";

const credentials = (provider: SocialProvider) => {
  const prefix = `PR0_${provider.toUpperCase()}`;
  const clientId = process.env[`${prefix}_CLIENT_ID`];
  if (!clientId) {
    return;
  }
  return { clientId, clientSecret: secret(`${prefix}_CLIENT_SECRET`) };
};

export const enabledProviders = (): SocialProvider[] =>
  (["google", "github"] as const).filter((provider) =>
    Boolean(credentials(provider))
  );

export const socialProvider = (id: SocialProvider) => {
  const options = credentials(id);
  if (!options) {
    return;
  }
  return id === "google" ? google(options) : github(options);
};
