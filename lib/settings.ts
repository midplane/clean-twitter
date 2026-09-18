import { storage } from '#imports';
import { DEFAULT_SETTINGS, EMPTY_STATS, clampThreshold } from './defaults';
import type { Settings, Stats } from './types';

export { DEFAULT_SETTINGS, EMPTY_STATS, activeKey } from './defaults';

export const settingsStore = storage.defineItem<Settings>('local:settings', {
  fallback: DEFAULT_SETTINGS,
});

export const statsStore = storage.defineItem<Stats>('local:stats', {
  fallback: EMPTY_STATS,
});

/**
 * Merges stored settings over the defaults so a settings object written by an
 * older version of the extension still gets fields added later.
 */
export async function loadSettings(): Promise<Settings> {
  const stored = await settingsStore.getValue();
  const merged: Settings = {
    ...DEFAULT_SETTINGS,
    ...stored,
    signals: { ...DEFAULT_SETTINGS.signals, ...stored?.signals },
    mediaFilters: { ...DEFAULT_SETTINGS.mediaFilters, ...stored?.mediaFilters },
  };
  // Thresholds saved before the floor was raised would otherwise sit below the
  // slider's own minimum, out of reach of the UI that set them.
  for (const cfg of Object.values(merged.signals)) {
    cfg.threshold = clampThreshold(cfg.threshold);
  }
  return merged;
}

/**
 * Writes are serialised because saving is a read-modify-write across an await:
 * dragging a slider fires a burst of changes, and unqueued they would each read
 * the same pre-drag value and clobber one another.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

export function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = writeQueue.then(async () => {
    const merged = { ...(await loadSettings()), ...patch };
    await settingsStore.setValue(merged);
    return merged;
  });
  writeQueue = next.catch(() => undefined);
  return next;
}
