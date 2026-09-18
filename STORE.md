# Chrome Web Store submission

Everything the listing form asks for. Build the package with `pnpm zip`, which
writes `.output/clean-twitter-<version>-chrome.zip`.

## Before you upload

- [ ] Bump `version` in `package.json` — CWS rejects a re-upload at the same version
- [ ] `pnpm zip` and upload the chrome zip
- [ ] Privacy policy URL: once this repo is public, GitHub's rendered view of
      [PRIVACY.md](PRIVACY.md) is a valid public URL for the listing —
      `https://github.com/midplane/clean-twitter/blob/main/PRIVACY.md`

## Single purpose

> Clean Twitter filters low-quality posts out of the user's X/Twitter timeline.
> It classifies each post and hides the ones matching filters the user turns on.

CWS requires one narrow purpose. Everything in the extension serves this one.

## Permission justifications

Paste these into the matching fields.

**`storage`**
> Stores the user's own settings and API key locally, plus a cache of past
> classification results so the same post is not sent for scoring twice.

**Host permission: `*://x.com/*`, `*://twitter.com/*`**
> The extension reads posts from the timeline in order to filter them, and hides
> the ones that match. It also needs tabs.query access to these sites so open
> timelines can be told when the user changes a setting.

**Host permission: `https://api.typesafe.ai/*`, `https://openrouter.ai/api/*`**
> Post text is sent to whichever of these the user chose, using the user's own
> API key, to be classified. No other network requests are made, and there is no
> intermediate server.

**Remote code**: answer **No**. All code is bundled in the package; nothing is
fetched or evaluated at runtime.

## Data-use disclosures

Tick **Website content**, and declare:

- Collected: yes — the text of posts on the user's timeline, plus the author
  handle and display name, is transmitted for classification
- Sold to third parties: no
- Used or transferred for purposes unrelated to the single purpose: no
- Used or transferred to determine creditworthiness or for lending: no

Then certify the three compliance checkboxes.

Note "collected" here means transmitted off-device. The extension keeps no
server-side record — the request goes straight from the user's browser to the
provider under the user's own API key.

## Listing copy

**Short description** (132 characters max)

> Hides AI slop, rage bait and ads from your X timeline. Bring your own API key — your data goes nowhere else.

**Detailed description**

> Clean Twitter reads your timeline and hides the posts you would rather not
> see: AI-generated filler, engineered outrage, and advertising.
>
> Each filter has its own confidence slider, so you decide how aggressive it is.
> Filtered posts collapse to a single line with the reason and a Show button —
> nothing disappears without a trace.
>
> WHAT IT FILTERS
> • AI slop — thread-bait, hollow platitudes, machine-written filler
> • Rage bait — engineered outrage, dunks, manufactured moral panic
> • Ads and shilling — sales pitches, affiliate spam, crypto promos
> • Promoted posts, images, videos and GIFs — read from the page, no API call
> • Your own filters — anything you can phrase as a yes/no question about a post
>
> BRING YOUR OWN KEY
> Classification runs on TypeSafe's Jev model, reached directly or through
> OpenRouter. You supply your own API key and are billed by that provider —
> roughly three cents per thousand posts. There is no account to create and no
> server of ours in between.
>
> WHAT LEAVES YOUR BROWSER
> To classify a post, its text and author name are sent to the provider you
> chose. Direct messages are excluded outright. Images are never uploaded.
> Results are cached, so a post is only ever sent once. Your API key is stored
> locally and sent only to that provider.
>
> Open source: https://github.com/midplane/clean-twitter

**Category**: Social & Communication
**Language**: English

## Screenshots

At least one, 1280x800 or 640x400 PNG. Worth capturing:

1. A timeline with several posts collapsed, reasons visible
2. The popup, filters and sliders visible
3. The custom filter editor mid-"Try it"

Avoid real handles of private individuals in screenshots.

## After submitting

Review usually takes a few days, and can take longer for a first submission or
anything touching host permissions. Rejections cite the specific policy section;
the usual causes here would be a privacy policy that does not mention the data
flow above, or screenshots that do not match what the extension does.
