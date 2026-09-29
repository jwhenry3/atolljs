/**
 * Cross-framework bench worker — the SAME logical tree mounted through every
 * framework island adapter, so islandBench.test.ts can compare the
 * worker-vs-main JS split per renderer:
 *
 *   'imp'    — imperative proxy-DOM baseline (updateProps = clear+rebuild)
 *   'react'  — reactIslandApp (reconciler-diffed patches)
 *   'vue'    — vueIslandApp (VDOM h() render, reactive refs)
 *   'svelte' — svelteIslandApp (compiled BenchTree.svelte, runes)
 *   'solid'  — solidIslandApp (h()/insert() — the universal-compile shape)
 *   'ng'     — angularIslandApp (decorator component, JIT-compiled @for)
 *
 * The tree: `rows` rows of .row[data-index] > .cell(`${label} ${i}`) +
 * .bump, plus one `.inc` button wired to local state — so `updateProps`
 * exercises each framework's prop-diff path and a `.inc` click exercises
 * dispatch → state → commit.
 */
import '@angular/compiler';
import { Component, computed, input, signal } from '@angular/core';
import { createElement, useState } from 'react';
import { defineComponent, h as vh, ref } from 'vue';
import { createSignal } from 'solid-js';
import {
  definePolyWorker,
  emit,
  islandApp,
  type ProxyDocument,
} from '@atolljs/islands/worker';
import { reactIslandApp } from '@atolljs/react-island/worker';
import { vueIsland } from '@atolljs/vue-island/worker';
import { svelteIsland } from '@atolljs/svelte-island/worker';
import { h as sh, insert, solidIsland } from '@atolljs/solid-island/worker';
import { angularIsland } from '@atolljs/angular-island/worker';
import BenchTree from './BenchTree.svelte';

/* ── imperative baseline ──────────────────────────────────────────────── */

function buildTree(doc: ProxyDocument, rows: number, label: string): void {
  const root = doc.createElement('div');
  root.className = 'tree';
  for (let i = 0; i < rows; i++) {
    const row = doc.createElement('div');
    row.className = 'row';
    row.dataset.index = String(i);
    const cell = doc.createElement('span');
    cell.className = 'cell';
    cell.textContent = `${label} ${i}`;
    const bump = doc.createElement('button');
    bump.className = 'bump';
    bump.textContent = 'x';
    bump.addEventListener('click', () => {
      cell.textContent = `${label} ${i}!`;
      emit('bumped', { i });
    });
    row.append(cell, bump);
    root.append(row);
  }
  const inc = doc.createElement('button');
  inc.className = 'inc';
  inc.textContent = 'inc 0';
  inc.addEventListener('click', () => {
    inc.textContent = `inc ${Number(inc.textContent!.slice(4)) + 1}`;
  });
  root.append(inc);
  doc.body.append(root);
}

const impApp = islandApp('imp', {
  imperative: (doc: ProxyDocument, props: Record<string, unknown>): void => {
    buildTree(doc, Number(props.rows ?? 200), String(props.label ?? 'row'));
  },
});

/* ── react ─────────────────────────────────────────────────────────────── */

function BenchReact(props: Record<string, unknown>) {
  const [n, setN] = useState(0);
  const rows = Number(props.rows ?? 200);
  const label = String(props.label ?? 'row');
  return createElement(
    'div',
    { className: 'tree' },
    Array.from({ length: rows }, (_, i) =>
      createElement(
        'div',
        { className: 'row', 'data-index': i, key: i },
        createElement('span', { className: 'cell' }, `${label} ${i}`),
        createElement('button', { className: 'bump' }, 'x'),
      ),
    ),
    createElement(
      'button',
      { className: 'inc', onClick: () => setN((c) => c + 1) },
      `inc ${n}`,
    ),
  );
}

/* ── vue ───────────────────────────────────────────────────────────────── */

const BenchVue = defineComponent({
  name: 'BenchVue',
  props: {
    rows: { type: Number, default: 200 },
    label: { type: String, default: 'row' },
  },
  setup(props) {
    const n = ref(0);
    return () =>
      vh('div', { class: 'tree' }, [
        ...Array.from({ length: props.rows }, (_, i) =>
          vh('div', { class: 'row', 'data-index': i }, [
            vh('span', { class: 'cell' }, `${props.label} ${i}`),
            vh('button', { class: 'bump' }, 'x'),
          ]),
        ),
        vh(
          'button',
          { class: 'inc', onClick: () => void (n.value += 1) },
          `inc ${n.value}`,
        ),
      ]);
  },
});

/* ── solid ─────────────────────────────────────────────────────────────── */

function BenchSolid(props: Record<string, unknown>): ReturnType<typeof sh> {
  const [n, setN] = createSignal(0);
  const tree = sh('div', { class: 'tree' });
  const rows = Number(props.rows ?? 200);
  for (let i = 0; i < rows; i++) {
    const row = sh('div', { class: 'row', 'data-index': i });
    const cell = sh('span', { class: 'cell' });
    // Tracked accessor — the label prop diff rides updateProps; i is static.
    insert(cell, () => `${String(props.label ?? 'row')} ${i}`);
    row.append(cell, sh('button', { class: 'bump' }, 'x'));
    tree.append(row);
  }
  const inc = sh('button', {
    class: 'inc',
    onClick: () => setN((c) => c + 1),
  });
  insert(inc, () => `inc ${n()}`);
  tree.append(inc);
  return tree;
}

/* ── angular ───────────────────────────────────────────────────────────── */

@Component({
  standalone: true,
  selector: 'atoll-bench-ng',
  template: `
    <div class="tree">
      @for (i of indices(); track i) {
        <div class="row" [attr.data-index]="i">
          <span class="cell">{{ label() }} {{ i }}</span>
          <button class="bump">x</button>
        </div>
      }
      <button class="inc" (click)="bump()">inc {{ n() }}</button>
    </div>
  `,
})
class BenchNg {
  label = input('row');
  rows = input(200);
  n = signal(0);
  indices = computed(() => Array.from({ length: this.rows() }, (_, i) => i));
  bump(): void {
    this.n.set(this.n() + 1);
  }
}

export const benchWorker = definePolyWorker({
  apps: {
    imp: impApp,
    react: islandApp('react', reactIslandApp(BenchReact)),
    vue: vueIsland('vue', BenchVue),
    svelte: svelteIsland('svelte', BenchTree),
    solid: solidIsland('solid', BenchSolid),
    ng: angularIsland('ng', BenchNg),
  },
});
