"use client";

import type { RefObject } from "react";

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
}: {
  value: PromptFieldsValue;
  onChange: (value: PromptFieldsValue) => void;
  readOnly: boolean;
  errors: Record<string, string>;
  titleRef: RefObject<HTMLInputElement | null>;
}) => (
  <div className="space-y-4">
    <div>
      <label className="block font-medium" htmlFor="prompt-title">
        Title (required)
      </label>
      <input
        aria-describedby="prompt-title-help prompt-title-error"
        aria-invalid={Boolean(errors.title)}
        className="bg-background mt-2 w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
        id="prompt-title"
        onChange={(event) => onChange({ ...value, title: event.target.value })}
        readOnly={readOnly}
        ref={titleRef}
        value={value.title}
      />
      <p className="text-muted-foreground text-sm" id="prompt-title-help">
        Up to 200 Unicode code points.
      </p>
      <p className="text-sm" id="prompt-title-error">
        {errors.title}
      </p>
    </div>
    <div>
      <label className="block font-medium" htmlFor="prompt-description">
        Description (optional)
      </label>
      <textarea
        aria-describedby="prompt-description-help prompt-description-error"
        aria-invalid={Boolean(errors.description)}
        className="bg-background mt-2 w-full rounded-md border px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2"
        id="prompt-description"
        onChange={(event) =>
          onChange({ ...value, description: event.target.value })
        }
        readOnly={readOnly}
        rows={2}
        value={value.description}
      />
      <p className="text-muted-foreground text-sm" id="prompt-description-help">
        Up to 2,000 Unicode code points.
      </p>
      <p className="text-sm" id="prompt-description-error">
        {errors.description}
      </p>
    </div>
    <div>
      <label className="block font-medium" htmlFor="prompt-content">
        Content (required)
      </label>
      <textarea
        aria-describedby="prompt-content-help prompt-content-error"
        aria-invalid={Boolean(errors.content)}
        className="bg-background mt-2 w-full rounded-md border px-3 py-2 font-mono focus-visible:outline-2 focus-visible:outline-offset-2"
        id="prompt-content"
        onChange={(event) =>
          onChange({ ...value, content: event.target.value })
        }
        readOnly={readOnly}
        rows={10}
        value={value.content}
      />
      <p className="text-muted-foreground text-sm" id="prompt-content-help">
        Up to 256 KiB of UTF-8 text. Indentation and whitespace are preserved.
      </p>
      <p className="text-sm" id="prompt-content-error">
        {errors.content}
      </p>
    </div>
  </div>
);
