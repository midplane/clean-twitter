import { isUsable } from './defaults';
import type { CustomFilter, ProviderId, SignalId, Settings, TweetInput } from './types';

/**
 * Jev is reachable two ways. Both take the identical `{model, state, questions}`
 * body and return the identical `{model, answers, usage}` response, so the only
 * per-provider differences are the URL and the model id namespace.
 */
export const PROVIDERS: Record<
  ProviderId,
  {
    label: string;
    name: string;
    url: string;
    defaultModel: string;
    keysUrl: string;
    keyPrefix: string;
  }
> = {
  typesafe: {
    label: 'TypeSafe (direct)',
    name: 'TypeSafe',
    url: 'https://api.typesafe.ai/v1/systemone',
    defaultModel: 'jev-latest',
    keysUrl: 'https://console.typesafe.ai/settings/keys',
    keyPrefix: 'apikey_',
  },
  openrouter: {
    label: 'OpenRouter',
    name: 'OpenRouter',
    url: 'https://openrouter.ai/api/alpha/decisions',
    defaultModel: '~typesafe/jev-latest',
    keysUrl: 'https://openrouter.ai/keys',
    keyPrefix: 'sk-or-',
  },
};

const MAX_RETRY_DELAY_MS = 30_000;

/** $0.042 per million input tokens; output tokens are free. */
const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

type NoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria?: { true: string; false: string };
};
type ScoreQuestion = { type: 'score'; instructions: string; criteria: string[] };
type Question = NoulQuestion | ScoreQuestion;

const SIGNAL_QUESTIONS: Record<SignalId, NoulQuestion> = {
  slop: {
    type: 'noul',
    instructions:
      "The post is low-effort AI-generated or engagement-farming 'slop': formulaic thread-bait, " +
      'hollow motivational platitudes, listicles of truisms, engagement-baiting questions, ' +
      'or text that reads as machine-written filler.',
    criteria: {
      true: 'Formulaic engagement bait or machine-written filler with no specific substance',
      false: 'A genuine post with specific, concrete substance, however casual',
    },
  },
  ragebait: {
    type: 'noul',
    instructions:
      'The post is rage bait: engineered to provoke outrage, tribal anger, or moral panic ' +
      'rather than to inform.',
    criteria: {
      true: 'Inflammatory, dunk-y, or manufactured outrage designed to farm angry replies',
      false: 'Calm or informative, even when it discusses a contentious topic',
    },
  },
  ads: {
    type: 'noul',
    instructions:
      'The post is advertising or promotion: a paid ad, sponsored content, an affiliate or ' +
      'dropshipping pitch, crypto or giveaway shilling, or a thinly veiled sales pitch.',
    criteria: {
      true: 'Primarily selling or promoting something',
      false: 'Not promotional, even if it mentions a product the author likes',
    },
  },
};

export const QUALITY_LEVELS = [
  'Worthless noise',
  'Low value filler',
  'Mildly interesting',
  'Genuinely informative or insightful',
];

const QUALITY_QUESTION: ScoreQuestion = {
  type: 'score',
  instructions: 'The overall informational value of this post to a thoughtful reader.',
  criteria: QUALITY_LEVELS,
};

/** Namespaced so a user's filter can never collide with a built-in signal. */
export const CUSTOM_PREFIX = 'cf_';

export function customKey(filter: CustomFilter): string {
  return CUSTOM_PREFIX + filter.id;
}

export function toQuestion(filter: CustomFilter): Question {
  const question: NoulQuestion = {
    type: 'noul',
    instructions: filter.instructions.trim(),
  };
  // Jev accepts a bare instruction, but both ends of the scale score better.
  if (filter.whenTrue.trim() || filter.whenFalse.trim()) {
    question.criteria = {
      true: filter.whenTrue.trim() || 'The statement is true of this post',
      false: filter.whenFalse.trim() || 'The statement is not true of this post',
    };
  }
  return question;
}

export function activeCustomFilters(settings: Settings): CustomFilter[] {
  return (settings.customFilters ?? []).filter((f) => f.enabled && isUsable(f));
}

export function buildQuestions(settings: Settings): Record<string, Question> {
  const questions: Record<string, Question> = {};
  for (const [id, cfg] of Object.entries(settings.signals)) {
    if (cfg.enabled) questions[id] = SIGNAL_QUESTIONS[id as SignalId];
  }
  if (settings.minQuality > 0) questions.quality = QUALITY_QUESTION;
  for (const filter of activeCustomFilters(settings)) {
    questions[customKey(filter)] = toQuestion(filter);
  }
  return questions;
}

/** A structured record rather than a blob of text, so the model can tell the
 *  author's own words apart from a quoted post. */
export function buildState(tweet: TweetInput): Record<string, unknown> {
  const state: Record<string, unknown> = {
    author_handle: tweet.author,
    author_name: tweet.authorName,
    text: tweet.text,
  };
  if (tweet.quotedText) state.quoted_post = tweet.quotedText;
  const attachments = [tweet.hasImage && 'image', tweet.hasVideo && 'video'].filter(Boolean);
  if (attachments.length) state.attachments = attachments.join(', ');
  if (tweet.isReply) state.is_reply = true;
  return state;
}

export interface NoulAnswer {
  type: 'noul';
  noul: number;
}
export interface ScoreAnswer {
  type: 'score';
  score: number;
  confidence: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
}
export type Answer = NoulAnswer | ScoreAnswer;

export interface SystemOneResponse {
  model: string;
  answers: Record<string, Answer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function costOf(inputTokens: number): number {
  return inputTokens * USD_PER_INPUT_TOKEN;
}

export function resolveModel(settings: { provider: ProviderId; model: string }): string {
  return settings.model.trim() || PROVIDERS[settings.provider].defaultModel;
}

interface CallOptions {
  provider: ProviderId;
  apiKey: string;
  model: string;
  state: unknown;
  questions: Record<string, Question>;
  signal?: AbortSignal;
}

/** Retries 429/529/5xx with exponential backoff. */
export async function callSystemOne(
  opts: CallOptions,
  attempt = 0,
): Promise<SystemOneResponse> {
  const provider = PROVIDERS[opts.provider];
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${opts.apiKey}`,
  };
  // OpenRouter attributes traffic to an app via these; both are optional.
  if (opts.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/midplane/clean-twitter';
    headers['X-Title'] = 'Clean Twitter';
  }

  let res: Response;
  try {
    res = await fetch(provider.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: opts.model,
        state: opts.state,
        questions: opts.questions,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw err;
    throw new ProviderError(`Network error: ${(err as Error).message}`, 0, true);
  }

  if (res.ok) return (await res.json()) as SystemOneResponse;

  const retryable = res.status === 429 || res.status === 529 || res.status >= 500;
  if (retryable && attempt < 3) {
    // Clamped: the wait happens while holding a concurrency slot, so an honoured
    // `retry-after: 3600` would stall every other post behind it for an hour.
    const headerDelay = Number(res.headers.get('retry-after')) * 1000;
    const delay = Number.isFinite(headerDelay) && headerDelay > 0
      ? Math.min(headerDelay, MAX_RETRY_DELAY_MS)
      : 400 * 2 ** attempt + Math.random() * 200;
    await new Promise((r) => setTimeout(r, delay));
    return callSystemOne(opts, attempt + 1);
  }

  throw new ProviderError(await describeError(res), res.status, retryable);
}

async function describeError(res: Response): Promise<string> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? body?.message ?? body?.detail ?? '';
    if (typeof detail !== 'string') detail = JSON.stringify(detail);
  } catch {
    /* non-JSON body */
  }
  switch (res.status) {
    case 401:
    case 403:
      return 'Invalid API key — check it in the extension settings.';
    case 422:
      return `Request rejected: ${detail || 'validation failed'}`;
    case 429:
      return 'Rate limited by the provider. Slow down or try again shortly.';
    default:
      return detail ? `${res.status}: ${detail}` : `Request failed (${res.status})`;
  }
}

/**
 * Scores one custom filter against a sample post, so a filter can be checked
 * before it starts hiding things.
 */
export async function testFilter(
  settings: Settings,
  apiKey: string,
  filter: CustomFilter,
  text: string,
): Promise<{ ok: true; score: number } | { ok: false; error: string }> {
  try {
    const res = await callSystemOne({
      provider: settings.provider,
      apiKey,
      model: resolveModel(settings),
      state: { author_handle: '', author_name: '', text },
      questions: { probe: toQuestion(filter) },
    });
    const answer = res.answers.probe;
    if (answer?.type !== 'noul') return { ok: false, error: 'Unexpected answer type' };
    return { ok: true, score: answer.noul };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** The cheapest round trip that still proves the key works. */
export async function testCredentials(
  provider: ProviderId,
  apiKey: string,
  model: string,
): Promise<{ ok: true; model: string } | { ok: false; error: string }> {
  try {
    const res = await callSystemOne({
      provider,
      apiKey,
      model: model.trim() || PROVIDERS[provider].defaultModel,
      state: 'hello',
      questions: { ping: { type: 'noul', instructions: 'This text is a greeting.' } },
    });
    return { ok: true, model: res.model };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
