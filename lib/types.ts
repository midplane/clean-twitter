export type ProviderId = 'typesafe' | 'openrouter';

/** Filters that require a model call. */
export type SignalId = 'slop' | 'ragebait' | 'ads';

/** Filters resolved locally from the DOM, with no model call. */
export type MediaFilterId = 'images' | 'videos' | 'gifs';

export type HideMode = 'collapse' | 'blur' | 'remove';

/**
 * A yes/no question the user wrote themselves. Jev takes arbitrary instructions
 * and evaluates every question in one request against the same post, so each
 * extra filter costs only its own instruction text — roughly 100 tokens.
 */
export interface CustomFilter {
  id: string;
  /** Shown in the UI, and as the reason on a filtered post. */
  label: string;
  instructions: string;
  /** Optional, but pins down both ends of the scale and improves accuracy a lot. */
  whenTrue: string;
  whenFalse: string;
  enabled: boolean;
  threshold: number;
}

export interface Settings {
  enabled: boolean;

  provider: ProviderId;
  /** Stored per provider so switching back and forth doesn't lose a key. */
  typesafeApiKey: string;
  openrouterApiKey: string;
  /** Empty string means "use the provider default". */
  model: string;

  signals: Record<SignalId, { enabled: boolean; threshold: number }>;

  /** Drop anything rated below this on the 0-3 quality scale. 0 disables. */
  minQuality: number;

  customFilters: CustomFilter[];

  mediaFilters: Record<MediaFilterId, boolean>;
  hidePromoted: boolean;
  hideMode: HideMode;

  /** Mask posts until a verdict arrives, so filtered posts never flash into view. */
  hideUntilChecked: boolean;
  allowlist: string[];
}

export interface TweetInput {
  id: string;
  author: string;
  authorName: string;
  text: string;
  hasImage: boolean;
  hasVideo: boolean;
  isReply: boolean;
  isQuote: boolean;
  quotedText?: string;
}

export interface Verdict {
  id: string;
  /** Probability per question id, 0-1. Built-in signals and custom filters. */
  scores: Record<string, number>;
  /** 0-3, higher is better. */
  quality?: number;
  filtered: boolean;
  /** Shown to the user, e.g. "AI slop (92%)". */
  reason?: string;
  /** Set when classification failed; the post is left visible. */
  error?: string;
  cached?: boolean;
}

export type Message =
  | { type: 'classify'; tweets: TweetInput[] }
  | { type: 'getSettings' }
  | { type: 'settingsChanged' }
  | { type: 'getStats' }
  | { type: 'resetStats' }
  | { type: 'clearCache' }
  | { type: 'getError' }
  | { type: 'dismissError' }
  | { type: 'testKey'; provider: ProviderId; apiKey: string; model: string }
  | { type: 'testFilter'; filter: CustomFilter; text: string };

export interface Stats {
  checked: number;
  filtered: number;
  bySignal: Record<string, number>;
  inputTokens: number;
  /** USD. */
  cost: number;
}
