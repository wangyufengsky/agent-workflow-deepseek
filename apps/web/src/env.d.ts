/// <reference types="vite/client" />


interface WorkflowDesktopApi {
  readonly exportArtifact?: (input: import('@agent-workflow/shared').ArtifactExportRequest) => Promise<import('@agent-workflow/shared').ArtifactExportResult>;
  readonly platform: string;
  readonly versions: { readonly electron: string; readonly chrome: string; readonly node: string };
  readonly openExternal: (url: string) => Promise<boolean>;
  readonly revealInFileManager: (path: string) => Promise<boolean>;
  readonly pickDirectory: () => Promise<string | undefined>;
}

interface Window {
  readonly workflowDesktop?: WorkflowDesktopApi;
}
