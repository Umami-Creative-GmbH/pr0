import type { ReactNode } from "react";

import type { Accent } from "../lib/present";

/** Detail heading: collection and state, title, description, tags, actions. */
export const PromptHeader = ({
  title,
  titleId,
  headingLevel = 2,
  description,
  collection,
  accent,
  state,
  tags,
  tagAction,
  children,
}: {
  title: string;
  titleId?: string;
  headingLevel?: 2 | 3;
  description?: string;
  collection: ReactNode;
  accent?: Accent;
  /** Real usage or save state shown beside the collection. */
  state?: ReactNode;
  tags?: string[];
  tagAction?: ReactNode;
  /** The action row: copy, edit, favorite and more. */
  children: ReactNode;
}) => {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return (
    <header className="wf-detail-head">
      <p className="wf-crumb">
        <span className="wf-dot" data-accent={accent} />
        <span>{collection}</span>
        {state ? (
          <>
            <i aria-hidden="true">⦁</i>
            <span>{state}</span>
          </>
        ) : null}
      </p>
      <Heading className="wf-title" id={titleId}>
        {title}
      </Heading>
      {description ? <p className="wf-lede">{description}</p> : null}
      {tags?.length || tagAction ? (
        <div className="wf-tags">
          {tags?.map((tag) => (
            <span className="wf-tag" key={tag}>
              #{tag}
            </span>
          ))}
          {tagAction}
        </div>
      ) : null}
      <div className="wf-actions">{children}</div>
    </header>
  );
};

/** Footer facts about the prompt; each child is one fact. */
export const PromptMeta = ({ children }: { children: ReactNode }) => (
  <footer className="wf-meta">{children}</footer>
);
