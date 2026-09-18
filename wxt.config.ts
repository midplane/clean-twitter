import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // Don't launch a throwaway browser in dev. Load `.output/chrome-mv3-dev` as an
  // unpacked extension in your own Chrome instead — it keeps your X session, and
  // WXT's reload client still connects to the dev server, so saves auto-apply.
  webExt: { disabled: true },
  manifest: {
    name: 'Clean Twitter',
    description:
      'Filters AI slop, rage bait, ads and media out of your X timeline using TypeSafe Jev.',
    permissions: ['storage'],
    host_permissions: [
      // The background worker calls whichever provider the user picked.
      'https://api.typesafe.ai/*',
      'https://openrouter.ai/api/*',
      // Needed so tabs.query() can find open timelines to push settings changes
      // to; a content_scripts match alone does not grant this.
      '*://x.com/*',
      '*://twitter.com/*',
    ],
    browser_specific_settings: {
      gecko: { id: 'clean-twitter@midplane' },
    },
  },
});
