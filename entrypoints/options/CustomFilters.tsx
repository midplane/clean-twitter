import { useState } from 'react';
import { browser } from '#imports';
import { MAX_CUSTOM_FILTERS, THRESHOLD_MAX, THRESHOLD_MIN, isUsable, newCustomFilter } from '@/lib/defaults';
import type { CustomFilter } from '@/lib/types';

/** Shown as placeholders so the shape of a good question is obvious. */
const EXAMPLE = {
  label: 'Crypto talk',
  instructions: 'The post is about cryptocurrency, tokens, or NFTs.',
  whenTrue: 'Discusses crypto prices, tokens, trading or NFTs',
  whenFalse: 'Any other subject, including ordinary finance',
};

type TestState = { status: 'idle' | 'running' | 'done' | 'error'; score?: number; error?: string };

export default function CustomFilters({
  filters,
  onChange,
}: {
  filters: CustomFilter[];
  onChange: (next: CustomFilter[]) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  function patch(id: string, fields: Partial<CustomFilter>) {
    onChange(filters.map((f) => (f.id === id ? { ...f, ...fields } : f)));
  }

  function add() {
    const filter = newCustomFilter();
    onChange([...filters, filter]);
    setOpenId(filter.id);
  }

  return (
    <section className="card">
      <h2>Your filters</h2>
      <p className="caption">
        Ask anything you can put as a yes/no question. Each one is answered in the same request,
        so it adds roughly $0.004 per 1,000 posts.
      </p>

      {filters.length === 0 && (
        <p className="empty">No filters of your own yet.</p>
      )}

      {filters.map((filter) => (
        <FilterRow
          key={filter.id}
          filter={filter}
          open={openId === filter.id}
          onToggleOpen={() => setOpenId(openId === filter.id ? null : filter.id)}
          onPatch={(fields) => patch(filter.id, fields)}
          onDelete={() => {
            onChange(filters.filter((f) => f.id !== filter.id));
            if (openId === filter.id) setOpenId(null);
          }}
        />
      ))}

      <div className="row wrap" style={{ marginTop: 14 }}>
        <button type="button" onClick={add} disabled={filters.length >= MAX_CUSTOM_FILTERS}>
          Add a filter
        </button>
        {filters.length >= MAX_CUSTOM_FILTERS && (
          <span className="sub">Limit of {MAX_CUSTOM_FILTERS} reached.</span>
        )}
      </div>
    </section>
  );
}

function FilterRow({
  filter,
  open,
  onToggleOpen,
  onPatch,
  onDelete,
}: {
  filter: CustomFilter;
  open: boolean;
  onToggleOpen: () => void;
  onPatch: (fields: Partial<CustomFilter>) => void;
  onDelete: () => void;
}) {
  const [sample, setSample] = useState('');
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const usable = isUsable(filter);

  async function runTest() {
    setTest({ status: 'running' });
    const res = (await browser.runtime.sendMessage({
      type: 'testFilter',
      filter,
      text: sample,
    })) as { ok: boolean; score?: number; error?: string };
    setTest(
      res.ok
        ? { status: 'done', score: res.score }
        : { status: 'error', error: res.error ?? 'Failed' },
    );
  }

  const wouldHide = test.score !== undefined && test.score >= filter.threshold;

  return (
    <div className={`filter ${open ? 'open' : ''}`}>
      <div className="row">
        <label className="check" title={filter.enabled ? 'Enabled' : 'Disabled'}>
          <input
            type="checkbox"
            checked={filter.enabled}
            disabled={!usable}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
          />
        </label>
        <input
          className="grow"
          type="text"
          value={filter.label}
          placeholder={EXAMPLE.label}
          aria-label="Filter name"
          onChange={(e) => onPatch({ label: e.target.value })}
        />
        <button type="button" onClick={onToggleOpen} aria-expanded={open}>
          {open ? 'Done' : 'Edit'}
        </button>
        <button type="button" className="danger" onClick={onDelete} title="Delete this filter">
          Delete
        </button>
      </div>

      {!usable && !open && <p className="sub warn">Needs a name and a question before it runs.</p>}

      {open && (
        <div className="filter-body">
          <div className="field">
            <label htmlFor={`q-${filter.id}`}>Hide a post when this is true of it</label>
            <textarea
              id={`q-${filter.id}`}
              value={filter.instructions}
              placeholder={EXAMPLE.instructions}
              onChange={(e) => onPatch({ instructions: e.target.value })}
            />
            <div className="sub">
              Write it as a statement, not a command — “The post is …”, not “Hide posts that …”.
            </div>
          </div>

          <div className="field two-up">
            <div>
              <label htmlFor={`t-${filter.id}`}>Looks like this</label>
              <input
                id={`t-${filter.id}`}
                type="text"
                value={filter.whenTrue}
                placeholder={EXAMPLE.whenTrue}
                onChange={(e) => onPatch({ whenTrue: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor={`f-${filter.id}`}>But not this</label>
              <input
                id={`f-${filter.id}`}
                type="text"
                value={filter.whenFalse}
                placeholder={EXAMPLE.whenFalse}
                onChange={(e) => onPatch({ whenFalse: e.target.value })}
              />
            </div>
          </div>
          <div className="sub">
            Optional, but pinning down both ends makes the score markedly more reliable.
          </div>

          <div className="field">
            <label htmlFor={`th-${filter.id}`}>Confidence needed to hide</label>
            <div className="row">
              <input
                id={`th-${filter.id}`}
                type="range"
                min={THRESHOLD_MIN}
                max={THRESHOLD_MAX}
                step={0.05}
                value={filter.threshold}
                onChange={(e) => onPatch({ threshold: Number(e.target.value) })}
              />
              <span className="thresh sub">{Math.round(filter.threshold * 100)}%</span>
            </div>
          </div>

          <div className="field">
            <label htmlFor={`s-${filter.id}`}>Try it on a post</label>
            <div className="key-row">
              <input
                id={`s-${filter.id}`}
                type="text"
                value={sample}
                placeholder="Paste the text of a post…"
                onChange={(e) => {
                  setSample(e.target.value);
                  setTest({ status: 'idle' });
                }}
              />
              <button
                type="button"
                onClick={runTest}
                disabled={!usable || !sample.trim() || test.status === 'running'}
              >
                {test.status === 'running' ? 'Scoring…' : 'Try it'}
              </button>
            </div>
            <div className="sub">
              {test.status === 'done' && (
                <span className={wouldHide ? 'status-err' : 'status-ok'}>
                  Scored {Math.round((test.score ?? 0) * 100)}% —{' '}
                  {wouldHide ? 'this post would be hidden' : 'this post would stay'}.
                </span>
              )}
              {test.status === 'error' && <span className="status-err">{test.error}</span>}
              {(test.status === 'idle' || test.status === 'running') &&
                'Checks this one filter without saving anything.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
