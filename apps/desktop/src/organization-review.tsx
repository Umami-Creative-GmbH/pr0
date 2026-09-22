import type {
  LocalOrganization,
  OrganizationLocalImpact,
  OrganizationLocalReview,
} from "@pr0/api-contract/local-organization";
import { LocalizedMessage } from "@pr0/ui/components/localized-message";
import { useTranslations } from "@pr0/ui/hooks/use-translations";
import { translate } from "@pr0/ui/lib/i18n";
import { useEffect, useState } from "react";

import { organizationClient } from "./organization-client";

export const OrganizationReview = ({
  operationId,
  effect,
  snapshot,
}: {
  operationId: string;
  effect: OrganizationLocalImpact["effect"];
  snapshot: LocalOrganization;
}) => {
  const t = useTranslations();

  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const [review, setReview] = useState<OrganizationLocalReview>();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const value = await organizationClient.review(operationId, offset);
        if (!cancelled) {
          setReview(value);
          setError("");
        }
      } catch {
        if (!cancelled) {
          setError(translate("couldNotRefreshTheAffectedPrompts"));
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A new native snapshot invalidates current states of the original affected identities.
  }, [operationId, offset, open, snapshot]);
  return (
    <section
      aria-label={t("organizationResult")}
      className="space-y-2 rounded border p-3"
    >
      <p>
        “{effect.sourceName}”{" "}
        {effect.kind === "tag.merge"
          ? t("mergedIntoValue2", [effect.targetName])
          : "deleted"}
        . {effect.activeCount} {t("activeAnd")} {effect.archivedCount}{" "}
        {t("archivedPromptsAffectedYourPromptsWereKeptSavedOnThis")}
      </p>
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
            {t("originalAffectedIdentitiesCurrentStateIsShownLaterChangesAre")}
          </p>
          <p role="alert">
            <LocalizedMessage value={error} />
          </p>
          {[false, true].map((archived) => (
            <section
              key={String(archived)}
              aria-label={archived ? t("archivedPrompts2") : t("activePrompts")}
            >
              <h3>{archived ? t("archivedPrompts2") : t("activePrompts")}</h3>
              <ul className="max-h-48 overflow-y-auto">
                {review?.prompts.map((entry) =>
                  (entry.current?.archived ?? entry.originallyArchived) ===
                  archived ? (
                    <li key={entry.id}>
                      {entry.current
                        ? `${entry.current.title} · ${snapshot.collections.find((collection) => collection.id === entry.current?.collectionId)?.name ?? t("unassigned")}`
                        : t("promptSubsequentlyDeleted")}
                    </li>
                  ) : null
                )}
              </ul>
            </section>
          ))}
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 100))}
          >
            {t("previousAffectedPrompts")}
          </button>
          <button
            type="button"
            disabled={
              review?.nextOffset === null || review?.nextOffset === undefined
            }
            onClick={() => setOffset(review?.nextOffset ?? offset)}
          >
            {t("nextAffectedPrompts")}
          </button>
        </>
      ) : null}
    </section>
  );
};
