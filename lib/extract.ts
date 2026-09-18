import { djb2 } from './hash';
import type { TweetInput } from './types';

/**
 * X ships no stable class names, so everything here keys off `data-testid`.
 * Every lookup is defensive: a missing node degrades the extracted post rather
 * than throwing.
 */

export const TWEET_SELECTOR = 'article[data-testid="tweet"]';

/** Cheap enough (no layout-forcing `innerText`) to call on every mutation. */
export function readTweetId(article: HTMLElement): string | null {
  let href: string | null = null;
  try {
    href =
      article
        .querySelector<HTMLAnchorElement>('a[href*="/status/"]:has(time)')
        ?.getAttribute('href') ?? null;
  } catch {
    // `:has()` is unsupported on older engines; fall through to the scan below.
  }
  href ??= findStatusHref(article);
  return href?.match(/\/status\/(\d+)/)?.[1] ?? null;
}

function findStatusHref(article: HTMLElement): string | null {
  for (const a of article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]')) {
    const href = a.getAttribute('href') ?? '';
    if (/^\/[^/]+\/status\/\d+$/.test(href)) return href;
  }
  return null;
}

/** A quoted post lives inside a nested `div[role="link"]`; the outer post does not. */
function isInsideQuote(node: Element, article: HTMLElement): boolean {
  let el: Element | null = node.parentElement;
  while (el && el !== article) {
    if (el.getAttribute('role') === 'link') return true;
    el = el.parentElement;
  }
  return false;
}

/** `innerText` keeps the post's line breaks, which carry meaning for the model. */
function visibleText(node: HTMLElement | null | undefined): string {
  if (!node) return '';
  return (node.innerText ?? node.textContent ?? '').trim();
}

function readText(article: HTMLElement): { text: string; quotedText?: string } {
  let text = '';
  let quotedText: string | undefined;
  for (const node of article.querySelectorAll<HTMLElement>('[data-testid="tweetText"]')) {
    const value = visibleText(node);
    if (!value) continue;
    if (isInsideQuote(node, article)) quotedText ??= value;
    else if (!text) text = value;
  }
  return { text, quotedText };
}

/** Walks the leaf spans rather than splitting `innerText`, because X renders
 *  the name and handle on one line in some views and two in others. */
function readAuthor(article: HTMLElement): { author: string; authorName: string } {
  const block = article.querySelector<HTMLElement>('[data-testid="User-Name"]');
  if (!block) return { author: '', authorName: '' };

  let author = '';
  let authorName = '';
  for (const span of block.querySelectorAll<HTMLElement>('span')) {
    if (span.children.length) continue; // leaf nodes only
    const value = (span.textContent ?? '').trim();
    if (!value || value === '·') continue;
    if (!author && /^@[A-Za-z0-9_]+$/.test(value)) author = value;
    else if (!authorName && !value.startsWith('@')) authorName = value;
  }
  return { author, authorName };
}

/** X labels paid placements, so these cost no model call. */
export function isPromoted(article: HTMLElement): boolean {
  if (article.querySelector('[data-testid="placementTracking"]')) return true;

  // The label sits where a timestamp normally would, and is not always a
  // `<span>`, so scan every leaf element. The post's own body is excluded:
  // someone writing "Ad" in a tweet must not trip this.
  for (const el of article.querySelectorAll<HTMLElement>('span, div')) {
    if (el.children.length) continue;
    if (el.closest('[data-testid="tweetText"]')) continue;
    const label = el.textContent?.trim();
    if (!label) continue;
    if (/^(ad|promoted)$/i.test(label) || /^promoted by /i.test(label)) return true;
  }
  return false;
}

export interface Media {
  hasImage: boolean;
  hasVideo: boolean;
  hasGif: boolean;
}

export function readMedia(article: HTMLElement): Media {
  const hasVideo = !!article.querySelector(
    '[data-testid="videoPlayer"], [data-testid="videoComponent"], video',
  );
  const photos = article.querySelectorAll('[data-testid="tweetPhoto"]');
  let hasGif = false;
  for (const photo of photos) {
    // GIFs render as a muted <video> inside a tweetPhoto, with a "GIF" badge.
    if (photo.querySelector('video') || photo.textContent?.trim() === 'GIF') hasGif = true;
  }
  return {
    hasImage: photos.length > 0 && !hasGif,
    hasVideo: hasVideo && !hasGif,
    hasGif,
  };
}

function isReply(article: HTMLElement): boolean {
  const context = article.querySelector<HTMLElement>('[data-testid="socialContext"]');
  return visibleText(context).startsWith('Replying to');
}

export interface Extracted extends TweetInput {
  media: Media;
  promoted: boolean;
}

/**
 * Promoted posts carry the "Ad" label where the timestamp would be, and have no
 * status permalink at all — so keying only on the status id made the extension
 * blind to exactly the posts it most wants to filter. A content hash gives them
 * a stable key instead: the same author and text means the same verdict.
 */
function syntheticId(author: string, text: string): string | null {
  if (!`${author}${text}`.trim()) return null;
  return `s:${djb2(`${author}\u0000${text}`)}`;
}

export function extractTweet(article: HTMLElement): Extracted | null {
  const { text, quotedText } = readText(article);
  const { author, authorName } = readAuthor(article);
  const media = readMedia(article);

  const id = readTweetId(article) ?? syntheticId(author, text || quotedText || '');
  if (!id) return null;

  return {
    id,
    author,
    authorName,
    text,
    quotedText,
    hasImage: media.hasImage,
    hasVideo: media.hasVideo || media.hasGif,
    isReply: isReply(article),
    isQuote: !!quotedText,
    media,
    promoted: isPromoted(article),
  };
}
