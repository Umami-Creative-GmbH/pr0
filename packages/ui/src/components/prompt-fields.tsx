"use client";

import type { ReactNode, RefObject } from "react";

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
}) => (
  <>
    <div className="wf-field">
      <label className="wf-label" htmlFor="prompt-title">
        Title (required)
      </label>
      <input
        aria-describedby="prompt-title-help prompt-title-error"
        aria-invalid={Boolean(errors.title)}
        id="prompt-title"
        onChange={(event) => onChange({ ...value, title: event.target.value })}
        placeholder="e.g. Website accessibility audit"
        readOnly={readOnly}
        ref={titleRef}
        value={value.title}
      />
      <p className="wf-hint sr-only" id="prompt-title-help">
        Up to 200 Unicode code points.
      </p>
      <p className="wf-error empty:hidden" id="prompt-title-error">
        {errors.title}
      </p>
    </div>
    {children}
    <div className="wf-field">
      <label className="wf-label" htmlFor="prompt-description">
        Description (optional)
      </label>
      <textarea
        aria-describedby="prompt-description-help prompt-description-error"
        aria-invalid={Boolean(errors.description)}
        className="font-sans"
        id="prompt-description"
        onChange={(event) =>
          onChange({ ...value, description: event.target.value })
        }
        placeholder="One sentence on what this prompt is good for"
        readOnly={readOnly}
        rows={2}
        value={value.description}
      />
      <p className="wf-hint sr-only" id="prompt-description-help">
        Up to 2,000 Unicode code points.
      </p>
      <p className="wf-error empty:hidden" id="prompt-description-error">
        {errors.description}
      </p>
    </div>
    <div className="wf-field">
      <label className="wf-label" htmlFor="prompt-content">
        Content (required)
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
        Up to 256 KiB of UTF-8 text. Indentation and whitespace are preserved.
      </p>
      <p className="wf-error empty:hidden" id="prompt-content-error">
        {errors.content}
      </p>
    </div>
  </>
);
