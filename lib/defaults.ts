/** Free of extension-runtime imports, so build scripts and the eval harness
 *  can use these outside the browser. */
import { djb2 } from './hash';
import type { CustomFilter, Settings, Stats } from './types';

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,

  provider: 'typesafe',
  typesafeApiKey: '',
  openrouterApiKey: '',
  model: '',

  signals: {
    slop: { enabled: true, threshold: 0.7 },
    ragebait: { enabled: true, threshold: 0.7 },
    ads: { enabled: true, threshold: 0.6 },
  },

  minQuality: 0,

  customFilters: [],

  mediaFilters: {
    images: false,
    videos: false,
    gifs: false,
  },

  hidePromoted: true,
  hideMode: 'collapse',
  hideUntilChecked: false,
  allowlist: [],
};

/**
 * The floor sits at 0.5 deliberately. Legitimate posts do reach the low 0.3s on
 * a signal — a genuine hiring post scored 0.31 for `ads` in the eval set — so a
 * lower bound would let the UI offer settings that hide real posts.
 */
export const THRESHOLD_MIN = 0.5;
export const THRESHOLD_MAX = 0.95;

/** Kept small so one request stays well inside Jev's 64k question budget. */
export const MAX_CUSTOM_FILTERS = 12;

export function newCustomFilter(): CustomFilter {
  return {
    id: djb2(`${Date.now()}:${Math.random()}`),
    label: '',
    instructions: '',
    whenTrue: '',
    whenFalse: '',
    enabled: true,
    threshold: 0.7,
  };
}

/** A filter with no label or instructions is a half-finished draft, not a question. */
export function isUsable(filter: CustomFilter): boolean {
  return filter.label.trim().length > 0 && filter.instructions.trim().length > 0;
}

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SETTINGS.signals.slop.threshold;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, value));
}

export const EMPTY_STATS: Stats = {
  checked: 0,
  filtered: 0,
  bySignal: {},
  inputTokens: 0,
  cost: 0,
};

export function activeKey(s: Settings): string {
  return s.provider === 'openrouter' ? s.openrouterApiKey : s.typesafeApiKey;
}
