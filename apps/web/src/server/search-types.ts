import type {
  promptBrowseInputSchema,
  promptPageSchema,
} from "@pr0/api-contract/prompts";
import type { z } from "zod";

export type SearchInput = z.infer<typeof promptBrowseInputSchema>;
export type SearchPage = z.infer<typeof promptPageSchema>;
export interface SearchScope {
  account: string;
  instance: string;
  epoch: string;
  revision: string;
}
export interface SearchJob {
  scope: SearchScope;
  input: SearchInput;
  cancellation: SharedArrayBuffer;
}
export interface SearchRecord {
  id: string;
  title: string;
  description: string;
  content: string | null;
  revision: string;
  created_at: Date;
  modified_at: Date;
  last_used_at: Date | null;
  favorite: boolean;
  archived: boolean;
  collection_id: string | null;
  tag_ids: string[];
}
