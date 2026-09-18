import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { loadSettings, saveSettings } from '@/lib/settings';
import { PROVIDERS } from '@/lib/provider';
import CustomFilters from './CustomFilters';
import type { HideMode, ProviderId, Settings, Stats } from '@/lib/types';

const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

const HIDE_MODES: Array<{ id: HideMode; label: string; hint: string }> = [
  { id: 'collapse', label: 'Collapse', hint: 'Replace the post with a one-line note' },
  { id: 'blur', label: 'Blur', hint: 'Blur the post but leave it in place' },
  { id: 'remove', label: 'Remove', hint: 'Delete it from the timeline entirely' },
];

type TestState = { status: 'idle' | 'testing' | 'ok' | 'error'; message?: string };

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [allowlistText, setAllowlistText] = useState('');

  useEffect(() => {
    loadSettings().then((s) => {
      setSettings(s);
      setAllowlistText(s.allowlist.join('\n'));
    });
    refreshStats();
  }, []);

  function refreshStats() {
    browser.runtime
      .sendMessage({ type: 'getStats' })
      .then((r: { stats?: Stats }) => setStats(r?.stats ?? null))
      .catch(() => {});
  }

  async function update(patch: Partial<Settings>) {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettings(await saveSettings(patch));
  }

  if (!settings) return <main className="card">Loading…</main>;

  const provider = PROVIDERS[settings.provider];
  const keyField = settings.provider === 'openrouter' ? 'openrouterApiKey' : 'typesafeApiKey';
  const apiKey = settings[keyField];

  async function runTest() {
    setTest({ status: 'testing' });
    const res = (await browser.runtime.sendMessage({
      type: 'testKey',
      provider: settings!.provider,
      apiKey,
      model: settings!.model,
    })) as { ok: boolean; model?: string; error?: string };
    setTest(
      res.ok
        ? { status: 'ok', message: `Connected — answered by ${res.model}` }
        : { status: 'error', message: res.error ?? 'Failed' },
    );
  }

  return (
    <main>
      <header>
        <h1>Clean Twitter</h1>
        <p>Filters low-quality posts out of your timeline using TypeSafe's Jev decision model.</p>
      </header>

      <section className="card">
        <h2>Model provider</h2>
        <div className="field">
          <div className="seg">
            {PROVIDER_IDS.map((id) => (
              <button
                key={id}
                type="button"
                aria-pressed={settings.provider === id}
                onClick={() => {
                  setTest({ status: 'idle' });
                  update({ provider: id });
                }}
              >
                {PROVIDERS[id].label}
              </button>
            ))}
          </div>
          <div className="sub">
            Both routes run the same Jev model and take the same request. TypeSafe bills you
            directly; OpenRouter bills through your OpenRouter credits.
          </div>
        </div>

        <div className="field">
          <label htmlFor="key">API key</label>
          <div className="key-row">
            <input
              id="key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={`${provider.keyPrefix}…`}
              value={apiKey}
              onChange={(e) => {
                setTest({ status: 'idle' });
                update({ [keyField]: e.target.value.trim() } as Partial<Settings>);
              }}
            />
            <button type="button" onClick={runTest} disabled={!apiKey || test.status === 'testing'}>
              {test.status === 'testing' ? 'Testing…' : 'Test'}
            </button>
          </div>
          <div className="sub">
            {test.status === 'ok' && <span className="status-ok">{test.message}</span>}
            {test.status === 'error' && <span className="status-err">{test.message}</span>}
            {test.status !== 'ok' && test.status !== 'error' && (
              <>
                Stored locally in this browser and sent only to {provider.name}.{' '}
                <a href={provider.keysUrl} target="_blank" rel="noreferrer">
                  Get a key
                </a>
                .
              </>
            )}
          </div>
        </div>

        <div className="field">
          <label htmlFor="model">Model</label>
          <input
            id="model"
            type="text"
            spellCheck={false}
            placeholder={provider.defaultModel}
            value={settings.model}
            onChange={(e) => update({ model: e.target.value })}
          />
          <div className="sub">Leave blank to use the default.</div>
        </div>
      </section>

      <CustomFilters
        filters={settings.customFilters}
        onChange={(customFilters) => update({ customFilters })}
      />

      <section className="card">
        <h2>Appearance</h2>
        <div className="field">
          <label>When a post is filtered</label>
          <div className="seg">
            {HIDE_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                title={mode.hint}
                aria-pressed={settings.hideMode === mode.id}
                onClick={() => update({ hideMode: mode.id })}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div className="sub">{HIDE_MODES.find((m) => m.id === settings.hideMode)?.hint}</div>
        </div>

        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.hideUntilChecked}
              onChange={(e) => update({ hideUntilChecked: e.target.checked })}
            />
            <span>Hide posts until they have been checked</span>
          </label>
          <div className="sub">
            Stops filtered posts flashing into view while the model is deciding. Posts reappear
            automatically if a check takes more than six seconds.
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Never filter</h2>
        <div className="field">
          <textarea
            spellCheck={false}
            placeholder="@friend&#10;@favouriteaccount"
            value={allowlistText}
            onChange={(e) => setAllowlistText(e.target.value)}
            onBlur={() =>
              update({
                allowlist: allowlistText
                  .split(/[\s,]+/)
                  .map((h) => h.trim())
                  .filter(Boolean),
              })
            }
          />
          <div className="sub">One handle per line. These accounts skip every filter.</div>
        </div>
      </section>

      {stats && (
        <section className="card">
          <h2>Usage</h2>
          <div className="stats-grid">
            <div className="stat">
              <b>{stats.checked.toLocaleString()}</b>
              <span>posts checked</span>
            </div>
            <div className="stat">
              <b>{stats.filtered.toLocaleString()}</b>
              <span>filtered out</span>
            </div>
            <div className="stat">
              <b>${stats.cost.toFixed(4)}</b>
              <span>{stats.inputTokens.toLocaleString()} tokens</span>
            </div>
          </div>
          {Object.keys(stats.bySignal).length > 0 && (
            <div className="sub" style={{ marginTop: 10 }}>
              {Object.entries(stats.bySignal)
                .sort((a, b) => b[1] - a[1])
                .map(([label, n]) => `${label}: ${n}`)
                .join(' · ')}
            </div>
          )}
          <div className="row wrap" style={{ marginTop: 14 }}>
            <button
              type="button"
              onClick={async () => {
                await browser.runtime.sendMessage({ type: 'resetStats' });
                refreshStats();
              }}
            >
              Reset counters
            </button>
            <button
              type="button"
              title="Forget every cached verdict and re-check posts from scratch"
              onClick={() => browser.runtime.sendMessage({ type: 'clearCache' })}
            >
              Clear cached verdicts
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
