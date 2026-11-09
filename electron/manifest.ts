/* Pure helpers with matching unit tests in tests/manifest.test.cjs */
export const VERSION_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;
export const MOD_FILENAME_RE = /^[^\\/:*?"<>|\x00-\x1f]{1,180}\.jar$/i;

export function safeVersionId(value: string): string {
  if (typeof value !== 'string' || !VERSION_ID_RE.test(value)) {
    throw new Error('Некорректный идентификатор версии Minecraft.');
  }
  return value;
}

export function javaRequirement(version: string): number {
  if (/^\d{2}w\d{2}[a-z]$/i.test(version)) {
    const year = Number(version.slice(0, 2));
    if (year >= 26) return 25;
    if (year >= 24) return 21;
    if (year >= 22) return 17;
    return 8;
  }
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) return 21;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3] || 0);
  if (major >= 26) return 25;
  if (major > 1) return 21;
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 18) return 17;
  if (minor >= 17) return 16;
  return 8;
}

export function parseJavaMajor(output: string): number | null {
  const match = /version\s+"?(\d+)(?:\.(\d+))?/.exec(output) || /openjdk\s+(\d+)/i.exec(output);
  if (!match) return null;
  return Number(match[1]) === 1 ? Number(match[2]) || null : Number(match[1]);
}
