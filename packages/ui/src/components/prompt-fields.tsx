"use client";
import type { ReactNode, RefObject } from "react";

import { useTranslations } from "../hooks/use-translations";
import { LocalizedMessage } from "./localized-message";

export interface PromptFieldsValue {
  title: string;
  description: string;
  content: string;
}
export const PromptFields = ({
  value,
  onChange,
  readOnly,
  errors,
  titleRef,
  children,
}: {
  value: PromptFieldsValue;
  onChange: (value: PromptFieldsValue) => void;
  readOnly: boolean;
  errors: Record<string, string>;
  titleRef: RefObject<HTMLInputElement | null>;
  /** Organization controls, placed between the title and the description. */
  children?: ReactNode;
}) => {
  const t = useTranslations();
  return (
    <>
      <div className="wf-field">
        <label className="wf-label" htmlFor="prompt-title">
          {t("titleRequired")}
        </label>
        <input
          aria-describedby="prompt-title-help prompt-title-error"
          aria-invalid={Boolean(errors.title)}
          id="prompt-title"
          onChange={(event) =>
            onChange({ ...value, title: event.target.value })
          }
          placeholder={t("eGWebsiteAccessibilityAudit")}
          readOnly={readOnly}
          ref={titleRef}
          value={value.title}
        />
        <p className="wf-hint sr-only" id="prompt-title-help">
          {t("upTo200UnicodeCodePoints")}
        </p>
        <p className="wf-error empty:hidden" id="prompt-title-error">
          <LocalizedMessage value={errors.title} />
        </p>
      </div>
      {children}
      <div className="wf-field">
        <label className="wf-label" htmlFor="prompt-description">
          {t("descriptionOptional")}
        </label>
        <textarea
          aria-describedby="prompt-description-help prompt-description-error"
          aria-invalid={Boolean(errors.description)}
          className="font-sans"
          id="prompt-description"
          onChange={(event) =>
            onChange({ ...value, description: event.target.value })
          }
          placeholder={t("oneSentenceOnWhatThisPromptIsGoodFor")}
          readOnly={readOnly}
          rows={2}
          value={value.description}
        />
        <p className="wf-hint sr-only" id="prompt-description-help">
          {t("upTo2000UnicodeCodePoints")}
        </p>
        <p className="wf-error empty:hidden" id="prompt-description-error">
          <LocalizedMessage value={errors.description} />
        </p>
      </div>
      <div className="wf-field">
        <label className="wf-label" htmlFor="prompt-content">
          {t("contentRequired")}
        </label>
        <textarea
          aria-describedby="prompt-content-help prompt-content-error"
          aria-invalid={Boolean(errors.content)}
          data-size="lg"
          id="prompt-content"
          onChange={(event) =>
            onChange({ ...value, content: event.target.value })
          }
          readOnly={readOnly}
          rows={10}
          value={value.content}
        />
        <p className="wf-hint" id="prompt-content-help">
          {t("upTo256KibOfUtf8TextIndentationAnd")}
        </p>
        <p className="wf-error empty:hidden" id="prompt-content-error">
          <LocalizedMessage value={errors.content} />
        </p>
      </div>
    </>
  );
};
