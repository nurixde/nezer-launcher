export type Page = 'home' | 'versions' | 'fabric' | 'mods' | 'packs' | 'accounts' | 'skins' | 'settings';
export type GameStage = 'idle' | 'authenticating' | 'preparing' | 'downloading' | 'launching' | 'running' | 'error';
export interface VersionInfo { id: string; type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'; releaseTime: string; installed: boolean; }
export interface UserProfile { id: string; name: string; }
export interface Settings { launchMode: 'offline' | 'microsoft'; nickname: string; microsoftClientId: string; ramGb: number; javaPath: string; gameDirectory: string; keepOpen: boolean; showSnapshots: boolean; serverAddress: string; snowEnabled: boolean; snowIntensity: number; accentColor: string; }
export interface GameEvent { stage: GameStage; message: string; percentage?: number; versionId?: string; }
export interface AuthCode { userCode: string; verificationUri: string; message?: string; expiresAt?: number; }
export interface Bootstrap { settings: Settings; profile: UserProfile | null; versions: VersionInfo[]; stage: GameStage; }
export interface UpdateStatus { phase:'unconfigured'|'idle'|'checking'|'available'|'downloading'|'downloaded'|'latest'|'error'; message:string; version?:string; percent?:number; }
export interface LauncherAPI {
  getUpdateStatus(): Promise<UpdateStatus>;
  checkUpdates(): Promise<UpdateStatus>;
  downloadUpdate(): Promise<UpdateStatus>;
  installUpdate(): Promise<boolean>;
  onUpdateStatus(callback:(data:UpdateStatus)=>void):()=>void;
  bootstrap(): Promise<Bootstrap>;
  pickBackground(): Promise<string | null>;
  getBackground(): Promise<string | null>;
  resetBackground(): Promise<void>;
  searchModrinth(query: string, kind: 'mod' | 'modpack', version?: string): Promise<ModrinthProject[]>;
  installModrinthMod(projectId: string, version: string): Promise<string>;
  getFabricLoaders(version: string): Promise<string[]>;
  installFabric(version: string, loader: string): Promise<string>;
  openModrinth(slug: string, kind: 'mod' | 'modpack'): Promise<void>;
  getVersions(): Promise<VersionInfo[]>;
  login(): Promise<UserProfile>;
  restartLogin(): Promise<boolean>;
  logout(): Promise<void>;
  saveSettings(next: Partial<Settings>): Promise<Settings>;
  play(versionId: string): Promise<void>;
  stop(): Promise<void>;
  openGameFolder(folder: 'root' | 'mods' | 'saves' | 'resourcepacks' | 'logs'): Promise<void>;
  pickJavaPath(): Promise<string | null>;
  importMods(): Promise<string[]>;
  listMods(): Promise<string[]>;
  deleteMod(name: string): Promise<void>;
  openMicrosoftLogin(url: string): Promise<void>;
  onGameEvent(callback: (evt: GameEvent) => void): () => void;
  onAuthCode(callback: (code: AuthCode) => void): () => void;
  onLog(callback: (line: string) => void): () => void;
}

declare global {
  interface Window { launcher: LauncherAPI; }
}

export interface ModrinthProject { project_id: string; slug: string; title: string; description: string; downloads: number; icon_url?: string; }
