"use client";
import { useApiClient } from "@pr0/api-client/provider";
import type { PrivateLibrary } from "@pr0/api-contract/accounts";
import type { organizationEffectSchema } from "@pr0/api-contract/prompts";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";

const groups = [
  { label: translate("activePrompts"), archived: false },
  { label: translate("archivedPrompts2"), archived: true },
];

export const OrganizationReview = ({
  library,
  operationId,
  effect,
}: {
  library: PrivateLibrary;
  operationId: string;
  effect: z.infer<typeof organizationEffectSchema>;
}) => {
  const t = useTranslations();

  const client = useApiClient();
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const scope = {
    instanceId: library.instance.id,
    accountId: library.account.id,
  };
  const review = useQuery({
    queryKey: ["organization-review", scope, operationId, offset],
    enabled: open,
    queryFn: ({ signal }) =>
      client.getOrganizationReview(operationId, offset, signal, scope),
    refetchInterval: 5000,
  });
  const organization = useQuery({
    queryKey: ["organization-review-names", scope],
    enabled: open,
    queryFn: ({ signal }) => client.getOrganization(signal, scope),
    refetchInterval: 5000,
  });
  const nextOffset = review.data?.nextOffset ?? null;
  return (
    <section
      aria-label={t("organizationResult")}
      className="space-y-2 rounded-md border p-3"
    >
      <output>
        {effect.kind === "tag.merge"
          ? t("tagValueMergedIntoValue", [effect.sourceName, effect.targetName])
          : t("valueValueDeleted", [
              effect.kind === "collection.delete" ? t("collection") : t("tag"),
              effect.sourceName,
            ])}{" "}
        {effect.activeCount} {t("activePromptsAnd")} {effect.archivedCount}{" "}
        {t("archivedPrompts3")}{" "}
        {effect.kind === "collection.delete"
          ? t("becameUnassigned")
          : t("hadTheirTagAssignmentsChanged")}
        {t("yourPromptsWereKeptSavedToServer")}
      </output>
      <button
        type="button"
        className="wf-btn"
        onClick={() => {
          setOffset(0);
          setOpen(!open);
        }}
      >
        {t("reviewAffectedPrompts")}
      </button>
      {open ? (
        <>
          <p>
            {t(
              "originalAffectedIdentitiesCurrentStateIsShownBelowLaterChanges"
            )}
          </p>
          {review.isPending ? (
            <output>{t("loadingAffectedPrompts")}</output>
          ) : null}
          {review.isError ? (
            <p role="alert">
              {t("couldNotRefreshTheReview")}{" "}
              <button
                type="button"
                onClick={() => {
                  void review.refetch();
                }}
              >
                {t("retryReview")}
              </button>
            </p>
          ) : null}
          <div className="max-h-72 overflow-y-auto">
            {groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h4 className="font-semibold">{group.label}</h4>
                <ul>
                  {review.data?.prompts.map((entry) =>
                    entry.current?.archived === group.archived ? (
                      <li key={entry.id} className="border-b py-2 break-words">
                        {entry.current?.title} ·{" "}
                        {entry.current?.collectionId
                          ? `Collection: ${organization.data?.collections.find((collection) => collection.id === entry.current?.collectionId)?.name ?? t("unavailable")}`
                          : t("unassigned")}{" "}
                        {t("tags2")}{" "}
                        {entry.current?.tagIds
                          .map(
                            (id) =>
                              organization.data?.tags.find(
                                (tag) => tag.id === id
                              )?.name ?? t("unavailable")
                          )
                          .join(", ") || t("none")}
                      </li>
                    ) : null
                  )}
                </ul>
              </section>
            ))}
            <section aria-label={t("deletedPrompts")}>
              <h4 className="font-semibold">
                {t("deletedSinceThisOperation")}
              </h4>
              <ul>
                {review.data?.prompts.map((entry) =>
                  entry.current ? null : (
                    <li key={entry.id}>
                      {entry.id} {t("originally")}{" "}
                      {entry.originallyArchived ? "archived" : "active"}
                    </li>
                  )
                )}
              </ul>
            </section>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 100))}
            >
              {t("previousAffectedPrompts")}
            </button>
            <button
              type="button"
              disabled={nextOffset === null}
              onClick={() => {
                if (nextOffset !== null) {
                  setOffset(nextOffset);
                }
              }}
            >
              {t("nextAffectedPrompts")}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
};
