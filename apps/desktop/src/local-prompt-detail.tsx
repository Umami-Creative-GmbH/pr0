import type { LocalPrompt } from "@pr0/api-contract/local-prompts";

export const LocalPromptDetail = ({
  value,
  editing,
  onEdit,
  onCopy,
  copying,
}: {
  value: LocalPrompt;
  editing: boolean;
  onEdit: () => void;
  onCopy: () => void;
  copying: boolean;
}) => {
  const { prompt } = value;
  return (
    <article
      aria-label="Prompt detail"
      className="space-y-3 rounded border p-4"
    >
      <h3 className="text-lg font-semibold">{prompt.title}</h3>
      {value.pending ? (
        <>
          <p>Saved on this device</p>
          <p>Changes waiting to sync</p>
          <p>Dates are provisional until server acceptance.</p>
        </>
      ) : (
        <p>Saved to server</p>
      )}
      <p>
        Modified:{" "}
        <time dateTime={prompt.modifiedAt}>
          {new Date(prompt.modifiedAt).toLocaleString()}
        </time>
      </p>
      <button type="button" disabled={editing} onClick={onEdit}>
        Edit prompt
      </button>
      <button type="button" disabled={copying} onClick={onCopy}>
        Copy prompt
      </button>
      {prompt.description ? (
        <p className="whitespace-pre-wrap">{prompt.description}</p>
      ) : null}
      <label className="block" htmlFor="downloaded-content">
        Prompt content
      </label>
      <textarea
        className="min-h-48 w-full rounded border p-3"
        id="downloaded-content"
        readOnly
        value={prompt.content}
      />
    </article>
  );
};
