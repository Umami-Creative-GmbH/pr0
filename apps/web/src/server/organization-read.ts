// oxlint-disable react-doctor/server-sequential-independent-await -- Scoped reads share one locked snapshot.
import "server-only";
import {
  organizationImpactInputSchema,
  organizationImpactSchema,
  organizationReviewSchema,
  organizationStatesSchema,
  promptIdentitySchema,
} from "@pr0/api-contract/prompts";
import { z } from "zod";

import type { BrowserAccount } from "./browser-proof";
import { database } from "./database";
import {
  organizationImpact,
  unavailableOrganization,
} from "./organization-cleanup";
import { invalidPromptRequest } from "./prompt-errors";
import { lockLibrary, summaryFrom } from "./prompt-store";

const readInput = <T>(schema: z.ZodType<T>, url: URL) => {
  const fields = Object.fromEntries(url.searchParams);
  const input = schema.safeParse(fields);
  if (
    !input.success ||
    Object.keys(fields).length !== [...url.searchParams].length
  ) {
    throw invalidPromptRequest();
  }
  return input.data;
};
export const getOrganizationImpact = (browser: BrowserAccount, url: URL) =>
  database().begin(async (tx) => {
    const input = readInput(organizationImpactInputSchema, url);
    if ((input.kind === "tag.merge") !== Boolean(input.targetId)) {
      throw invalidPromptRequest();
    }
    const library = await lockLibrary(tx, browser);
    const scope = {
      instanceId: library.instance_id,
      accountId: browser.accountId,
    };
    const { effect } = await organizationImpact(tx, scope, input);
    return organizationImpactSchema.parse({
      ...scope,
      revision: library.revision,
      effect,
    });
  });
export const getOrganizationReview = (
  browser: BrowserAccount,
  id: string,
  url: URL
) =>
  database().begin(async (tx) => {
    if (!promptIdentitySchema.safeParse(id).success) {
      throw invalidPromptRequest();
    }
    const { offset } = readInput(
      z.strictObject({
        offset: z.coerce.number().int().min(0).max(10_000).default(0),
      }),
      url
    );
    const library = await lockLibrary(tx, browser);
    const scope = {
      instanceId: library.instance_id,
      accountId: browser.accountId,
    };
    const [operation] =
      await tx`SELECT organization_effect FROM library_operation WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND operation_id = ${id} AND organization_effect IS NOT NULL`;
    if (!operation) {
      throw unavailableOrganization();
    }
    const rows =
      await tx`SELECT a.prompt_id AS affected_id, a.originally_archived, p.id, p.title, p.description, p.favorite, p.archived, p.collection_id, p.created_at, p.modified_at, p.revision::text,
    to_json(ARRAY(SELECT m.tag_id FROM prompt_tag m WHERE m.instance_id = a.instance_id AND m.account_id = a.account_id AND m.prompt_id = a.prompt_id AND m.add_revision > m.remove_revision ORDER BY m.tag_id)) AS tag_ids
    FROM (SELECT * FROM organization_affected WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND operation_id = ${id} ORDER BY prompt_id LIMIT 101 OFFSET ${offset}) a
    LEFT JOIN LATERAL (SELECT id, title, description, favorite, archived, collection_id, created_at, modified_at, revision FROM prompt WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND id = a.prompt_id LIMIT 1) p ON true ORDER BY a.prompt_id`;
    return organizationReviewSchema.parse({
      ...scope,
      operationId: id,
      effect: operation.organization_effect,
      prompts: rows.slice(0, 100).map((row: (typeof rows)[number]) => ({
        id: row.affected_id,
        originallyArchived: row.originally_archived,
        current: row.id ? summaryFrom(row) : null,
      })),
      nextOffset: rows.length > 100 ? offset + 100 : null,
    });
  });

export const getOrganizationStates = (browser: BrowserAccount, url: URL) =>
  database().begin(async (tx) => {
    const { ids, promptIds } = readInput(
      z.strictObject({
        promptIds: z
          .string()
          .max(739)
          .transform((value) => value.split(","))
          .pipe(z.array(promptIdentitySchema).min(1).max(20))
          .optional(),
        ids: z
          .string()
          .max(36_999)
          .transform((value) => value.split(","))
          .pipe(z.array(promptIdentitySchema).min(1).max(1000)),
      }),
      url
    );
    const library = await lockLibrary(tx, browser);
    const scope = {
      instanceId: library.instance_id,
      accountId: browser.accountId,
    };
    // Follow only same-library aliases. CYCLE guarantees termination even for corrupt history.
    const rows = await tx`WITH RECURSIVE chain AS (
    SELECT id AS root, id, entity, name, target_id FROM organization_removed WHERE instance_id = ${scope.instanceId} AND account_id = ${scope.accountId} AND id IN ${tx(ids)}
    UNION ALL SELECT c.root, r.id, r.entity, r.name, r.target_id FROM chain c JOIN organization_removed r ON r.id = c.target_id AND r.instance_id = ${scope.instanceId} AND r.account_id = ${scope.accountId}
    ) CYCLE id SET cycle USING path
    SELECT r.id, r.entity, r.name, CASE WHEN r.target_id IS NULL THEN 'deleted' ELSE 'merged' END AS state, t.id AS target_id, t.name AS target_name
    FROM organization_removed r LEFT JOIN chain c ON c.root = r.id AND NOT c.cycle
    LEFT JOIN tag t ON t.id = c.target_id AND t.instance_id = r.instance_id AND t.account_id = r.account_id
    WHERE r.instance_id = ${scope.instanceId} AND r.account_id = ${scope.accountId} AND r.id IN ${tx(ids)}
    ORDER BY r.id, t.id NULLS LAST`;
    const unique = new Map<
      string,
      {
        id: string;
        entity: string;
        name: string;
        state: string;
        targetId: string | null;
        targetName: string | null;
      }
    >();
    for (const row of rows) {
      if (!unique.has(row.id)) {
        unique.set(row.id, {
          id: row.id,
          entity: row.entity,
          name: row.name,
          state: row.state,
          targetId: row.target_id,
          targetName: row.target_name,
        });
      }
    }
    const removals = promptIds?.length
      ? await tx<
          { prompt_id: string; tag_id: string; revision: string }[]
        >`WITH RECURSIVE chain AS (
      SELECT id AS root,id FROM tag WHERE instance_id=${scope.instanceId} AND account_id=${scope.accountId} AND id IN ${tx(ids)}
      UNION SELECT id AS root,id FROM organization_removed WHERE instance_id=${scope.instanceId} AND account_id=${scope.accountId} AND id IN ${tx(ids)}
      UNION SELECT c.root,r.target_id FROM organization_removed r JOIN chain c ON c.id=r.id WHERE r.instance_id=${scope.instanceId} AND r.account_id=${scope.accountId} AND r.target_id IS NOT NULL
    ) SELECT p.prompt_id,c.root AS tag_id,max(p.remove_revision)::text AS revision FROM prompt_tag p JOIN chain c ON c.id=p.tag_id WHERE p.instance_id=${scope.instanceId} AND p.account_id=${scope.accountId} AND p.prompt_id IN ${tx(promptIds)} AND p.remove_revision>0 AND p.remove_revision<>p.merge_revision GROUP BY p.prompt_id,c.root ORDER BY p.prompt_id,c.root LIMIT 2001`
      : [];
    if (removals.length > 2000) {
      throw invalidPromptRequest();
    }
    return organizationStatesSchema.parse({
      ...scope,
      revision: library.revision,
      removals: removals.map((row) => ({
        promptId: row.prompt_id,
        tagId: row.tag_id,
        revision: row.revision,
      })),
      states: [...unique.values()],
    });
  });
