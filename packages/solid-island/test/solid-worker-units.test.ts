// @vitest-environment happy-dom
/**
 * Doc-resolution edge cases for the Solid worker renderer's doc-less
 * factories — no instance is ever mounted in this module graph, so
 * `currentDoc()`'s fallback chain is exercised directly:
 * - nothing active/touched → the "no mounted instance" throw;
 * - an op pushed for an instance key → the `getLastTouchedInstance`
 *   rung mints (and lazily adopts) that instance's proxy document.
 */
import { describe, expect, it } from 'vitest';
import { pushOp, takeOps } from '@atolljs/islands/worker';
import { createElement, createTextNode, h } from '../src/worker';

describe('currentDoc with no mounted instance', () => {
  it('doc-less factories throw the no-instance error', () => {
    expect(() => createElement('div')).toThrow(/no mounted instance/);
    expect(() => createTextNode('x')).toThrow(/no mounted instance/);
    expect(() => h('div')).toThrow(/no mounted instance/);
  });

  it('a pushed op stamps the touched instance — the next factory resolves its doc', () => {
    // pushOp records `touchedInstance` — the last rung of the ambient
    // chain (active → lastActive → lastTouched).
    pushOp('ghost@9', { t: 'clear' });
    const el = createElement('section');
    el.setAttribute('class', 'ghosted');
    const ops = takeOps('ghost@9');
    // The element's ops landed on the stamped instance's queue — proof the
    // proxy document that got adopted was 'ghost@9''s.
    expect(ops.some((o) => o.t === 'clear')).toBe(true);
    expect(ops.some((o) => o.t === 'create')).toBe(true);
    expect(ops.some((o) => o.t === 'attr')).toBe(true);
  });
});
