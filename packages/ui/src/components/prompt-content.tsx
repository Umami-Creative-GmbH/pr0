import { FileText } from "lucide-react";

import { useTranslations } from "../hooks/use-translations";

export interface ContentSpan {
  text: string;
  variable?: string;
}

const variableCount = (spans: ContentSpan[]) =>
  new Set(spans.flatMap((span) => (span.variable ? [span.variable] : []))).size;

/**
 * Shows the exact stored template in a selectable read-only field. `spans`
 * (from the canonical template scanner) paint variable tokens beneath it.
 */
export const PromptContent = ({
  content,
  label,
  spans,
}: {
  content: string;
  label: string;
  spans: ContentSpan[];
}) => {
  const t = useTranslations();
  const count = variableCount(spans);
  return (
    <div className="wf-panel">
      <div className="wf-panel-head">
        <FileText size={13} aria-hidden="true" />
        {t("prompt")}
        <span className="wf-grow" />
        <span>
          {count
            ? t(count === 1 ? "oneVariable" : "manyVariables", [count])
            : t("noVariables")}
        </span>
      </div>
      <div className="wf-panel-body">
        <div className="wf-code">
          <pre aria-hidden="true">
            {spans.map((span, index) =>
              span.variable ? (
                // oxlint-disable-next-line react/no-array-index-key -- Spans are positional slices of one immutable string.
                <mark className="wf-var" key={index}>
                  {span.text}
                </mark>
              ) : (
                // oxlint-disable-next-line react/no-array-index-key -- Spans are positional slices of one immutable string.
                <span key={index}>{span.text}</span>
              )
            )}
            {/* A trailing newline needs a box so both layers keep equal height. */}
            {content.endsWith("\n") ? " " : null}
          </pre>
          <textarea aria-label={label} readOnly value={content} rows={1} />
        </div>
      </div>
    </div>
  );
};
