import { describe, expect, test, beforeAll } from 'bun:test';
import { Window } from 'happy-dom';
import { extractTweet, isPromoted, readMedia, readTweetId } from './extract';

/**
 * Fixtures mirror the shape X renders: a `cellInnerDiv` wrapping an
 * `article[data-testid="tweet"]`, with quoted posts nested inside a
 * `div[role="link"]`.
 */
function tweetHtml(opts: {
  id?: string;
  handle?: string;
  name?: string;
  text?: string;
  quote?: { handle: string; text: string };
  photos?: number;
  video?: boolean;
  gif?: boolean;
  promoted?: boolean;
  /** Promoted posts carry no status permalink at all. */
  noPermalink?: boolean;
  /** X renders the label in a div, not always a span. */
  labelInDiv?: boolean;
  replyingTo?: string;
}) {
  const {
    id = '1234567890',
    handle = '@janedev',
    name = 'Jane',
    text = 'hello world',
    quote,
    photos = 0,
    video = false,
    gif = false,
    promoted = false,
    noPermalink = false,
    labelInDiv = false,
    replyingTo,
  } = opts;

  const label = promoted
    ? labelInDiv
      ? '<div>Ad</div>'
      : '<span>Promoted</span>'
    : '';
  const permalink = noPermalink
    ? ''
    : `<a href="/jane/status/${id}"><time datetime="2026-09-18T10:00:00.000Z">2h</time></a>`;

  return `
  <div data-testid="cellInnerDiv"><div>
    <article data-testid="tweet" role="article">
      ${replyingTo ? `<div data-testid="socialContext">Replying to ${replyingTo}</div>` : ''}
      ${label}
      <div data-testid="User-Name">
        <a href="/jane"><span>${name}</span></a>
        <a href="/jane"><span>${handle}</span></a>
        <span>·</span>
        ${permalink}
      </div>
      <div data-testid="tweetText"><span>${text}</span></div>
      ${Array.from({ length: photos }, () => '<div data-testid="tweetPhoto"><img src="x.jpg"></div>').join('')}
      ${gif ? '<div data-testid="tweetPhoto"><video></video></div>' : ''}
      ${video ? '<div data-testid="videoPlayer"><video></video></div>' : ''}
      ${
        quote
          ? `<div role="link">
               <div data-testid="User-Name"><span>${quote.handle}</span></div>
               <div data-testid="tweetText"><span>${quote.text}</span></div>
             </div>`
          : ''
      }
    </article>
  </div></div>`;
}

let doc: Document;

beforeAll(() => {
  const window = new Window();
  doc = window.document as unknown as Document;
  globalThis.document = doc;
});

function render(html: string): HTMLElement {
  doc.body.innerHTML = html;
  return doc.querySelector('article[data-testid="tweet"]') as unknown as HTMLElement;
}

describe('readTweetId', () => {
  test('reads the status id from the timestamp permalink', () => {
    expect(readTweetId(render(tweetHtml({ id: '999' })))).toBe('999');
  });

  test('returns null when there is no permalink', () => {
    doc.body.innerHTML = '<article data-testid="tweet"><div>no link</div></article>';
    const article = doc.querySelector('article') as unknown as HTMLElement;
    expect(readTweetId(article)).toBeNull();
  });
});

describe('extractTweet', () => {
  test('pulls author, handle and text', () => {
    const t = extractTweet(render(tweetHtml({ text: 'a real post' })))!;
    expect(t.author).toBe('@janedev');
    expect(t.authorName).toBe('Jane');
    expect(t.text).toBe('a real post');
    expect(t.isQuote).toBe(false);
  });

  test('keeps the quoted post separate from the author’s own words', () => {
    const t = extractTweet(
      render(tweetHtml({ text: 'my take', quote: { handle: '@other', text: 'their post' } })),
    )!;
    expect(t.text).toBe('my take');
    expect(t.quotedText).toBe('their post');
    expect(t.isQuote).toBe(true);
  });

  test('detects replies', () => {
    expect(extractTweet(render(tweetHtml({ replyingTo: '@someone' })))!.isReply).toBe(true);
    expect(extractTweet(render(tweetHtml({})))!.isReply).toBe(false);
  });
});

describe('readMedia', () => {
  test('distinguishes photos, video and GIFs', () => {
    expect(readMedia(render(tweetHtml({ photos: 2 })))).toEqual({
      hasImage: true,
      hasVideo: false,
      hasGif: false,
    });
    expect(readMedia(render(tweetHtml({ video: true })))).toEqual({
      hasImage: false,
      hasVideo: true,
      hasGif: false,
    });
    // A GIF renders as a <video> inside tweetPhoto and must not count as either.
    expect(readMedia(render(tweetHtml({ gif: true })))).toEqual({
      hasImage: false,
      hasVideo: false,
      hasGif: true,
    });
  });

  test('a post with both photos and a GIF reports both', () => {
    const media = readMedia(render(tweetHtml({ photos: 2, gif: true })));
    expect(media.hasImage).toBe(true);
    expect(media.hasGif).toBe(true);
  });

  test('a GIF alone is not counted as a video', () => {
    expect(readMedia(render(tweetHtml({ gif: true }))).hasVideo).toBe(false);
  });

  test('a text-only post has no media', () => {
    expect(readMedia(render(tweetHtml({})))).toEqual({
      hasImage: false,
      hasVideo: false,
      hasGif: false,
    });
  });
});

describe('isPromoted', () => {
  test('catches the Promoted label', () => {
    expect(isPromoted(render(tweetHtml({ promoted: true })))).toBe(true);
  });

  test('catches an "Ad" label rendered in a div', () => {
    expect(isPromoted(render(tweetHtml({ promoted: true, labelInDiv: true })))).toBe(true);
  });

  test('does not fire on an ordinary post', () => {
    expect(isPromoted(render(tweetHtml({ text: 'promoted my own work today' })))).toBe(false);
  });

  test('does not fire when the post body merely says "Ad"', () => {
    expect(isPromoted(render(tweetHtml({ text: 'Ad' })))).toBe(false);
  });
});

describe('promoted posts without a permalink', () => {
  const adHtml = tweetHtml({
    promoted: true,
    labelInDiv: true,
    noPermalink: true,
    handle: '@IMTRADERfx01',
    text: "Anybody who's locked in trading? I've an Indian WhatsApp group.",
  });

  test('are still extracted, via a content-hash id', () => {
    const t = extractTweet(render(adHtml))!;
    expect(t).not.toBeNull();
    expect(t.id).toMatch(/^s:/);
    expect(t.promoted).toBe(true);
    expect(t.author).toBe('@IMTRADERfx01');
  });

  test('get a stable id across re-renders, so the verdict caches', () => {
    const first = extractTweet(render(adHtml))!.id;
    const second = extractTweet(render(adHtml))!.id;
    expect(second).toBe(first);
  });

  test('get different ids for different posts', () => {
    const a = extractTweet(render(tweetHtml({ noPermalink: true, text: 'one' })))!.id;
    const b = extractTweet(render(tweetHtml({ noPermalink: true, text: 'two' })))!.id;
    expect(a).not.toBe(b);
  });

  test('a real permalink still wins over the hash', () => {
    expect(extractTweet(render(tweetHtml({ id: '4242' })))!.id).toBe('4242');
  });

  test('an article with neither id nor content is skipped', () => {
    doc.body.innerHTML = '<article data-testid="tweet"><div></div></article>';
    const article = doc.querySelector('article') as unknown as HTMLElement;
    expect(extractTweet(article)).toBeNull();
  });
});
