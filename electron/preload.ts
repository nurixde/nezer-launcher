import { contextBridge, ipcRenderer } from 'electron';

const listen = (channel: string, callback: (data: any) => void) => {
  const listener = (_: Electron.IpcRendererEvent, data: unknown) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('launcher', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback: (data: unknown) => void) => listen('update:status', callback),
  pickBackground: () => ipcRenderer.invoke('background:pick'),
  getBackground: () => ipcRenderer.invoke('background:get'),
  resetBackground: () => ipcRenderer.invoke('background:reset'),
  searchModrinth: (query: string, kind: string, version?: string) => ipcRenderer.invoke('modrinth:search', query, kind, version),
  installModrinthMod: (projectId: string, version: string) => ipcRenderer.invoke('modrinth:install-mod', projectId, version),
  getFabricLoaders: (version: string) => ipcRenderer.invoke('fabric:loaders', version),
  installFabric: (version: string, loader: string) => ipcRenderer.invoke('fabric:install', version, loader),
  openModrinth: (slug: string, kind: string) => ipcRenderer.invoke('modrinth:open', slug, kind),
  getVersions: () => ipcRenderer.invoke('versions:list'),
  login: () => ipcRenderer.invoke('auth:login'),
  restartLogin: () => ipcRenderer.invoke('auth:restart'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  saveSettings: (next: unknown) => ipcRenderer.invoke('settings:save', next),
  play: (versionId: string) => ipcRenderer.invoke('game:play', versionId),
  stop: () => ipcRenderer.invoke('game:stop'),
  openGameFolder: (folder: string) => ipcRenderer.invoke('folder:open', folder),
  pickJavaPath: () => ipcRenderer.invoke('java:pick'),
  importMods: () => ipcRenderer.invoke('mods:import'),
  listMods: () => ipcRenderer.invoke('mods:list'),
  deleteMod: (name: string) => ipcRenderer.invoke('mods:delete', name),
  openMicrosoftLogin: (url: string) => ipcRenderer.invoke('auth:open-url', url),
  onGameEvent: (callback: (evt: unknown) => void) => listen('game:event', callback),
  onAuthCode: (callback: (code: unknown) => void) => listen('auth:code', callback),
  onLog: (callback: (line: unknown) => void) => listen('game:log', callback),
});
