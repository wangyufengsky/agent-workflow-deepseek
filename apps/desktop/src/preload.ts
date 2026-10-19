import type { ArtifactExportRequest, ArtifactExportResult, PptNativeExportRequest, PptNativeExportResult } from '@agent-workflow/shared';
import electron from 'electron';

const { contextBridge, ipcRenderer } = electron;

const desktopApi = {
  exportPpt: (input:PptNativeExportRequest):Promise<PptNativeExportResult> => ipcRenderer.invoke('workflow:exportPpt',input),
  exportArtifact: (input: ArtifactExportRequest): Promise<ArtifactExportResult> => ipcRenderer.invoke('workflow:exportArtifact', input),
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('workflow:openExternal', url),
  revealInFileManager: (path: string): Promise<boolean> => ipcRenderer.invoke('workflow:revealInFileManager', path),
  pickDirectory: (): Promise<string | undefined> => ipcRenderer.invoke('workflow:pickDirectory'),
};

contextBridge.exposeInMainWorld('workflowDesktop', desktopApi);

export type WorkflowDesktopApi = typeof desktopApi;
