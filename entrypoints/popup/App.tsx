import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { loadSettings, saveSettings } from '@/lib/settings';
import { activeKey, isUsable, THRESHOLD_MAX, THRESHOLD_MIN } from '@/lib/defaults';
import { PROVIDERS, QUALITY_LEVELS } from '@/lib/provider';
import type { MediaFilterId, Settings, SignalId, Stats } from '@/lib/types';

const SIGNALS: Array<{ id: SignalId; label: string; hint: string }> = [
  { id: 'slop', label: 'AI slop', hint: 'Thread-bait, platitudes, machine-written filler' },
  { id: 'ragebait', label: 'Rage bait', hint: 'Engineered outrage and dunks' },
  { id: 'ads', label: 'Ads & shilling', hint: 'Sales pitches, affiliate and crypto spam' },
];

const MEDIA: Array<{ id: MediaFilterId; label: string }> = [
  { id: 'images', label: 'Images' },
  { id: 'videos', label: 'Videos' },
  { id: 'gifs', label: 'GIFs' },
];

/** The lowest quality level the slider offers; 0 is the off position. */
const QUALITY_STEP = 0.5;

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [apiError, setApiError] = useState<{ message: string } | null>(null);

  useEffect(() => {
    loadSettings().then(setSettings);
    browser.runtime
      .sendMessage({ type: 'getStats' })
      .then((r: { stats?: Stats }) => setStats(r?.stats ?? null))
      .catch(() => {});
    browser.runtime
      .sendMessage({ type: 'getError' })
      .then((r: { lastError?: { message: string } | null }) => setApiError(r?.lastError ?? null))
      .catch(() => {});
  }, []);

  async function update(patch: Partial<Settings>) {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setSettings(await saveSettings(patch));
  }

  if (!settings) return <div className="card">Loading…</div>;

  const hasKey = !!activeKey(settings);
  const customFilters = (settings.customFilters ?? []).filter(isUsable);

  function patchFilter(id: string, fields: Partial<(typeof customFilters)[number]>) {
    update({
      customFilters: (settings!.customFilters ?? []).map((f) =>
        f.id === id ? { ...f, ...fields } : f,
      ),
    });
  }

  return (
    <>
      <div className="card head">
        <h1 className="grow">Clean Twitter</h1>
        <label className="switch" title={settings.enabled ? 'Turn off' : 'Turn on'}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => update({ enabled: e.target.checked })}
          />
          <span />
        </label>
      </div>

      <div className={settings.enabled ? '' : 'muted-panel'}>
        {apiError && (
          <div className="card notice error">
            <div className="row">
              <span className="grow">{apiError.message}</span>
              <button
                type="button"
                className="dismiss"
                aria-label="Dismiss"
                onClick={() => {
                  setApiError(null);
                  browser.runtime.sendMessage({ type: 'dismissError' }).catch(() => {});
                }}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {!hasKey && (
          <div className="card notice">
            No API key yet, so the model filters below are off.{' '}
            <a href="#" onClick={openOptions}>
              Add a {PROVIDERS[settings.provider].name} key
            </a>
            .
          </div>
        )}

        {/* Dimming both the wrapper and this card would compound to near-invisible. */}
        <div className={`card ${!hasKey && settings.enabled ? 'muted-panel' : ''}`}>
          <h2>Filter out</h2>
          <p className="caption">
            Hide a post when the model is at least this sure. Lower catches more, and gets
            more wrong.
          </p>

          {SIGNALS.map((signal) => {
            const cfg = settings.signals[signal.id];
            return (
              <div className="row" key={signal.id}>
                <label className="check grow" title={signal.hint}>
                  <input
                    type="checkbox"
                    checked={cfg.enabled}
                    onChange={(e) =>
                      update({
                        signals: {
                          ...settings.signals,
                          [signal.id]: { ...cfg, enabled: e.target.checked },
                        },
                      })
                    }
                  />
                  <span>{signal.label}</span>
                </label>
                <input
                  type="range"
                  min={THRESHOLD_MIN}
                  max={THRESHOLD_MAX}
                  step={0.05}
                  value={cfg.threshold}
                  disabled={!cfg.enabled}
                  aria-label={`${signal.label} confidence threshold`}
                  onChange={(e) =>
                    update({
                      signals: {
                        ...settings.signals,
                        [signal.id]: { ...cfg, threshold: Number(e.target.value) },
                      },
                    })
                  }
                />
                <span className="thresh sub">{Math.round(cfg.threshold * 100)}%</span>
              </div>
            );
          })}

          {customFilters.map((filter) => (
            <div className="row" key={filter.id}>
              <label className="check grow" title={filter.instructions}>
                <input
                  type="checkbox"
                  checked={filter.enabled}
                  onChange={(e) => patchFilter(filter.id, { enabled: e.target.checked })}
                />
                <span className="ellipsis">{filter.label}</span>
              </label>
              <input
                type="range"
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                step={0.05}
                value={filter.threshold}
                disabled={!filter.enabled}
                aria-label={`${filter.label} confidence threshold`}
                onChange={(e) => patchFilter(filter.id, { threshold: Number(e.target.value) })}
              />
              <span className="thresh sub">{Math.round(filter.threshold * 100)}%</span>
            </div>
          ))}

          <div className="row quality">
            <label className="check grow" title="Rates every post 0–3 on informational value">
              <input
                type="checkbox"
                checked={settings.minQuality > 0}
                onChange={(e) => update({ minQuality: e.target.checked ? 1 : 0 })}
              />
              <span>Low value</span>
            </label>
            <input
              type="range"
              min={QUALITY_STEP}
              max={2.5}
              step={QUALITY_STEP}
              value={settings.minQuality || 1}
              disabled={settings.minQuality === 0}
              aria-label="Quality floor"
              onChange={(e) => update({ minQuality: Number(e.target.value) })}
            />
            <span className="thresh sub">
              {settings.minQuality > 0 ? settings.minQuality.toFixed(1) : '—'}
            </span>
          </div>
          {settings.minQuality > 0 && (
            <p className="caption below">
              Hides anything under “{QUALITY_LEVELS[Math.ceil(settings.minQuality)]}”. Adds one
              question per post.
            </p>
          )}

          <p className="caption below">
            <a href="#" onClick={openOptions}>
              {customFilters.length ? 'Edit your filters' : 'Write your own filter'}
            </a>
          </p>
        </div>

        <div className="card">
          <h2>
            Always hide <span className="pill">free</span>
          </h2>
          <p className="caption">Read straight from the page, so these cost nothing.</p>

          <div className="row">
            <label className="check grow">
              <input
                type="checkbox"
                checked={settings.hidePromoted}
                onChange={(e) => update({ hidePromoted: e.target.checked })}
              />
              <span>Promoted posts</span>
            </label>
          </div>

          <div className="row media">
            {MEDIA.map((m) => (
              <label className="check" key={m.id}>
                <input
                  type="checkbox"
                  checked={settings.mediaFilters[m.id]}
                  onChange={(e) =>
                    update({
                      mediaFilters: { ...settings.mediaFilters, [m.id]: e.target.checked },
                    })
                  }
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>
        </div>

        {stats && stats.checked > 0 && (
          <div className="card">
            <h2>Usage</h2>
            <div className="row">
              <span className="grow sub">
                {stats.filtered.toLocaleString()} filtered of {stats.checked.toLocaleString()}{' '}
                checked
              </span>
              <span className="sub cost">${stats.cost.toFixed(4)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="card foot">
        <a className="grow" href="#" onClick={openOptions}>
          Settings
        </a>
        <span className="sub">{PROVIDERS[settings.provider].name}</span>
      </div>
    </>
  );
}

function openOptions(event: React.MouseEvent) {
  event.preventDefault();
  browser.runtime.openOptionsPage();
}
