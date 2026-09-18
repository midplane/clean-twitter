import { defineContentScript, browser } from '#imports';
import { TWEET_SELECTOR, extractTweet, readTweetId, type Extracted } from '@/lib/extract';
import { loadSettings } from '@/lib/settings';
import { activeKey } from '@/lib/defaults';
import type { Settings, TweetInput, Verdict } from '@/lib/types';
import './style.css';

/**
 * Routes whose content must never leave the browser. The content script matches
 * all of x.com, and DMs are private — belt and braces, since direct messages do
 * not render as `article[data-testid="tweet"]` in the first place.
 */
const EXCLUDED_PATHS = [/^\/messages(\/|$)/i, /^\/settings(\/|$)/i];

function onExcludedRoute(): boolean {
  return EXCLUDED_PATHS.some((re) => re.test(location.pathname));
}

/** Posts masked while awaiting a verdict are revealed anyway after this long. */
const FAILSAFE_MS = 6000;
/** Collects posts scrolled into view before sending, to batch the round trip. */
const BATCH_DEBOUNCE_MS = 120;

export default defineContentScript({
  matches: ['*://x.com/*', '*://twitter.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',

  async main() {
    let settings = await loadSettings();

    /** X recycles DOM nodes, so decisions are remembered per status id rather
     *  than per element. */
    const decided = new Map<string, Verdict | 'local'>();
    const revealed = new Set<string>();
    const queue = new Map<string, TweetInput>();
    let flushTimer: number | undefined;

    browser.runtime.onMessage.addListener((message: { type: string }) => {
      if (message.type !== 'settingsChanged') return;
      void (async () => {
        settings = await loadSettings();
        decided.clear();
        queue.clear();
        resetAll();
        scan();
      })();
    });

    const observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.body, { childList: true, subtree: true });
    scan();

    let scanTimer: number | undefined;
    function scheduleScan() {
      if (scanTimer !== undefined) return;
      scanTimer = window.setTimeout(() => {
        scanTimer = undefined;
        scan();
      }, 60);
    }

    function scan() {
      if (!settings.enabled || onExcludedRoute()) return;
      for (const article of document.querySelectorAll<HTMLElement>(TWEET_SELECTOR)) {
        process(article);
      }
    }

    function process(article: HTMLElement) {
      // Our own placeholders re-trigger the observer, so most articles seen
      // here are already settled. But X recycles article nodes for new posts,
      // keeping our attributes, so a settled state counts only if the id matches.
      const settled = article.dataset.ctState !== undefined
        && article.dataset.ctState !== 'pending';
      if (settled && article.dataset.ctId === readTweetId(article)) return;

      const tweet = extractTweet(article);
      if (!tweet) return;

      // Promoted posts have no permalink, so they carry a content-hash id that
      // the cheap check above can't produce; re-compare before reprocessing.
      if (settled) {
        if (article.dataset.ctId === tweet.id) return;
        delete article.dataset.ctState;
      }

      article.dataset.ctId = tweet.id;
      if (revealed.has(tweet.id)) return;
      if (isAllowlisted(tweet.author, settings)) return;

      const prior = decided.get(tweet.id);
      if (prior && prior !== 'local') {
        if (article.dataset.ctState === undefined) applyVerdict(article, tweet, prior);
        return;
      }

      const local = localVerdict(tweet, settings);
      if (local) {
        decided.set(tweet.id, 'local');
        hide(article, tweet.id, local);
        return;
      }
      if (prior === 'local') return;

      if (!needsModel(settings)) return;
      if (!activeKey(settings)) return;
      // A post with no text gives the model nothing to judge.
      if (!tweet.text && !tweet.quotedText) return;

      if (article.dataset.ctState === 'pending') return;
      if (settings.hideUntilChecked) mask(article);

      queue.set(tweet.id, toInput(tweet));
      scheduleFlush();
    }

    function scheduleFlush() {
      if (flushTimer !== undefined) return;
      flushTimer = window.setTimeout(flush, BATCH_DEBOUNCE_MS);
    }

    async function flush() {
      flushTimer = undefined;
      if (queue.size === 0) return;
      const tweets = [...queue.values()];
      queue.clear();

      let verdicts: Verdict[] = [];
      try {
        const res = (await browser.runtime.sendMessage({ type: 'classify', tweets })) as {
          verdicts?: Verdict[];
          error?: string;
        };
        verdicts = res?.verdicts ?? [];
        if (res?.error) console.warn('[clean-twitter]', res.error);
      } catch (err) {
        console.warn('[clean-twitter] classify failed', err);
      }

      const byId = new Map(verdicts.map((v) => [v.id, v]));
      for (const tweet of tweets) {
        const verdict = byId.get(tweet.id);
        if (!verdict || verdict.error) {
          // Failing open: a post is never hidden because the API broke.
          if (verdict?.error) console.warn('[clean-twitter]', verdict.error);
          unmaskById(tweet.id);
          continue;
        }
        decided.set(tweet.id, verdict);
        for (const article of articlesFor(tweet.id)) applyVerdict(article, tweet, verdict);
      }
    }

    function applyVerdict(article: HTMLElement, tweet: TweetInput, verdict: Verdict) {
      if (verdict.filtered && verdict.reason) hide(article, tweet.id, verdict.reason);
      else unmask(article);
    }

    /** The timeline cell wrapping a post; hiding this removes the gap too. */
    function cellOf(article: HTMLElement): HTMLElement {
      return article.closest<HTMLElement>('[data-testid="cellInnerDiv"]') ?? article;
    }

    function articlesFor(id: string): HTMLElement[] {
      const out: HTMLElement[] = [];
      for (const article of document.querySelectorAll<HTMLElement>(TWEET_SELECTOR)) {
        if (article.dataset.ctId === id) out.push(article);
      }
      return out;
    }

    function mask(article: HTMLElement) {
      article.dataset.ctState = 'pending';
      cellOf(article).classList.add('ct-pending');
      window.setTimeout(() => {
        if (article.dataset.ctState === 'pending') unmask(article);
      }, FAILSAFE_MS);
    }

    function unmask(article: HTMLElement) {
      article.dataset.ctState = 'shown';
      cellOf(article).classList.remove('ct-pending');
    }

    function unmaskById(id: string) {
      for (const article of articlesFor(id)) unmask(article);
    }

    function hide(article: HTMLElement, id: string, reason: string) {
      article.dataset.ctState = 'hidden';
      const cell = cellOf(article);
      cell.classList.remove('ct-pending');

      if (settings.hideMode === 'remove') {
        cell.classList.add('ct-removed');
        return;
      }

      cell.classList.add(settings.hideMode === 'blur' ? 'ct-blurred' : 'ct-collapsed');
      if (cell.querySelector('.ct-placeholder')) return;

      const placeholder = document.createElement('div');
      placeholder.className = 'ct-placeholder';
      placeholder.innerHTML =
        '<span class="ct-dot"></span><span class="ct-reason"></span>' +
        '<button type="button" class="ct-show">Show</button>';
      placeholder.querySelector('.ct-reason')!.textContent = reason;
      placeholder.querySelector('.ct-show')!.addEventListener('click', (event) => {
        event.stopPropagation();
        event.preventDefault();
        revealed.add(id);
        cell.classList.remove('ct-collapsed', 'ct-blurred', 'ct-removed');
        article.dataset.ctState = 'revealed';
        placeholder.remove();
      });
      cell.prepend(placeholder);
    }

    function resetAll() {
      for (const node of document.querySelectorAll('.ct-placeholder')) node.remove();
      for (const cell of document.querySelectorAll<HTMLElement>(
        '.ct-pending, .ct-collapsed, .ct-blurred, .ct-removed',
      )) {
        cell.classList.remove('ct-pending', 'ct-collapsed', 'ct-blurred', 'ct-removed');
      }
      for (const article of document.querySelectorAll<HTMLElement>(TWEET_SELECTOR)) {
        delete article.dataset.ctState;
      }
    }
  },
});

function toInput(t: Extracted): TweetInput {
  return {
    id: t.id,
    author: t.author,
    authorName: t.authorName,
    text: t.text,
    quotedText: t.quotedText,
    hasImage: t.hasImage,
    hasVideo: t.hasVideo,
    isReply: t.isReply,
    isQuote: t.isQuote,
  };
}

function needsModel(s: Settings): boolean {
  return Object.values(s.signals).some((c) => c.enabled) || s.minQuality > 0;
}

function isAllowlisted(author: string, s: Settings): boolean {
  if (!author) return false;
  const handle = author.replace(/^@/, '').toLowerCase();
  return s.allowlist.some((h) => h.replace(/^@/, '').toLowerCase() === handle);
}

/** Filters that need no model call. Returns a reason string when it matches. */
function localVerdict(tweet: Extracted, s: Settings): string | null {
  if (s.hidePromoted && tweet.promoted) return 'Promoted';
  if (s.mediaFilters.images && tweet.media.hasImage) return 'Image post';
  if (s.mediaFilters.videos && tweet.media.hasVideo) return 'Video post';
  if (s.mediaFilters.gifs && tweet.media.hasGif) return 'GIF post';
  return null;
}
