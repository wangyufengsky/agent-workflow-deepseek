import type { ArtifactRef, NodeDetail, OutputFragment } from '@agent-workflow/shared';
import type { NodeCitation } from './node-citations.ts';

export type RequirementLink = NodeDetail['requirementLinks'][number];

/** Sub-view opened from the session feed / attempt artifacts / citations / tools. */
export type NodeReaderState =
  | { readonly kind: 'tool'; readonly attemptId: string; readonly fragment: OutputFragment; readonly attemptLabel: string }
  | { readonly kind: 'artifact'; readonly artifact: ArtifactRef; readonly attemptLabel: string }
  | { readonly kind: 'citation'; readonly link: RequirementLink }
  | { readonly kind: 'structured-citation'; readonly citation: NodeCitation; readonly attemptLabel: string };

export { ToolDetailView } from './ToolDetailView.tsx';

export { ArtifactDetailView } from './ArtifactDetailView.tsx';

export { CitationSourceView, CitationDetailView } from './CitationSourceView.tsx';
