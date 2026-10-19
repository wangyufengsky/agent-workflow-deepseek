import type { ArtifactRef, NodeDetail, OutputFragment } from '@agent-workflow/shared';

export type RequirementLink = NodeDetail['requirementLinks'][number];

/** Sub-view opened from the session feed / attempt artifacts / requirement links. */
export type NodeReaderState =
  | { readonly kind: 'tool'; readonly attemptId: string; readonly fragment: OutputFragment; readonly attemptLabel: string }
  | { readonly kind: 'artifact'; readonly artifact: ArtifactRef; readonly attemptLabel: string }
  | { readonly kind: 'citation'; readonly link: RequirementLink };

export { ToolDetailView } from './ToolDetailView.tsx';

export { ArtifactDetailView } from './ArtifactDetailView.tsx';

export { CitationSourceView } from './CitationSourceView.tsx';
