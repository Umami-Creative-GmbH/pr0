import { FileText } from "lucide-react";

export const PromptContent = ({
  content,
  label,
}: {
  content: string;
  label: string;
}) => (
  <div className="wf-content">
    <div className="wf-content-heading">
      <FileText size={13} aria-hidden="true" />
      Prompt
    </div>
    <textarea aria-label={label} readOnly value={content} rows={12} />
  </div>
);
