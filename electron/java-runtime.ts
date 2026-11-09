/** Automatic per-version Eclipse Temurin Java runtime installer (Windows x64). */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { javaRequirement, parseJavaMajor } from './manifest';

export function runtimeMajor(versionId: string): number {
  const min = javaRequirement(versionId);
  // Java 16 is no longer distributed as a current LTS runtime. Java 17
  // supports vanilla 1.17; 8/17/21/25 cover supported and historical versions.
  if (min <= 8) return 8;
  if (min <= 17) return 17;
  if (min <= 21) return 21;
  return 25;
}

export function javaExecutable(runtimeRoot: string, major: number): string {
  return path.join(runtimeRoot, `temurin-${major}`, 'bin', 'java.exe');
}

function exeVersion(exe: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, ['-version'], { windowsHide: true });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Java не ответила.')); }, 12000);
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.stderr.on('data', chunk => { output += chunk.toString(); });
    child.stdout.on('data', chunk => { output += chunk.toString(); });
    child.on('close', code => {
      clearTimeout(timer);
      const version = parseJavaMajor(output);
      code === 0 && version ? resolve(version) : reject(new Error('Неподходящая или повреждённая Java.'));
    });
  });
}

async function runPowershell(script: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // No interpolation of user input: script takes fixed, escaped local paths.
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 1000); });
    child.once('error', err => reject(new Error(`Не удалось запустить распаковку: ${err.message}`)));
    child.once('close', code => code === 0 ? resolve() : reject(new Error(`Распаковка Java завершилась с кодом ${code}: ${stderr.slice(0, 200)}`)));
  });
}

function psQuote(value: string): string { return "'" + value.replace(/'/g, "''") + "'"; }

type TemurinAsset = { binary?: { package?: { link?: string; checksum?: string; name?: string } } };

/** Resolve a real ZIP and its matching checksum from the same Adoptium release. */
export async function resolveTemurinArchive(major: number): Promise<{ url: string; checksum: string }> {
  const endpoint = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse`;
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Не удалось получить информацию о Java ${major}: HTTP ${response.status}.`);
  const releases = await response.json() as TemurinAsset[];
  if (!Array.isArray(releases)) throw new Error('Сервер Java вернул некорректный список выпусков.');
  for (const release of releases) {
    const pkg = release.binary?.package;
    if (!pkg?.link || !pkg.checksum || !pkg.name?.toLowerCase().endsWith('.zip')) continue;
    const url = new URL(pkg.link);
    // Restrict third-party JSON-provided download links to the official Temurin release host.
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
        !url.pathname.startsWith('/adoptium/temurin') || !url.pathname.includes('/releases/download/')) continue;
    const checksum = pkg.checksum.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(checksum)) continue;
    return { url: url.toString(), checksum };
  }
  throw new Error(`Для Java ${major} не найден подходящий Windows x64 ZIP на сервере Adoptium.`);
}

async function downloadWithProgress(url: string, destination: string, progress: (pct: number) => void): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(900000) });
  if (!response.ok || !response.body) throw new Error(`Не удалось скачать Java (HTTP ${response.status}).`);
  const expectedLength = Number(response.headers.get('content-length'));
  let downloaded = 0;
  let lastPercent = -1;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, next) {
      downloaded += chunk.length;
      if (expectedLength > 0) {
        const pct = Math.min(95, Math.round(downloaded / expectedLength * 95));
        if (pct !== lastPercent) { lastPercent = pct; progress(pct); }
      }
      next(null, chunk);
    }
  });
  await pipeline(Readable.fromWeb(response.body as any), counter, fs.createWriteStream(destination, { flags: 'wx' }));
}

function firstJavaDir(folder: string): string | null {
  // Extracted Temurin ZIP has one top-level directory named jdk-*/jre-*.
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const nested = path.join(folder, entry.name);
    if (fs.existsSync(path.join(nested, 'bin', 'java.exe'))) return nested;
  }
  return null;
}

export async function ensureJava(
  versionId: string,
  chosenPath: string,
  root: string,
  onStatus: (message: string, percentage?: number) => void
): Promise<string> {
  if (process.platform !== 'win32') throw new Error('Автоматическая установка Java в этой сборке поддерживает Windows.');
  const major = runtimeMajor(versionId);
  const required = javaRequirement(versionId);
  const preferred = chosenPath.trim();
  // Custom paths have priority. The default "java" is optional and is only
  // used when it already works and matches the selected Minecraft version.
  if (preferred && preferred.toLowerCase() !== 'java' && preferred.toLowerCase() !== 'auto') {
    try {
      const found = await exeVersion(preferred);
      if (found < required) throw new Error(`Для Minecraft ${versionId} требуется Java ${required} или новее, но выбрана Java ${found}.`);
      return preferred;
    } catch (err) {
      throw new Error(`Java по указанному пути недоступна: ${err instanceof Error ? err.message : String(err)}. Очисти путь Java в настройках для автоматической установки.`);
    }
  }
  const rootDir = path.join(root, 'java-runtimes');
  const exe = javaExecutable(rootDir, major);
  if (fs.existsSync(exe)) {
    try { if (await exeVersion(exe) >= required) return exe; } catch { /* repair broken installation */ }
  }
  if (preferred.toLowerCase() === 'java') {
    try {
      const existing = await exeVersion('java');
      if (existing >= required && (major === 8 ? existing === 8 : existing === major)) return 'java';
    } catch { /* Java is not installed on the system; use bundled runtime */ }
  }
  if (process.arch !== 'x64') throw new Error('Автоустановка Java поддерживает Windows x64.');
  fs.mkdirSync(rootDir, { recursive: true });
  const target = path.dirname(path.dirname(exe));
  const staging = path.join(rootDir, `.install-${major}-${Date.now()}`);
  const archive = path.join(staging, 'temurin.zip');
  const extractFolder = path.join(staging, 'extracted');
  fs.mkdirSync(staging, { recursive: true });
  try {
    onStatus(`Java ${major} отсутствует. Скачиваем Eclipse Temurin…`, 0);
    // Metadata includes both the JDK ZIP URL and SHA-256 of the SAME published file.
    // Previous /checksum/latest/.../jre URL could return 404 for some versions.
    const { url, checksum: expected } = await resolveTemurinArchive(major);
    await downloadWithProgress(url, archive, percent => onStatus(`Скачиваем Java ${major}…`, percent));
    onStatus(`Проверяем целостность Java ${major}…`, 95);
    const digest = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
    if (digest !== expected) throw new Error('Проверка SHA-256 Java не прошла. Архив не будет установлен.');
    fs.mkdirSync(extractFolder, { recursive: true });
    onStatus('Распаковываем Java…', 96);
    await runPowershell(`$ErrorActionPreference='Stop'; Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(extractFolder)} -Force`);
    const extracted = firstJavaDir(extractFolder);
    if (!extracted) throw new Error('В скачанном архиве Java не найден java.exe.');
    const stagedExe = path.join(extracted, 'bin', 'java.exe');
    if (await exeVersion(stagedExe) < required) throw new Error('Загруженная Java не подходит для Minecraft.');
    // Atomic directory swap prevents a half-installed runtime being treated as complete.
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(extracted, target);
    onStatus(`Java ${major} установлена и готова.`, 100);
    return exe;
  } catch (e) {
    throw new Error(`Автоматическая установка Java не удалась: ${e instanceof Error ? e.message : String(e)}. Проверь интернет и попробуй снова.`);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
