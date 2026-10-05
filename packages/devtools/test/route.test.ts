/**
 * Pure shell helpers (app/panels/route.js): hash routes, palette fuzzy
 * matching, `g <letter>` resolution, nav overflow layout.
 */
import { describe, expect, it } from 'vitest';
import {
  formatRoute,
  fuzzyMatch,
  groupResults,
  isTypingTarget,
  keyTail,
  layoutNav,
  letterForView,
  parseRoute,
  rankItems,
  resolveKey,
  viewForLetter,
} from '../app/panels/route.js';

describe('routes', () => {
  it('parses view, sub and params', () => {
    expect(parseRoute('#/tasks')).toEqual({ view: 'tasks', sub: null, params: {} });
    expect(parseRoute('#/dashboard/tv-island?island=s1|nested@1')).toEqual({
      view: 'dashboard',
      sub: 'tv-island',
      params: { island: 's1|nested@1' },
    });
    expect(parseRoute('#/memory/mv-heap?session=a%20b&x')).toEqual({
      view: 'memory',
      sub: 'mv-heap',
      params: { session: 'a b', x: '' },
    });
  });

  it('rejects non-route hashes', () => {
    expect(parseRoute('')).toBeNull();
    expect(parseRoute('#')).toBeNull();
    expect(parseRoute('#/')).toBeNull();
    expect(parseRoute('#section-2')).toBeNull();
  });

  it('formats in a stable param order and drops empties', () => {
    expect(formatRoute({ view: 'tasks' })).toBe('#/tasks');
    expect(
      formatRoute({
        view: 'dashboard',
        sub: 'tv-worker',
        params: { worker: 's1|outer#0~pool-1|2', session: 's1', island: undefined },
      }),
    ).toBe('#/dashboard/tv-worker?session=s1&worker=s1|outer%230~pool-1|2');
  });

  it('round-trips nested keys', () => {
    const r = {
      view: 'dashboard',
      sub: 'tv-island',
      params: { session: 'sess 1', island: 'sess 1|nestedhost@1~nested@1' },
    };
    expect(parseRoute(formatRoute(r))).toEqual(r);
  });

  it('resolves entity keys exactly, then by tail preferring live sessions', () => {
    const keys = ['old|app@1', 'new|app@1', 'new|other@2'];
    expect(keyTail('s|pool-1|0')).toBe('pool-1|0');
    expect(resolveKey(keys, 'new|other@2')).toBe('new|other@2');
    expect(resolveKey(keys, 'gone|app@1', (k) => k.startsWith('new'))).toBe('new|app@1');
    expect(resolveKey(keys, 'gone|app@1', () => false)).toBe('old|app@1');
    expect(resolveKey(keys, 'gone|missing@1')).toBeNull();
    expect(resolveKey(keys, null)).toBeNull();
  });
});

describe('fuzzy matching', () => {
  it('matches substrings and subsequences, case-insensitively', () => {
    expect(fuzzyMatch('heap', 'JS heap')!.idx).toEqual([3, 4, 5, 6]);
    expect(fuzzyMatch('mvw', 'Memory › Values › Watch')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Network')).toBeNull();
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, idx: [] });
  });

  it('ranks prefix > boundary > scattered', () => {
    const prefix = fuzzyMatch('net', 'Network')!.score;
    const boundary = fuzzyMatch('net', 'Open network')!.score;
    const scattered = fuzzyMatch('net', 'nodes everywhere today')!.score;
    expect(prefix).toBeGreaterThan(boundary);
    expect(boundary).toBeGreaterThan(scattered);
  });

  it('ranks palette items, requiring every token to match', () => {
    const items = [
      { title: 'Memory › JS heap', group: 'Subviews' },
      { title: 'Network', group: 'Views' },
      { title: 'nested@1', group: 'Islands', hint: 'react' },
      { title: 'Tasks', group: 'Views' },
    ];
    expect(rankItems('net', items)[0].item.title).toBe('Network');
    expect(rankItems('js heap', items).map((r) => r.item.title)).toEqual(['Memory › JS heap']);
    // hint-only match still counts, at a discount
    expect(rankItems('react', items).map((r) => r.item.title)).toEqual(['nested@1']);
    expect(rankItems('net zzz', items)).toEqual([]);
    expect(rankItems('', items)).toHaveLength(4);
  });

  it('groups results in the given order, capped per group', () => {
    const ranked = rankItems('', [
      { title: 'a', group: 'Islands' },
      { title: 'b', group: 'Views' },
      { title: 'c', group: 'Views' },
      { title: 'd', group: 'Views' },
    ]);
    const g = groupResults(ranked, { order: ['Views', 'Islands'], perGroup: 2 });
    expect(g.map((x) => x.group)).toEqual(['Views', 'Islands']);
    expect(g[0].items.map((r) => r.item.title)).toEqual(['b', 'c']);
  });
});

describe('keyboard', () => {
  const views = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'perf', label: 'Performance' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'log', label: 'Log' },
    { id: 'xray', label: 'X-ray' },
  ];

  it('maps g letters to existing views only', () => {
    expect(viewForLetter('d', views)).toBe('dashboard');
    expect(viewForLetter('p', views)).toBe('perf');
    expect(viewForLetter('T', views)).toBe('tasks');
    expect(viewForLetter('r', views)).toBeNull(); // no reactivity view
    expect(viewForLetter('x', views)).toBe('xray'); // unmapped → label initial
    expect(viewForLetter('1', views)).toBeNull();
    expect(letterForView('perf', views)).toBe('p');
    expect(letterForView('xray', views)).toBe('x');
  });

  it('treats text fields as typing targets', () => {
    expect(isTypingTarget({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(isTypingTarget({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('nav overflow', () => {
  it('hides nothing when everything fits', () => {
    expect(layoutNav([100, 100], 200, 0, 60)).toEqual([]);
  });

  it('folds a suffix into More, keeping the active tab visible', () => {
    // 5 × 100 in 360: More (60) leaves 300 → three tabs
    expect(layoutNav([100, 100, 100, 100, 100], 360, 0, 60)).toEqual([3, 4]);
    // active is last: reserve it first, then fill the prefix
    expect(layoutNav([100, 100, 100, 100, 100], 360, 4, 60)).toEqual([2, 3]);
  });
});
