import { storage } from '#imports';
import {
  activeCustomFilters,
  buildQuestions,
  buildState,
  callSystemOne,
  costOf,
  customKey,
  resolveModel,
  type NoulAnswer,
  type ScoreAnswer,
} from './provider';
import { djb2 } from './hash';
import { activeKey } from './defaults';
import { EMPTY_STATS, statsStore } from './settings';
import type { Settings, SignalId, Stats, TweetInput, Verdict } from './types';

const SIGNAL_LABELS: Record<SignalId, string> = {
  slop: 'AI slop',
  ragebait: 'Rage bait',
  ads: 'Promotional',
};

/** Jev allows 1200 req/min, so this is well inside the limit. */
const MAX_CONCURRENCY = 6;
const CACHE_LIMIT = 5000;

interface CacheEntry {
  scores: Record<string, number>;
  quality?: number;
  /** The question set that produced this; changing filters invalidates it. */
  sig: string;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<Verdict>>();
let cacheLoading: Promise<void> | undefined;
let flushTimer: ReturnType<typeof setTimeout> | undefined;

const cacheStore = storage.defineItem<Record<string, CacheEntry>>('local:verdictCache', {
  fallback: {},
});

function ensureCache(): Promise<void> {
  cacheLoading ??= (async () => {
    const stored = await cacheStore.getValue();
    for (const [id, entry] of Object.entries(stored ?? {})) cache.set(id, entry);
  })();
  return cacheLoading;
}

/**
 * An MV3 service worker can be torn down at any moment, so the cache is written
 * out shortly after each batch rather than on a long interval that may never
 * fire. Losing a write only costs a re-check, never correctness.
 */
function scheduleFlush() {
  if (flushTimer !== undefined) return;
  flushTimer = setTimeout(() => {
    flushTimer = undefined;
    void flushCache();
  }, 2000);
}

async function flushCache() {
  const entries = [...cache.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_LIMIT);
  cache.clear();
  for (const [id, entry] of entries) cache.set(id, entry);
  await cacheStore.setValue(Object.fromEntries(entries));
}

export async function clearCache() {
  cache.clear();
  clearTimeout(flushTimer);
  flushTimer = undefined;
  await cacheStore.setValue({});
}

/** Fingerprints everything that changes a verdict, so stale cache entries
 *  stop matching and get re-checked. */
function questionSignature(settings: Settings): string {
  const on = Object.entries(settings.signals)
    .filter(([, c]) => c.enabled)
    .map(([id]) => id)
    .sort();
  // Hashes the wording too, so editing a filter's text re-checks affected posts.
  const custom = activeCustomFilters(settings)
    .map((f) => `${f.id}:${f.instructions}:${f.whenTrue}:${f.whenFalse}`)
    .sort()
    .join('|');
  return [
    on.join(','),
    `q${settings.minQuality > 0 ? 1 : 0}`,
    resolveModel(settings),
    djb2(custom),
  ].join('|');
}

function decide(id: string, entry: CacheEntry, settings: Settings): Verdict {
  const verdict: Verdict = { id, scores: entry.scores, quality: entry.quality, filtered: false };

  // The strongest signal over its threshold becomes the reason shown.
  let best: { label: string; score: number } | null = null;
  for (const [signal, cfg] of Object.entries(settings.signals)) {
    if (!cfg.enabled) continue;
    const score = entry.scores[signal as SignalId];
    if (score === undefined || score < cfg.threshold) continue;
    if (!best || score > best.score) {
      best = { label: SIGNAL_LABELS[signal as SignalId], score };
    }
  }

  for (const filter of activeCustomFilters(settings)) {
    const score = entry.scores[customKey(filter)];
    if (score === undefined || score < filter.threshold) continue;
    if (!best || score > best.score) best = { label: filter.label.trim(), score };
  }

  if (best) {
    verdict.filtered = true;
    verdict.reason = `${best.label} (${Math.round(best.score * 100)}%)`;
    return verdict;
  }

  if (settings.minQuality > 0 && entry.quality !== undefined && entry.quality < settings.minQuality) {
    verdict.filtered = true;
    verdict.reason = `Low quality (${entry.quality.toFixed(1)}/3)`;
  }
  return verdict;
}

/**
 * Usage is accumulated in memory and flushed on a short timer. Writing straight
 * through would lose counts: up to MAX_CONCURRENCY classifications finish at
 * once, and each would read the same stored total before adding one to it.
 */
let pending: Stats | null = null;
let statsTimer: ReturnType<typeof setTimeout> | undefined;
let statsQueue: Promise<unknown> = Promise.resolve();

function recordUsage(inputTokens: number, filtered: boolean, reason?: string) {
  pending ??= { checked: 0, filtered: 0, bySignal: {}, inputTokens: 0, cost: 0 };
  pending.checked += 1;
  pending.inputTokens += inputTokens;
  pending.cost += costOf(inputTokens);
  if (filtered) {
    pending.filtered += 1;
    if (reason) {
      const label = reason.replace(/\s*\(.*\)$/, '');
      pending.bySignal[label] = (pending.bySignal[label] ?? 0) + 1;
    }
  }

  if (statsTimer !== undefined) return;
  statsTimer = setTimeout(() => {
    statsTimer = undefined;
    statsQueue = statsQueue.then(flushStats).catch(() => undefined);
  }, 1000);
}

async function flushStats() {
  const delta = pending;
  pending = null;
  if (!delta) return;

  const stored = (await statsStore.getValue()) ?? EMPTY_STATS;
  const bySignal = { ...stored.bySignal };
  for (const [label, count] of Object.entries(delta.bySignal)) {
    bySignal[label] = (bySignal[label] ?? 0) + count;
  }
  await statsStore.setValue({
    checked: stored.checked + delta.checked,
    filtered: stored.filtered + delta.filtered,
    bySignal,
    inputTokens: stored.inputTokens + delta.inputTokens,
    cost: stored.cost + delta.cost,
  });
}

/**
 * A failing key or a network outage otherwise shows up only as posts quietly
 * never being filtered, which is indistinguishable from a clean timeline.
 */
export const errorStore = storage.defineItem<{ message: string; at: number } | null>(
  'local:lastError',
  { fallback: null },
);

async function noteError(message: string) {
  await errorStore.setValue({ message, at: Date.now() });
}

async function clearError() {
  if ((await errorStore.getValue()) !== null) await errorStore.setValue(null);
}

let active = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * Jev evaluates every question against a single `state`, so posts are classified
 * one request at a time rather than batched — batching several posts into one
 * state makes the questions ambiguous about which post they refer to.
 */
async function classifyOne(tweet: TweetInput, settings: Settings): Promise<Verdict> {
  const questions = buildQuestions(settings);
  if (Object.keys(questions).length === 0) {
    return { id: tweet.id, scores: {}, filtered: false };
  }

  const res = await withSlot(() =>
    callSystemOne({
      provider: settings.provider,
      apiKey: activeKey(settings),
      model: resolveModel(settings),
      state: buildState(tweet),
      questions,
    }),
  );

  const entry: CacheEntry = { scores: {}, sig: questionSignature(settings), at: Date.now() };
  for (const [key, answer] of Object.entries(res.answers)) {
    if (key === 'quality' && answer.type === 'score') {
      entry.quality = (answer as ScoreAnswer).score;
    } else if (answer.type === 'noul') {
      entry.scores[key] = (answer as NoulAnswer).noul;
    }
  }

  cache.set(tweet.id, entry);
  scheduleFlush();

  const verdict = decide(tweet.id, entry, settings);
  recordUsage(res.usage?.input_tokens ?? 0, verdict.filtered, verdict.reason);
  void clearError();
  return verdict;
}

export async function classify(
  tweets: TweetInput[],
  settings: Settings,
): Promise<Verdict[]> {
  await ensureCache();
  const sig = questionSignature(settings);

  return Promise.all(
    tweets.map(async (tweet) => {
      const hit = cache.get(tweet.id);
      if (hit && hit.sig === sig) return { ...decide(tweet.id, hit, settings), cached: true };

      const pending = inFlight.get(tweet.id);
      if (pending) return pending;

      const promise = classifyOne(tweet, settings)
        .catch((err): Verdict => {
          const message = (err as Error).message;
          void noteError(message);
          return { id: tweet.id, scores: {}, filtered: false, error: message };
        })
        .finally(() => inFlight.delete(tweet.id));

      inFlight.set(tweet.id, promise);
      return promise;
    }),
  );
}
