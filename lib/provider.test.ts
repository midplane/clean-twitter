import { describe, expect, test } from 'bun:test';
import { CUSTOM_PREFIX, buildQuestions, customKey, toQuestion } from './provider';
import { DEFAULT_SETTINGS, isUsable, newCustomFilter } from './defaults';
import type { CustomFilter, Settings } from './types';

function filter(fields: Partial<CustomFilter> = {}): CustomFilter {
  return {
    ...newCustomFilter(),
    label: 'Crypto talk',
    instructions: 'The post is about cryptocurrency.',
    ...fields,
  };
}

function settingsWith(customFilters: CustomFilter[]): Settings {
  return { ...DEFAULT_SETTINGS, customFilters };
}

describe('isUsable', () => {
  test('requires both a label and a question', () => {
    expect(isUsable(filter())).toBe(true);
    expect(isUsable(filter({ label: '   ' }))).toBe(false);
    expect(isUsable(filter({ instructions: '' }))).toBe(false);
  });
});

describe('buildQuestions', () => {
  test('adds enabled custom filters under a namespaced key', () => {
    const f = filter();
    const questions = buildQuestions(settingsWith([f]));
    expect(questions[customKey(f)]).toBeDefined();
    expect(customKey(f).startsWith(CUSTOM_PREFIX)).toBe(true);
  });

  test('keeps the built-in signals alongside', () => {
    const questions = buildQuestions(settingsWith([filter()]));
    expect(Object.keys(questions)).toContain('slop');
    expect(Object.keys(questions)).toContain('ragebait');
    expect(Object.keys(questions)).toContain('ads');
  });

  test('skips disabled and half-written filters', () => {
    const off = filter({ enabled: false });
    const draft = filter({ label: '' });
    const questions = buildQuestions(settingsWith([off, draft]));
    expect(questions[customKey(off)]).toBeUndefined();
    expect(questions[customKey(draft)]).toBeUndefined();
  });

  test('a custom filter cannot collide with a built-in signal', () => {
    // Even a filter whose id spells a built-in name lands in its own namespace.
    const evil = filter({ id: 'slop' });
    const questions = buildQuestions(settingsWith([evil]));
    expect(questions.slop).toEqual(buildQuestions(DEFAULT_SETTINGS).slop);
    expect(questions[customKey(evil)]).toBeDefined();
  });

  test('omits the quality question unless a floor is set', () => {
    expect(buildQuestions(DEFAULT_SETTINGS).quality).toBeUndefined();
    expect(buildQuestions({ ...DEFAULT_SETTINGS, minQuality: 1 }).quality).toBeDefined();
  });
});

describe('toQuestion', () => {
  test('sends no criteria when the user gave none', () => {
    expect(toQuestion(filter())).toEqual({
      type: 'noul',
      instructions: 'The post is about cryptocurrency.',
    });
  });

  test('fills the opposite end when only one side is given', () => {
    const q = toQuestion(filter({ whenTrue: 'Mentions tokens' })) as {
      criteria: { true: string; false: string };
    };
    expect(q.criteria.true).toBe('Mentions tokens');
    expect(q.criteria.false).toBeTruthy();
  });

  test('trims whitespace out of the instructions', () => {
    expect(toQuestion(filter({ instructions: '  padded  ' })).instructions).toBe('padded');
  });
});
