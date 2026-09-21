import { statSync } from "node:fs";
import path from "node:path";

import { searchNormalizationVersion } from "@pr0/api-contract/prompts";

export const indexVersion = `4:${searchNormalizationVersion}`;
export const searchDirectory = () =>
  path.resolve(process.env.PR0_SEARCH_DIRECTORY ?? ".data/search");
export const searchFilename = (instance: string, account: string) =>
  path.join(searchDirectory(), `${instance}-${account}.sqlite`);

export const searchFileSignature = (instance: string, account: string) => {
  try {
    const filename = searchFilename(instance, account);
    const file = statSync(filename, { bigint: true });
    // A checkpoint from another volume, replaced file or index format is not readiness.
    return file.isFile()
      ? `${indexVersion}:${filename}:${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}`
      : null;
  } catch {
    return null;
  }
};
