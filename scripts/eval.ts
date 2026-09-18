/**
 * Runs the extension's real question set over labelled sample posts and reports
 * how the current defaults classify each one. Use it when changing question
 * wording or thresholds.
 *
 *   TYPESAFE_API_KEY=... pnpm eval
 *   PROVIDER=openrouter OPENROUTER_API_KEY=... pnpm eval
 */
import { buildQuestions, buildState, callSystemOne, PROVIDERS, resolveModel } from '../lib/provider';
import { DEFAULT_SETTINGS } from '../lib/defaults';
import type { ProviderId, Settings, TweetInput } from '../lib/types';

type Sample = { label: 'junk' | 'keep'; tweet: Partial<TweetInput> & { text: string } };

const SAMPLES: Sample[] = [
  { label: 'junk', tweet: { author: '@grindsetdaily', text: "Most people will never be rich.\n\nHere's why 🧵\n\n1/ They trade time for money.\n2/ They don't understand leverage.\n3/ They fear discomfort.\n\nRead that again." } },
  { label: 'junk', tweet: { author: '@hustlequotes', text: 'Discipline > motivation.\n\nAgree?' } },
  { label: 'junk', tweet: { author: '@newsrage', text: 'BREAKING: They are LITERALLY coming for your children. Every single one of these people needs to be held accountable NOW. RT IF YOU AGREE 🚨🚨🚨' } },
  { label: 'junk', tweet: { author: '@takesguy', text: 'Imagine being this stupid. Absolute clown. The replies are going to be full of people defending this because they have no principles whatsoever.' } },
  { label: 'junk', tweet: { author: '@shopdeals', text: 'I made $8,400 last month with this ONE simple dropshipping tool. Link in bio. Only 3 spots left at this price 👇 #ad' } },
  { label: 'junk', tweet: { author: '@cryptomoon', text: '🚀 $PEPE2 is about to 100x. Early holders are going to make life changing money. Join the telegram before it is too late. NFA DYOR' } },
  // A real promoted post. Scores only ~0.65 on `ads` because the actual pitch
  // (a "$100,000 MT5 demo account" bonus) is in the image, which Jev can't read.
  // It is caught in the wild by X's own "Ad" label, before any model call.
  { label: 'junk', tweet: { author: '@IMTRADERfx01', text: "🇮🇳 Indian Forex Traders\nAnybody who's locked in trading?\nI've an Indian WhatsApp group with quality people. I invite all those who want to join and share their experience and valuable insights.\nWe don't tolerate anything other than trading. Requesting serious people to kindly DM." } },

  { label: 'keep', tweet: { author: '@janedev', text: "spent the afternoon tracking down a memory leak in our websocket handler. turned out we were never removing the 'close' listener on reconnect. 40 lines of diff, 2GB of RSS saved." } },
  { label: 'keep', tweet: { author: '@sam', text: 'the coffee at this airport is genuinely offensive and i have 4 hours to go' } },
  { label: 'keep', tweet: { author: '@researcher', text: 'New paper: we show that speculative decoding gains collapse once batch size exceeds ~32, because the verification step saturates memory bandwidth. Code and benchmarks linked below.' } },
  { label: 'keep', tweet: { author: '@historian', text: 'A thing people forget about the 1970s oil shocks: the queues at petrol stations were mostly a rationing artefact, not a supply one. The US price controls made shortages worse than the embargo did.' } },
  { label: 'keep', tweet: { author: '@founder', text: "We're hiring two backend engineers in Berlin. Rust and Postgres, mostly. Remote within EU is fine. DMs open if you want to know what the work actually looks like." } },
  { label: 'keep', tweet: { author: '@parent', text: 'my daughter just asked why the moon follows the car and I have been thinking about parallax for twenty minutes' } },
];

const provider = (process.env.PROVIDER ?? 'typesafe') as ProviderId;
const apiKey =
  provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : process.env.TYPESAFE_API_KEY;

if (!apiKey) {
  console.error(`Set ${provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'TYPESAFE_API_KEY'}.`);
  process.exit(1);
}

const settings: Settings = { ...DEFAULT_SETTINGS, provider, minQuality: 1 };
const questions = buildQuestions(settings);
const model = resolveModel(settings);

console.log(`provider=${PROVIDERS[provider].label}  model=${model}\n`);

let tokens = 0;
let correct = 0;
const rows: string[] = [];

await Promise.all(
  SAMPLES.map(async (sample, i) => {
    const tweet: TweetInput = {
      id: String(i),
      author: sample.tweet.author ?? '',
      authorName: '',
      text: sample.tweet.text,
      hasImage: false,
      hasVideo: false,
      isReply: false,
      isQuote: false,
    };

    const res = await callSystemOne({
      provider,
      apiKey: apiKey!,
      model,
      state: buildState(tweet),
      questions,
    });
    tokens += res.usage?.input_tokens ?? 0;

    const scores: Record<string, number> = {};
    let quality = 0;
    for (const [key, answer] of Object.entries(res.answers)) {
      if (answer.type === 'noul') scores[key] = answer.noul;
      else quality = answer.score;
    }

    const hits = Object.entries(settings.signals)
      .filter(([id, cfg]) => cfg.enabled && (scores[id] ?? 0) >= cfg.threshold)
      .map(([id]) => id);
    const filtered = hits.length > 0;
    const ok = filtered === (sample.label === 'junk');
    if (ok) correct++;

    rows[i] =
      `${ok ? ' ok ' : 'MISS'}  ${sample.label.padEnd(4)}  ` +
      `slop=${fmt(scores.slop)} rage=${fmt(scores.ragebait)} ad=${fmt(scores.ads)} ` +
      `q=${quality.toFixed(1)}  ${filtered ? `HIDE[${hits.join(',')}]` : 'keep'}  ` +
      `${sample.tweet.text.replace(/\s+/g, ' ').slice(0, 44)}…`;
  }),
);

console.log(rows.join('\n'));
console.log(
  `\n${correct}/${SAMPLES.length} correct · ${tokens} input tokens · ` +
    `$${(tokens * 0.042e-6).toFixed(6)}`,
);

function fmt(n: number | undefined) {
  return n === undefined ? ' -- ' : n.toFixed(2);
}
