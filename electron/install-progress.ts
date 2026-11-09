/** Stable, approximate *installation* progress for MCLC's phase-local events.
 *
 * MCLC emits unrelated progress reports (assets, libraries, native extraction)
 * and download-status for INDIVIDUAL files. Those numbers must not be used as
 * a total installation percentage. We use a conservative monotonic estimate
 * for the progress bar, never declaring 100% until launch has finished.
 */
export type DownloadPhase = 'assets' | 'libraries' | 'natives' | 'other';

export function downloadPhase(value: unknown): DownloadPhase {
  const text = typeof value === 'string' ? value.toLowerCase() : '';
  if (text.includes('asset') || text.includes('resource') || text.includes('sound')) return 'assets';
  if (text.includes('native')) return 'natives';
  if (text.includes('class') || text.includes('librar')) return 'libraries';
  return 'other';
}

export function phaseRatio(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const p = value as Record<string, unknown>;
  const done = Number(p.task ?? p.current ?? p.completed);
  const total = Number(p.total ?? p.max);
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0 || done < 0) return undefined;
  return Math.max(0, Math.min(1, done / total));
}

/** A conservative estimate; not a byte-accurate percent of the download. */
export class InstallProgress {
  private seen = new Map<DownloadPhase, number>();
  private displayed = 0;
  private lastEmission = 0;
  private readonly started = Date.now();
  private fileCount = 0;

  progress(data: unknown): { percent: number; phase: DownloadPhase; phasePercent?: number } {
    const type = typeof data === 'object' && data !== null ? (data as {type?: unknown}).type : undefined;
    const phase = downloadPhase(type);
    const ratio = phaseRatio(data);
    if (ratio !== undefined) this.seen.set(phase, Math.max(this.seen.get(phase) ?? 0, ratio));

    // Each phase's ceiling is an approximate budget. Never exceed 94% while
    // the underlying launcher can still be downloading or extracting files.
    const budgets: Record<DownloadPhase, number> = { libraries: 30, assets: 48, natives: 12, other: 4 };
    let estimate = 0;
    for (const [name, r] of this.seen) estimate += budgets[name] * r;
    this.displayed = Math.min(94, Math.max(this.displayed, Math.floor(estimate)));
    return { percent: this.displayed, phase, phasePercent: ratio === undefined ? undefined : Math.round(ratio * 100) };
  }

  downloadedFile() { this.fileCount++; }
  diagnostics() { return { downloadedFiles: this.fileCount, elapsedSeconds: Math.round((Date.now() - this.started) / 1000) }; }

  shouldEmit(now = Date.now()): boolean {
    if (now - this.lastEmission < 200) return false;
    this.lastEmission = now;
    return true;
  }
}
