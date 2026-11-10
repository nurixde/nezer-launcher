import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { Authflow, Titles } from 'prismarine-auth';
import { normalizeMicrosoftClientId, normalizeDeviceCode } from './microsoft-client';
import { friendlyAuthError } from './auth-errors';
import { Client } from 'minecraft-launcher-core';
import { autoUpdater } from 'electron-updater';
import { MOD_FILENAME_RE, javaRequirement, safeVersionId } from './manifest';
import { ensureJava } from './java-runtime';
import { InstallProgress, downloadPhase } from './install-progress';

type Stage = 'idle' | 'authenticating' | 'preparing' | 'downloading' | 'launching' | 'running' | 'error';
type VersionType = 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
type Version = { id: string; type: VersionType; releaseTime: string; installed: boolean };
type Profile = { id: string; name: string };
type Settings = {
  launchMode: 'offline' | 'microsoft'; nickname: string; microsoftClientId: string; ramGb: number; javaPath: string; gameDirectory: string;
  keepOpen: boolean; showSnapshots: boolean; serverAddress: string; snowEnabled: boolean; snowIntensity: number; accentColor: string;
};
type MojangManifest = { versions: Array<{ id: string; type: VersionType; releaseTime: string }> };

let window: BrowserWindow | null = null;
let settings: Settings;
let profile: Profile | null = null;
let stage: Stage = 'idle';
let processHandle: ChildProcessWithoutNullStreams | null = null;
let working = false;
let selectedVersion = '';
let knownVersions: Version[] = [];
let loginInProgress = false;
let loginPromise: Promise<Profile> | null = null;

type UpdateStatus = { phase: 'unconfigured'|'idle'|'checking'|'available'|'downloading'|'downloaded'|'latest'|'error'; message: string; version?: string; percent?: number };
let updateStatus: UpdateStatus = { phase:'idle', message:'Готовим проверку обновлений через GitHub Releases.' };
let updateBusy = false;
let updateReady = false;
function emitUpdate(value: UpdateStatus) { updateStatus = value; event('update:status', value); }
function setupUpdates() {
  if (!app.isPackaged || process.platform !== 'win32') {
    emitUpdate({phase:'unconfigured',message:'Обновление внутри приложения работает в установленной Windows-версии, не в режиме разработки.'});
    return;
  }
  try {
    // GitHub Releases is the update provider embedded by electron-builder in app-update.yml.
    // Keep this repository aligned with package.json build.publish and the CI workflow.
    autoUpdater.setFeedURL({provider:'github', owner:'nurixde', repo:'nezer-launcher'});
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on('checking-for-update',()=>emitUpdate({phase:'checking',message:'Проверяем обновления…'}));
    autoUpdater.on('update-available', info=>emitUpdate({phase:'available',message:`Доступна версия ${info.version}`,version:info.version}));
    autoUpdater.on('update-not-available',()=>emitUpdate({phase:'latest',message:'У тебя установлена последняя версия.'}));
    autoUpdater.on('download-progress',p=>emitUpdate({phase:'downloading',message:`Загрузка обновления: ${Math.round(p.percent)}%`,percent:p.percent}));
    autoUpdater.on('update-downloaded',info=>emitUpdate({phase:'downloaded',message:`Версия ${info.version} загружена. Закрой Minecraft и установи обновление.`,version:info.version,percent:100}));
    autoUpdater.on('error',err=>{updateBusy=false;emitUpdate({phase:'error',message:`Не удалось обновить: ${err.message}`})});
    updateReady = true;
    emitUpdate({phase:'idle',message:'GitHub Releases подключён. Можно проверить наличие новой версии.'});
  } catch (e) {emitUpdate({phase:'error',message:`Настройка обновлений: ${e instanceof Error?e.message:String(e)}`});}
}
async function checkUpdates() {
  if (!updateReady) throw new Error('Проверка обновлений доступна только в установленной Windows-версии NEZER LAUNCHER.');
  if (updateBusy || updateStatus.phase==='downloading') throw new Error('Обновление уже выполняется.');
  updateBusy=true;
  try { await autoUpdater.checkForUpdates(); return updateStatus; }
  finally { updateBusy=false; }
}
async function downloadUpdate() {
  if (!updateReady || updateStatus.phase!=='available') throw new Error('Сначала проверь наличие обновления.');
  if (updateBusy) throw new Error('Обновление уже выполняется.');
  updateBusy=true;
  try { await autoUpdater.downloadUpdate(); return updateStatus; }
  finally { updateBusy=false; }
}
function installUpdate() {
  if (updateStatus.phase!=='downloaded') throw new Error('Обновление ещё не скачано.');
  if (working || processHandle || loginInProgress) throw new Error('Закрой Minecraft и дождись окончания операций перед обновлением.');
  setImmediate(()=>autoUpdater.quitAndInstall(false,true));
  return true;
}
const dataDir = () => app.getPath('userData');
const configFile = () => path.join(dataDir(), 'config.json');
const authDir = () => path.join(dataDir(), 'auth-cache');
const versionCache = () => path.join(dataDir(), 'version-manifest.json');
const gameDir = () => settings.gameDirectory;
const event = (channel: string, data: unknown) => {
  if (window && !window.isDestroyed()) window.webContents.send(channel, data);
};
const announce = (newStage: Stage, message: string, percentage?: number) => {
  stage = newStage;
  event('game:event', { stage, message, percentage, versionId: selectedVersion });
};
const log = (line: unknown) => {
  const str = String(line).replace(/[\u0000-\u001f]/g, ' ').slice(0, 600);
  // Never forward authorization arguments or access tokens to UI logs.
  if (/access[_-]?token|--accessToken|Bearer\s|authorization:/i.test(str)) return;
  event('game:log', str);
  console.log('[game]', str);
};
const safeString = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

function defaultSettings(): Settings {
  return {
    launchMode: 'offline', nickname: 'Steve', microsoftClientId: '', ramGb: 4, javaPath: 'auto',
    gameDirectory: path.join(dataDir(), '.minecraft'),
    keepOpen: true, showSnapshots: false, serverAddress: '', snowEnabled: true, snowIntensity: 55, accentColor: '#9466ff'
  };
}
function readConfig(): void {
  const defaults = defaultSettings();
  try {
    const saved = JSON.parse(fs.readFileSync(configFile(), 'utf8')) as { settings?: Partial<Settings>; profile?: Profile | null };
    settings = { ...defaults, ...saved.settings };
    settings.launchMode = settings.launchMode === 'microsoft' ? 'microsoft' : 'offline';
    settings.gameDirectory = settings.gameDirectory || defaults.gameDirectory;
    settings.javaPath = settings.javaPath === 'java' ? 'auto' : (settings.javaPath || 'auto');
    try { settings.microsoftClientId = normalizeMicrosoftClientId(settings.microsoftClientId); }
    catch { settings.microsoftClientId = ''; }
    settings.ramGb = Math.max(2, Math.min(16, Number(settings.ramGb) || 4));
    profile = saved.profile?.id && saved.profile.name ? saved.profile : null;
  } catch {
    settings = defaults;
    profile = null;
  }
}
function saveConfig() {
  fs.mkdirSync(dataDir(), { recursive: true });
  // Only save display name and UUID. Auth access/refresh tokens are managed by prismarine-auth cache.
  fs.writeFileSync(configFile(), JSON.stringify({ settings, profile }, null, 2), 'utf8');
}
function installed(id: string): boolean {
  try {
    safeVersionId(id);
    return fs.existsSync(path.join(gameDir(), 'versions', id, `${id}.json`)) &&
      (fs.existsSync(path.join(gameDir(), 'versions', id, `${id}.jar`)) || id.startsWith('fabric-loader-'));
  } catch { return false; }
}
function listInstalled(): Version[] {
  const folder = path.join(gameDir(), 'versions');
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(id => /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id) && installed(id))
    .map(id => ({ id, type: 'release' as const, releaseTime: '', installed: true }));
}
async function getVersions(): Promise<Version[]> {
  let manifest: MojangManifest | undefined;
  try {
    const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = (await response.json()) as MojangManifest;
    if (!Array.isArray(manifest.versions)) throw new Error('Версии не найдены');
    fs.writeFileSync(versionCache(), JSON.stringify(manifest), 'utf8');
  } catch (err) {
    log(`Не удалось обновить список версий: ${err instanceof Error ? err.message : String(err)}`);
    try { manifest = JSON.parse(fs.readFileSync(versionCache(), 'utf8')) as MojangManifest; }
    catch { /* Use local installs if no network or cache */ }
  }
  const fromManifest = (manifest?.versions ?? [])
    .filter(v => typeof v.id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(v.id))
    .filter(v => ['release', 'snapshot', 'old_alpha', 'old_beta'].includes(v.type))
    .map(v => ({ ...v, installed: installed(v.id) }));
  const seen = new Set(fromManifest.map(v => v.id));
  const merged = [...fromManifest, ...listInstalled().filter(v => !seen.has(v.id))];
  knownVersions = merged;
  return merged;
}
function makeFlow(codeHandler?: (code: unknown) => void, freshLogin = false): Authflow {
  fs.mkdirSync(authDir(), { recursive: true });
  // A user-initiated login should request a new device code. Non-interactive
  // refresh on game launch uses the same provider and saved token cache.
  const clientId = settings.microsoftClientId;
  if (clientId) {
    // Independent Microsoft apps must use MSAL and their own registered public client ID.
    // Minecraft Services can require additional approval for this ID.
    return new Authflow(`nezer-msal-${clientId}`, authDir(), {
      flow: 'msal', authTitle: clientId as Titles, forceRefresh: freshLogin
    }, code => codeHandler?.(code));
  }
  // Legacy path kept for existing users; Microsoft may reject its token exchange.
  return new Authflow('nezer-player', authDir(), {
    flow: 'sisu', authTitle: Titles.MinecraftJava, deviceType: 'Win32', forceRefresh: freshLogin
  }, code => codeHandler?.(code));
}
async function verifiedToken(interactive: boolean): Promise<{ token: string; profile: Profile }> {
  let authStep: 'microsoft' | 'minecraft' = 'microsoft';
  const flow = makeFlow(code => {
    // Live/SISU uses snake_case; MSAL uses camelCase and a Date expiry.
    // Both map to the existing Russian device-code dialog.
    const normalized = normalizeDeviceCode(code);
    if (normalized) event('auth:code', normalized);
  }, interactive);
  try {
    if (interactive) {
      announce('authenticating', 'Подтверди НОВЫЙ код Microsoft из окна лаунчера. Не используй код от прошлой попытки.');
      await flow.getMsaToken();
      authStep = 'minecraft';
      announce('authenticating', 'Microsoft подтверждён. Проверяем Xbox и Minecraft Java Edition…');
    }
    const result = await flow.getMinecraftJavaToken({ fetchEntitlements: true, fetchProfile: true });
    if (!result?.profile?.id || !result.profile.name || !result.token) {
      throw new Error('Microsoft подтвердил вход, но профиль Minecraft Java Edition получить не удалось. Проверь Xbox-профиль, наличие Minecraft Java Edition и соединение с сервисами Minecraft.');
    }
    return { token: result.token, profile: { id: result.profile.id, name: result.profile.name } };
  } catch (err) {
    if (!interactive) throw new Error('Не удалось обновить сессию Microsoft. Открой «Аккаунты» и войди заново.');
    throw new Error(friendlyAuthError(err, authStep));
  }
}
function login(): Promise<Profile> {
  // Reuse the active authorization request instead of starting another one.
  // A second UI click must never generate the «другая операция» error.
  if (loginPromise) return loginPromise;
  if (working) return Promise.reject(new Error('Дождись завершения запуска или работы Minecraft.'));
  loginInProgress = true;
  announce('authenticating', 'Ожидание входа Microsoft…');
  loginPromise = (async () => {
    try {
      const identity = await verifiedToken(true);
      profile = identity.profile;
      settings.nickname = identity.profile.name;
      saveConfig();
      announce('idle', `Авторизация выполнена: ${profile.name}`);
      return profile;
    } catch (e) {
      announce('error', e instanceof Error ? e.message : 'Ошибка входа Microsoft');
      throw e;
    } finally {
      loginInProgress = false;
      loginPromise = null;
    }
  })();
  return loginPromise;
}
function stageName(type: unknown): string {
  switch (downloadPhase(type)) {
    case 'assets': return 'Ресурсы и звуки';
    case 'natives': return 'Библиотеки Windows';
    case 'libraries': return 'Библиотеки Minecraft';
    default: return 'Файлы Minecraft';
  }
}
// Stable Minecraft offline UUID (UUID v3 of the UTF-8 OfflinePlayer name).
function offlineUUID(nickname: string): string {
  const raw = createHash('md5').update(`OfflinePlayer:${nickname}`, 'utf8').digest();
  raw[6] = (raw[6] & 0x0f) | 0x30;
  raw[8] = (raw[8] & 0x3f) | 0x80;
  const hex = raw.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const validNickname = (name: string) => /^[A-Za-z0-9_]{3,16}$/.test(name);

async function play(versionId: string): Promise<void> {
  safeVersionId(versionId);
  if (working || loginInProgress) throw new Error('Дождись завершения текущей операции.');
  if (settings.launchMode === 'microsoft' && !profile) throw new Error('Для режима Microsoft сначала войди в аккаунт. Или выбери локальный запуск.');
  if (settings.launchMode === 'offline' && !validNickname(settings.nickname)) throw new Error('Укажи никнейм 3–16 символов: английские буквы, цифры или _.');
  if (!knownVersions.some(v => v.id === versionId) && !installed(versionId)) {
    throw new Error('Эта версия не найдена в официальном каталоге. Обнови список версий.');
  }
  working = true;
  selectedVersion = versionId;
  announce('preparing', `Проверяем Minecraft ${versionId}…`);
  try {
    const runtimeVersion = versionId.startsWith('fabric-loader-') ? versionId.replace(/^fabric-loader-[^-]+-/, '') : versionId;
    const resolvedJava = await ensureJava(runtimeVersion, settings.javaPath || 'auto', dataDir(), (message, pct) => announce('preparing', message, pct === undefined ? undefined : Math.round(pct * 0.25)));
    announce('preparing', 'Java готова. Проверяем файлы Minecraft…', 25);
    // Microsoft is optional. A locally named session is available without signing in.
    const identity = settings.launchMode === 'microsoft' && profile ? await verifiedToken(false) : null;
    if (identity) { profile = identity.profile; saveConfig(); }
    fs.mkdirSync(gameDir(), { recursive: true });
    const launcher = new Client();
    // MCLC emits phase-local and per-file progress. Never mix these as the
    // percentage of the *whole* installation (the old UI could go 97% -> 89%).
    const installProgress = new InstallProgress();
    let lastProgressLabel = '';
    let lastProgressValue = -1;
    launcher.on('progress', (info: unknown) => {
      const progress = installProgress.progress(info);
      const phaseLabel = stageName(typeof info === 'object' && info !== null ? (info as {type?: unknown}).type : undefined);
      const label = `${phaseLabel}${progress.phasePercent === undefined ? '' : ` — ${progress.phasePercent}% этапа`} · общий прогресс приблизительный`;
      if (progress.percent === lastProgressValue && label === lastProgressLabel) return;
      if (!installProgress.shouldEmit() && progress.percent === lastProgressValue) return;
      lastProgressLabel = label;
      lastProgressValue = progress.percent;
      announce('downloading', label, 25 + Math.round(progress.percent * 0.74));
    });
    // 'download-status' reflects one file, not the entire set. Never use it
    // to set the global progress bar.
    launcher.on('download-status', () => {});
    launcher.on('download', () => { installProgress.downloadedFile(); });
    launcher.on('debug', (line: unknown) => log(line));
    launcher.on('data', (line: unknown) => log(line));
    launcher.on('close', (exitCode: number) => {
      log(`Minecraft завершился (код ${exitCode}).`);
      processHandle = null;
      working = false;
      announce('idle', exitCode === 0 ? 'Игра завершена.' : `Minecraft завершился с кодом ${exitCode}. Проверь журнал.`);
    });
    announce('downloading', 'Проверяем и загружаем необходимые файлы…', 25);
    const server = settings.serverAddress.trim();
    if (server && !/^[a-zA-Z0-9.\-\[\]:]{1,253}$/.test(server)) {
      throw new Error('Неверный адрес сервера. Используй домен или IP, при необходимости с портом.');
    }
    const child = await launcher.launch({
      authorization: {
        access_token: identity?.token ?? '0',
        client_token: randomUUID(),
        uuid: identity?.profile.id ?? offlineUUID(settings.nickname),
        name: identity?.profile.name ?? settings.nickname,
        user_properties: {},
        meta: { type: identity ? 'msa' : 'mojang', demo: false }
      },
      root: gameDir(),
      javaPath: resolvedJava,
      version: { number: versionId, type: knownVersions.find(v => v.id === versionId)?.type || 'release' },
      memory: { min: '2G', max: `${settings.ramGb}G` },
      ...(server ? { quickPlay: { type: (javaRequirement(runtimeVersion) >= 17 ? 'multiplayer' : 'legacy') as 'multiplayer' | 'legacy', identifier: server } } : {}),
      overrides: { detached: false }
    });
    if (!child) throw new Error('Игровой процесс Java не был создан.');
    processHandle = child as ChildProcessWithoutNullStreams;
    log(`Установка: ${JSON.stringify(installProgress.diagnostics())}.`);
    announce('running', 'Minecraft запущен!', 100);
  } catch (e) {
    working = false;
    processHandle = null;
    announce('error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}
function modsPath() { return path.join(gameDir(), 'mods'); }
function listMods(): string[] {
  fs.mkdirSync(modsPath(), { recursive: true });
  return fs.readdirSync(modsPath()).filter(name => MOD_FILENAME_RE.test(name) && fs.statSync(path.join(modsPath(), name)).isFile());
}
async function openFolder(folder: string) {
  if (!['root', 'mods', 'saves', 'resourcepacks', 'logs'].includes(folder)) throw new Error('Недопустимая папка.');
  const target = folder === 'root' ? gameDir() : path.join(gameDir(), folder);
  fs.mkdirSync(target, { recursive: true });
  const err = await shell.openPath(target);
  if (err) throw new Error(err);
}
async function importMods(): Promise<string[]> {
  const result = await dialog.showOpenDialog({
    title: 'Выбери .jar моды для Minecraft',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Minecraft-моды (*.jar)', extensions: ['jar'] }]
  });
  if (result.canceled) return listMods();
  fs.mkdirSync(modsPath(), { recursive: true });
  for (const file of result.filePaths) {
    const name = path.basename(file);
    if (!MOD_FILENAME_RE.test(name)) continue;
    const dest = path.join(modsPath(), name);
    if (path.resolve(dest) !== path.resolve(file)) fs.copyFileSync(file, dest);
  }
  return listMods();
}
function readBackground(): string | null {
  for (const ext of ['png','jpg','jpeg','webp']) {
    const file = path.join(dataDir(), `user-background.${ext}`);
    if (fs.existsSync(file)) {
      if (fs.statSync(file).size > 12 * 1024 * 1024) return null;
      return `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${fs.readFileSync(file).toString('base64')}`;
    }
  }
  return null;
}
async function pickBackground(): Promise<string | null> {
  const result = await dialog.showOpenDialog({properties:['openFile'], filters:[{name:'Изображение',extensions:['png','jpg','jpeg','webp']}]});
  if (result.canceled || !result.filePaths[0]) return null;
  const input = result.filePaths[0], ext = path.extname(input).slice(1).toLowerCase();
  if (!['png','jpg','jpeg','webp'].includes(ext)) throw new Error('Разрешены PNG, JPG и WebP.');
  if (fs.statSync(input).size > 12 * 1024 * 1024) throw new Error('Фон не должен превышать 12 МБ.');
  fs.mkdirSync(dataDir(),{recursive:true});
  for (const old of ['png','jpg','jpeg','webp']) fs.rmSync(path.join(dataDir(), `user-background.${old}`),{force:true});
  fs.copyFileSync(input,path.join(dataDir(),`user-background.${ext}`));
  return readBackground();
}
const fabricVersionPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
async function getFabricLoaders(version: string): Promise<string[]> {
  if (!fabricVersionPattern.test(version)) throw new Error('Некорректная версия Minecraft.');
  const response = await fetch(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(version)}`,{signal: AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Fabric API: HTTP ${response.status}`);
  const result = await response.json() as Array<{loader:{version:string}}>; 
  return result.map(item=>item.loader.version).filter(x=>fabricVersionPattern.test(x));
}
async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(url,{headers:{'User-Agent':'NEZERLauncher/2.0 (Minecraft launcher)'},signal:AbortSignal.timeout(25000)});
  if(!response.ok) throw new Error(`Сервер ответил HTTP ${response.status}`);
  return response.json() as Promise<T>;
}
type Project = { project_id: string; slug: string; title: string; description: string; downloads: number; icon_url?: string };
async function searchProjects(query: string, kind: 'mod' | 'modpack', version?: string): Promise<Project[]> {
  if (!['mod','modpack'].includes(kind)) throw new Error('Неверная категория.');
  const text = safeString(query,70);
  const facets = [[`project_type:${kind}`]];
  if (version && fabricVersionPattern.test(version)) facets.push([`versions:${version}`]);
  if (kind === 'mod') facets.push(['categories:fabric']);
  const params = new URLSearchParams({query:text,facets:JSON.stringify(facets),limit:'24',index:'downloads'});
  const response = await getJSON<{hits:Project[]}>(`https://api.modrinth.com/v2/search?${params}`);
  return (response.hits || []).map(p=>({project_id:p.project_id,slug:p.slug,title:p.title,description:p.description,downloads:p.downloads,icon_url: p.icon_url?.startsWith('https://cdn.modrinth.com/') ? p.icon_url : undefined}));
}
async function installProjectMod(projectId: string, version: string): Promise<string> {
  if (!/^[a-zA-Z0-9_-]{2,90}$/.test(projectId) || !fabricVersionPattern.test(version)) throw new Error('Некорректные параметры мода.');
  const params = new URLSearchParams({loaders:JSON.stringify(['fabric']),game_versions:JSON.stringify([version]),include_changelog:'false'});
  type ModrinthFile = { filename: string; url: string; primary: boolean; hashes:{sha512?:string} };
  const builds = await getJSON<Array<{files:ModrinthFile[]}>>(`https://api.modrinth.com/v2/project/${projectId}/version?${params}`);
  const file = builds[0]?.files?.find(f=>f.primary && f.filename.endsWith('.jar')) ?? builds[0]?.files?.find(f=>f.filename.endsWith('.jar'));
  if (!file || !MOD_FILENAME_RE.test(file.filename)) throw new Error('Для выбранной версии Minecraft нет Fabric-мода.');
  const url = new URL(file.url);
  if(url.protocol !== 'https:' || url.hostname !== 'cdn.modrinth.com') throw new Error('Недоверенный источник загрузки мода.');
  const response = await fetch(url, {signal: AbortSignal.timeout(120000)});
  if (!response.ok) throw new Error(`Ошибка загрузки: ${response.status}`);
  const size = Number(response.headers.get('content-length') || 0);
  if (size > 80_000_000) throw new Error('Файл мода слишком большой.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if(bytes.length > 80_000_000) throw new Error('Файл мода слишком большой.');
  if(file.hashes.sha512 && createHash('sha512').update(bytes).digest('hex') !== file.hashes.sha512) throw new Error('Хеш мода не совпадает.');
  fs.mkdirSync(modsPath(),{recursive:true});
  fs.writeFileSync(path.join(modsPath(),file.filename),bytes);
  return file.filename;
}
async function installFabric(version: string, loader: string): Promise<string> {
  if(working || loginInProgress) throw new Error('Дождись окончания текущей операции.');
  if(!fabricVersionPattern.test(version) || !fabricVersionPattern.test(loader)) throw new Error('Некорректные версии Fabric.');
  const loaders=await getFabricLoaders(version);
  if(!loaders.includes(loader)) throw new Error('Эта версия Fabric Loader несовместима с Minecraft.');
  working = true;
  announce('preparing',`Установка Fabric ${loader} для ${version}…`);
  try {
    const listings = await getJSON<Array<{version:string;stable:boolean}>>('https://meta.fabricmc.net/v2/versions/installer');
    const installer = listings.find(i=>i.stable) ?? listings[0];
    if(!installer || !fabricVersionPattern.test(installer.version)) throw new Error('Не найдена версия установщика Fabric.');
    const url = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${installer.version}/fabric-installer-${installer.version}.jar`;
    const response = await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok) throw new Error(`Не удалось скачать Fabric installer: HTTP ${response.status}`);
    const file = path.join(dataDir(),`fabric-installer-${installer.version}.jar`);
    fs.mkdirSync(dataDir(),{recursive:true});
    fs.writeFileSync(file,Buffer.from(await response.arrayBuffer()));
    const java = await ensureJava(version,settings.javaPath,dataDir(),(msg,pct)=>announce('preparing',msg,pct));
    fs.mkdirSync(gameDir(),{recursive:true});
    await new Promise<void>((resolve,reject)=>{
      const child = spawn(java,['-jar',file,'client','-dir',gameDir(),'-mcversion',version,'-loader',loader,'-noprofile'],{windowsHide:true});
      let errors='';
      child.stdout.on('data',data=>log(String(data)));
      child.stderr.on('data',data=>{errors += String(data).slice(0,600);log(String(data));});
      child.on('error',reject);
      child.on('close',code=>code===0?resolve():reject(new Error(`Fabric installer: ${errors.slice(-300) || `код ${code}`}`)));
    });
    const id = `fabric-loader-${loader}-${version}`;
    announce('idle',`Fabric ${loader} установлен: ${id}`);
    return id;
  } catch(e){announce('error',e instanceof Error?e.message:String(e));throw e;}
  finally {working=false;}
}
function createWindow() {
  window = new BrowserWindow({
    width: 1350, height: 850, minWidth: 1060, minHeight: 700,
    backgroundColor: '#0b0b13',
    title: 'NEZER LAUNCHER',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      webSecurity: true
    }
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (url !== devUrl && !url.startsWith('file://')) event.preventDefault();
  });
  if (process.env.VITE_DEV_SERVER_URL) window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  window.once('ready-to-show', () => window?.show());
  window.on('closed', () => { window = null; });
}

app.whenReady().then(() => {
  readConfig();
  createWindow();
  setupUpdates();
  // Check quietly after launch; downloading and installation always require confirmation.
  if (updateReady) setTimeout(() => { void checkUpdates().catch(() => { /* status is surfaced by updater error event */ }); }, 10000);
  ipcMain.handle('update:status', () => updateStatus);
  ipcMain.handle('update:check', () => checkUpdates());
  ipcMain.handle('update:download', () => downloadUpdate());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('bootstrap', async () => ({
    settings, profile, stage, versions: await getVersions()
  }));
  ipcMain.handle('versions:list', () => getVersions());
  ipcMain.handle('background:get', () => readBackground());
  ipcMain.handle('background:pick', () => pickBackground());
  ipcMain.handle('background:reset', () => { for (const ext of ['png','jpg','jpeg','webp']) fs.rmSync(path.join(dataDir(), `user-background.${ext}`), {force:true}); });
  ipcMain.handle('modrinth:search', (_, query: string, kind: 'mod' | 'modpack', version?: string) => searchProjects(query, kind, version));
  ipcMain.handle('modrinth:install-mod', (_, projectId: string, version: string) => installProjectMod(projectId, version));
  ipcMain.handle('modrinth:open', (_, slug: string, kind: string) => {
    if (!/^[a-zA-Z0-9_-]{2,90}$/.test(slug) || !['mod','modpack'].includes(kind)) throw new Error('Некорректный проект.');
    return shell.openExternal(`https://modrinth.com/${kind}/${slug}`);
  });
  ipcMain.handle('fabric:loaders', (_, version: string) => getFabricLoaders(version));
  ipcMain.handle('fabric:install', (_, version: string, loader: string) => installFabric(version, loader));
  ipcMain.handle('auth:login', () => login());
  ipcMain.handle('auth:restart', () => {
    // prismarine-auth has no cancel API. A relaunch stops the old polling request;
    // makeFlow(..., true) clears incomplete tokens before the next sign-in.
    if (working || processHandle) throw new Error('Нельзя перезапускать вход во время игры.');
    setImmediate(() => { app.relaunch(); app.exit(0); });
    return true;
  });
  ipcMain.handle('auth:logout', () => {
    if (working || loginInProgress) throw new Error('Нельзя выйти во время загрузки или запуска.');
    fs.rmSync(authDir(), { recursive: true, force: true });
    profile = null;
    settings.nickname = '';
    saveConfig();
    announce('idle', 'Вы вышли из аккаунта.');
  });
  ipcMain.handle('auth:open-url', (_, url: unknown) => {
    if (typeof url !== 'string') throw new Error('Некорректный адрес.');
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['www.microsoft.com', 'microsoft.com', 'login.microsoftonline.com', 'login.live.com'].includes(parsed.hostname)) {
      throw new Error('Разрешены только официальные страницы Microsoft.');
    }
    return shell.openExternal(parsed.toString());
  });
  ipcMain.handle('settings:save', (_, next: Partial<Settings>) => {
    if (!next || typeof next !== 'object') throw new Error('Некорректные настройки.');
    if (typeof next.nickname === 'string') {
      const nickname = next.nickname.trim();
      if (!validNickname(nickname)) throw new Error('Никнейм: 3–16 символов (A–Z, 0–9, _).');
      settings.nickname = nickname;
    }
    if (next.launchMode === 'offline' || next.launchMode === 'microsoft') settings.launchMode = next.launchMode;
    if (next.microsoftClientId !== undefined) {
      if (working || loginInProgress) throw new Error('Нельзя менять Microsoft Client ID во время авторизации или запуска.');
      const nextClientId = normalizeMicrosoftClientId(next.microsoftClientId);
      if (nextClientId !== settings.microsoftClientId) {
        settings.microsoftClientId = nextClientId;
        // Profiles and Microsoft token caches must not be mixed across OAuth applications.
        profile = null;
        settings.launchMode = 'offline';
      }
    }
    if (next.ramGb !== undefined) {
      const ram = Number(next.ramGb);
      if (!Number.isInteger(ram) || ram < 2 || ram > 16) throw new Error('ОЗУ: от 2 до 16 ГБ.');
      settings.ramGb = ram;
    }
    if (typeof next.javaPath === 'string') {
      if (next.javaPath.length > 500) throw new Error('Слишком длинный путь к Java.');
      settings.javaPath = next.javaPath.trim() || 'auto';
    }
    if (typeof next.gameDirectory === 'string') {
      if (working || loginInProgress) throw new Error('Нельзя менять путь во время запуска.');
      const candidate = path.resolve(next.gameDirectory.trim());
      if (!path.isAbsolute(candidate) || candidate.length < 4) throw new Error('Укажи полную папку для игры.');
      settings.gameDirectory = candidate;
    }
    if (typeof next.keepOpen === 'boolean') settings.keepOpen = next.keepOpen;
    if (typeof next.showSnapshots === 'boolean') settings.showSnapshots = next.showSnapshots;
    if (typeof next.serverAddress === 'string') settings.serverAddress = safeString(next.serverAddress, 253);
    if (typeof next.snowEnabled === 'boolean') settings.snowEnabled = next.snowEnabled;
    if (Number.isFinite(next.snowIntensity)) settings.snowIntensity = Math.max(0, Math.min(100, Number(next.snowIntensity)));
    if (typeof next.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(next.accentColor)) settings.accentColor = next.accentColor;
    saveConfig();
    return settings;
  });
  ipcMain.handle('game:play', (_, id: string) => play(id));
  ipcMain.handle('game:stop', async () => {
    if (!processHandle) throw new Error('Minecraft не запущен.');
    processHandle.kill();
    announce('launching', 'Останавливаем игру…');
  });
  ipcMain.handle('folder:open', (_, folder: string) => openFolder(folder));
  ipcMain.handle('java:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Выбери java.exe или javaw.exe', properties: ['openFile'],
      filters: [{ name: 'Java Runtime', extensions: ['exe'] }]
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('mods:import', () => importMods());
  ipcMain.handle('mods:list', () => listMods());
  ipcMain.handle('mods:delete', (_, name: string) => {
    if (typeof name !== 'string' || !MOD_FILENAME_RE.test(name)) throw new Error('Недопустимое имя файла.');
    fs.unlinkSync(path.join(modsPath(), name));
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
