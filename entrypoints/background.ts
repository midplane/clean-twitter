import { defineBackground, browser } from '#imports';
import { classify, clearCache, errorStore, readError, resetStats } from '@/lib/classifier';
import { loadSettings, settingsStore, statsStore, EMPTY_STATS } from '@/lib/settings';
import { testCredentials, testFilter } from '@/lib/provider';
import { activeKey } from '@/lib/defaults';
import type { Message } from '@/lib/types';

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
    handle(message).then(sendResponse, (err: Error) => sendResponse({ error: err.message }));
    return true; // keeps the message channel open for the async response
  });

  // Cached verdicts survive settings changes: entries record the question set
  // that produced them and thresholds are applied at read time, so moving a
  // threshold costs nothing and enabling a signal re-checks only what it must.
  settingsStore.watch(async () => {
    const tabs = await browser.tabs.query({ url: ['*://x.com/*', '*://twitter.com/*'] });
    for (const tab of tabs) {
      if (tab.id !== undefined) {
        browser.tabs.sendMessage(tab.id, { type: 'settingsChanged' }).catch(() => {
          /* tab has no content script yet */
        });
      }
    }
  });
});

async function handle(message: Message) {
  switch (message.type) {
    case 'classify': {
      const settings = await loadSettings();
      return { verdicts: await classify(message.tweets, settings) };
    }
    case 'getSettings':
      return { settings: await loadSettings() };
    case 'getStats':
      return { stats: (await statsStore.getValue()) ?? EMPTY_STATS };
    // Distinct key: `error` is also how a rejected handler reports itself, and
     // the popup would render that string as if it were the stored object.
    case 'getError':
      return { lastError: await readError() };
    case 'dismissError':
      await errorStore.setValue(null);
      return { ok: true };
    case 'clearCache':
      await clearCache();
      return { ok: true };
    case 'resetStats':
      await resetStats();
      return { ok: true };
    case 'testKey':
      return await testCredentials(message.provider, message.apiKey, message.model);
    case 'testFilter': {
      const settings = await loadSettings();
      const key = activeKey(settings);
      if (!key) return { ok: false, error: 'Add an API key first.' };
      return await testFilter(settings, key, message.filter, message.text);
    }
    default:
      return { error: 'Unknown message' };
  }
}
