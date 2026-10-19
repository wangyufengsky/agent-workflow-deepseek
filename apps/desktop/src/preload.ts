import { contextBridge, ipcRenderer } from 'electron';

const desktopApi = {
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
