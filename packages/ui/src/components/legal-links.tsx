"use client";
import { legalLinkKinds } from "@pr0/api-contract/legal";
import type {
  LegalLinkKind,
  LegalLinks as InstanceLegalLinks,
} from "@pr0/api-contract/legal";
import { ExternalLink } from "lucide-react";
import type { MouseEvent } from "react";

import { useTranslations } from "../hooks/use-translations";

const labels = {
  impressum: "legalNotice",
  privacy: "privacyPolicy",
  terms: "termsOfUse",
} as const satisfies Record<LegalLinkKind, string>;

/**
 * The selected instance operator's legal pages. Unconfigured links are not
 * rendered, and nothing renders without any link.
 */
export const LegalLinks = ({
  links,
  onOpen,
}: {
  links?: InstanceLegalLinks | null;
  /** Native surfaces open the trusted page outside the app window. */
  onOpen?: (kind: LegalLinkKind) => void;
}) => {
  const t = useTranslations();
  const configured = legalLinkKinds.filter((kind) => links?.[kind]);
  if (!configured.length) {
    return null;
  }
  return (
    <footer className="wf-legal">
      <nav aria-label={t("legalInformation")}>
        <ul>
          {configured.map((kind) => (
            <li key={kind}>
              <a
                href={links?.[kind]}
                onClick={
                  onOpen
                    ? (event: MouseEvent<HTMLAnchorElement>) => {
                        event.preventDefault();
                        onOpen(kind);
                      }
                    : undefined
                }
                referrerPolicy="no-referrer"
                rel="noopener noreferrer"
                target="_blank"
              >
                {t(labels[kind])}
                <ExternalLink aria-hidden="true" size={12} />
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
};
