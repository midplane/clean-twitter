# Privacy Policy — Clean Twitter

**Last updated: 18 September 2026**

Clean Twitter is a browser extension that hides low-quality posts on X (Twitter).
To decide what to hide, it sends the text of posts to an AI provider that you
choose and pay for directly. This policy describes exactly what is sent, what is
stored, and what is not.

There is no server operated by the developer of this extension. Requests go
directly from your browser to your chosen provider, authenticated with your own
API key.

## What is sent off your device

When the extension encounters a post it has not already classified, and you have
enabled at least one AI-backed filter and supplied an API key, it sends the
following fields for that post to your selected provider:

| Field | Contents |
| --- | --- |
| `author_handle` | The post author's @handle |
| `author_name` | The post author's display name |
| `text` | The text of the post |
| `quoted_post` | The text of a quoted post, when there is one |
| `attachments` | Whether the post carries an image and/or a video |
| `is_reply` | Whether the post is a reply |

Alongside these it sends the filter questions themselves and your API key, used
as a bearer token so the provider can authenticate and bill you.

Nothing else is transmitted. In particular the extension does **not** send:

- **Images, video, or audio.** The model is text-only; media is described only
  as the words "image" or "video".
- **Direct messages.** The extension does not run on `/messages`, nor on
  `/settings`. Those routes are excluded in code before any post is read.
- **Your identity.** No account, no email address, no login, no device or
  browser identifier, and no X/Twitter session data or cookies.
- **Your browsing history**, or any page other than posts on an X timeline.
- **Posts it has already judged.** Results are cached, so a given post is sent
  at most once.

## Where it is sent

To whichever provider you select in the extension's settings, and only that one:

- **TypeSafe** — `https://api.typesafe.ai/v1/systemone`
  ([privacy policy](https://docs.typesafe.ai/legal))
- **OpenRouter** — `https://openrouter.ai/api/alpha/decisions`
  ([privacy policy](https://openrouter.ai/privacy))

Your relationship for this data is with that provider, under their policy and
your account with them. Please read their policy before choosing one. The
extension makes no other network requests of any kind.

## What is stored, and where

Everything the extension stores is kept locally in your own browser, using the
browser's extension storage. None of it is transmitted anywhere, and none of it
is accessible to the developer.

- **Your settings**, including your API key and any filters you have written
- **A cache of past results** — post identifiers and the resulting scores,
  capped at 5,000 entries, so the same post is never sent twice
- **Counters** — how many posts have been checked and filtered, and the
  resulting token spend
- **The most recent API error**, so a failure can be shown in the popup

Your API key is stored locally, is never logged, and is sent only to the
provider you selected. Uninstalling the extension deletes all of this. You can
clear the cache and reset the counters at any time from the settings page.

## What is not done with your data

- It is never sold or rented.
- It is never shared with anyone other than the provider you select.
- It is never used for advertising, profiling, or creditworthiness.
- It is never used for any purpose beyond deciding whether to hide a post.
- There is no analytics, telemetry, crash reporting, or tracking of any kind.

## Children

This extension is not directed at children under 13 and is not intended for
their use.

## Changes

Material changes to this policy will be published in this file, with an updated
date above. The file's revision history is public at
<https://github.com/midplane/clean-twitter/commits/main/PRIVACY.md>.

## Contact

Questions about this policy: open an issue at
<https://github.com/midplane/clean-twitter/issues>.
