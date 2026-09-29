/**
 * Tests for the promoted generic DOM surface: comment nodes, comment-
 * preserving innerHTML, kind-aware cloneNode, ChildNode/ParentNode
 * conveniences, namespace-aware attributes, listener options (`once`), and
 * `<template>.content`. Same harness as proxyDom.test.ts — ops drain off
 * the realm queue, reads come from the shadow tree.
 */
import { describe, expect, it } from 'vitest';
import { runInRealm, takeOps, getHandler } from '../src/worker/realm';
import {
  createProxyDocument,
  ProxyComment,
  ProxyElement,
  ProxyFragment,
  ProxyNode,
  ProxyText,
  type InternalDocument,
} from '../src/worker/proxyDom';
import type { Op } from '../src/ops';

/** Run `fn` inside a realm and return the ops it emitted. */
const inRealm = (realm: string, fn: () => void): Op[] =>
  runInRealm(realm, () => {
    fn();
    return takeOps(realm);
  });

describe('ProxyComment', () => {
  it('createComment anchors insertBefore with a real text-node id, emits only a text op', () => {
    let commentId = -1;
    const ops = inRealm('comments', () => {
      const doc = createProxyDocument('comments');
      const host = doc.createElement('div');
      doc.body.appendChild(host);

      const anchor = doc.createComment('if-block');
      commentId = anchor.instance.id;
      expect(anchor).toBeInstanceOf(ProxyComment);
      expect(anchor.nodeType).toBe(8);
      expect(anchor.nodeName).toBe('#comment');
      expect(anchor.data).toBe('if-block');

      const el = doc.createElement('span');
      host.appendChild(anchor);
      host.insertBefore(el, anchor); // before: anchors on the comment's id
      expect(host.firstChild).toBe(el);
      expect(el.nextSibling).toBe(anchor);
      expect(anchor.previousSibling).toBe(el);

      // Shadow writes never reach the wire — emitting them would render
      // the comment's data as visible text driver-side.
      anchor.data = 'renamed';
      anchor.nodeValue = 'v2';
      anchor.textContent = 'v3';
      expect(anchor.data).toBe('v3');
      expect(anchor.textContent).toBe('v3');
    });

    // Exactly ONE text op for the comment — '' (the anchor backing). No
    // utext ever targets its id, and no other op mentions it as a payload.
    const textOps = ops.filter((o) => o.t === 'text');
    expect(textOps.length).toBe(1);
    expect((textOps[0] as { id: number }).id).toBe(commentId);
    expect((textOps[0] as { text: string }).text).toBe('');
    expect(ops.some((o) => o.t === 'utext')).toBe(false);
    expect(ops.some((o) => o.t === 'append' && o.before === commentId)).toBe(true);
  });

  it('adopt()/_wrap() returns the comment view, not a text view', () => {
    inRealm('comment-wrap', () => {
      const doc = createProxyDocument('comment-wrap') as InternalDocument;
      const c = doc.createComment('x');
      expect(doc.adopt(c.instance)).toBe(c);
      expect(doc.adopt(c.instance).nodeType).toBe(8);
    });
  });
});

describe('comment-preserving innerHTML', () => {
  it('parses <!> and <!--x--> anchors as comment children and serializes them back', () => {
    inRealm('comment-html', () => {
      const doc = createProxyDocument('comment-html');
      const host = doc.createElement('div');
      doc.body.appendChild(host);

      host.innerHTML = '<!><span>hi</span><!--tail-->';
      expect(host.childNodes.length).toBe(3);
      expect(host.childNodes[0].nodeType).toBe(8);
      expect(host.childNodes[1].nodeType).toBe(1);
      expect(host.childNodes[2].nodeType).toBe(8);
      expect((host.childNodes[2] as ProxyComment).data).toBe('tail');

      // Comments serialize back; element textContent excludes comment data.
      expect(host.innerHTML).toBe('<!----><span>hi</span><!--tail-->');
      expect(host.textContent).toBe('hi');
    });
  });
});

describe('kind-aware cloneNode', () => {
  it('deep clones keep comment children as comments and nested structures intact', () => {
    const ops = inRealm('clone-kinds', () => {
      const doc = createProxyDocument('clone-kinds');
      const host = doc.createElement('div');
      host.innerHTML = '<ul><li>a</li><!----><li>b</li></ul><!--end-->';
      doc.body.appendChild(host);

      const clone = host.cloneNode(true);
      expect(clone.childNodes.map((n) => n.nodeType)).toEqual([1, 8]);
      const ul = clone.childNodes[0];
      expect(ul.childNodes.map((n) => n.nodeType)).toEqual([1, 8, 1]);
      expect(ul.childNodes[1]).toBeInstanceOf(ProxyComment);
      expect((ul.childNodes[1] as ProxyComment).data).toBe('');
      // The clone is a fresh instance — same shape, different ids.
      expect(ul.childNodes[1].instance.id).not.toBe(
        host.childNodes[0].childNodes[1].instance.id,
      );

      // Text and fragment clones.
      const t = doc.createTextNode('hello');
      const tc = t.cloneNode();
      expect(tc).toBeInstanceOf(ProxyText);
      expect(tc.textContent).toBe('hello');
      expect(tc.instance.id).not.toBe(t.instance.id);

      const frag = doc.createDocumentFragment();
      frag.append(doc.createElement('i'), doc.createComment('c'));
      const fc = frag.cloneNode(true);
      expect(fc).toBeInstanceOf(ProxyFragment);
      expect(fc.childNodes.map((n) => n.nodeType)).toEqual([1, 8]);
    });
    // Cloned comments still ride text-'' ops on the wire.
    expect(ops.filter((o) => o.t === 'text' && o.text === '').length).toBeGreaterThan(0);
  });
});

describe('ChildNode/ParentNode conveniences', () => {
  it('before/after/replaceWith insert around the node and emit append+remove ops', () => {
    const ops = inRealm('childnode', () => {
      const doc = createProxyDocument('childnode');
      const root = doc.createElement('div');
      doc.body.appendChild(root);
      const mid = doc.createElement('b');
      mid.textContent = 'mid';
      root.appendChild(mid);

      mid.before('pre-text', doc.createComment('c'));
      mid.after(doc.createElement('i'), 'post-text');
      expect(root.innerHTML).toBe('pre-text<!--c--><b>mid</b><i></i>post-text');

      mid.replaceWith(doc.createElement('u'));
      expect(root.innerHTML).toBe('pre-text<!--c--><u></u><i></i>post-text');
      expect(mid.isConnected).toBe(false);

      // Parentless nodes are spec'd no-ops — no throw, no ops.
      const orphan = doc.createElement('s');
      orphan.before(doc.createElement('x'));
      orphan.after(doc.createElement('x'));
      orphan.replaceWith(doc.createElement('x'));
      expect(orphan.parentNode).toBeNull();
    });
    expect(ops.some((o) => o.t === 'remove')).toBe(true);
  });

  it('append/prepend/replaceChildren work on the base node (fragments included)', () => {
    inRealm('parentnode', () => {
      const doc = createProxyDocument('parentnode');
      const host = doc.createElement('div');
      doc.body.appendChild(host);

      host.append('a', doc.createElement('em'));
      host.prepend(doc.createComment('head'));
      expect(host.childNodes.map((n) => n.nodeType)).toEqual([8, 3, 1]);
      expect(host.innerHTML).toBe('<!--head-->a<em></em>');

      // Fragments get the same conveniences (real DOM exposes them too).
      const frag = doc.createDocumentFragment();
      frag.append('x', doc.createElement('i'));
      frag.prepend('y');
      expect(frag.childNodes.map((n) => n.nodeType)).toEqual([3, 3, 1]);
      frag.replaceChildren('z');
      expect(frag.childNodes.length).toBe(1);
      expect(frag.textContent).toBe('z');

      host.replaceChildren(frag);
      expect(host.textContent).toBe('z');
      expect(frag.childNodes.length).toBe(0);
    });
  });

  it('nodeName reports per kind', () => {
    inRealm('nodename', () => {
      const doc = createProxyDocument('nodename');
      expect(doc.createElement('div').nodeName).toBe('DIV');
      expect(doc.createElementNS('http://www.w3.org/2000/svg', 'foreignObject').nodeName).toBe(
        'foreignObject',
      );
      expect(doc.createTextNode('t').nodeName).toBe('#text');
      expect(doc.createComment('c').nodeName).toBe('#comment');
      expect(doc.createDocumentFragment().nodeName).toBe('#document-fragment');
      expect(doc.body.nodeName).toBe('#ROOT'); // the id-0 sentinel element
    });
  });
});

describe('namespaceURI + *AttributeNS', () => {
  it('namespaceURI reflects the create-time ns; NS attrs round-trip shadow state as qualified names', () => {
    const ops = inRealm('ns-attrs', () => {
      const doc = createProxyDocument('ns-attrs');
      const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const el = doc.createElement('div');
      doc.body.append(svg, el);

      expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
      expect(el.namespaceURI).toBe('http://www.w3.org/1999/xhtml');

      svg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#a');
      expect(svg.getAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href')).toBe('#a');
      // The wire has no ns field — the qualified name IS the shadow key.
      expect(svg.getAttribute('xlink:href')).toBe('#a');
      svg.removeAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href');
      expect(svg.getAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href')).toBeNull();
    });
    expect(
      ops.some((o) => o.t === 'attr' && o.name === 'xlink:href' && o.value === '#a'),
    ).toBe(true);
    expect(ops.some((o) => o.t === 'attr' && o.name === 'xlink:href' && o.value === null)).toBe(
      true,
    );
  });
});

describe('listener options on the wire', () => {
  it('addEventListener({once:true}) emits opts and auto-detaches after one dispatch', () => {
    let calls = 0;
    let btn!: ProxyElement;
    const doc = createProxyDocument('once-realm');
    const ops = runInRealm('once-realm', () => {
      btn = doc.createElement('button');
      doc.body.appendChild(btn);
      btn.addEventListener('click', () => {
        calls++;
      }, { once: true });
      return takeOps('once-realm');
    });

    const listenOp = ops.find((o) => o.t === 'listen' && o.type === 'click') as {
      handler: number;
      opts?: { once?: boolean };
    };
    expect(listenOp.opts?.once).toBe(true);

    // First dispatch invokes the handler; the wrapper self-detaches (real
    // DOM once semantics) so a stale second dispatch is a no-op.
    getHandler(listenOp.handler)!.fn({ type: 'click', targetId: btn.instance.id });
    expect(calls).toBe(1);
    getHandler(listenOp.handler)?.fn({ type: 'click', targetId: btn.instance.id });
    expect(calls).toBe(1);
    expect(getHandler(listenOp.handler)).toBeUndefined();

    // The auto-detach emitted unlisten so the driver drops its map entry.
    const post = takeOps('once-realm');
    expect(post.some((o) => o.t === 'unlisten' && o.handler === listenOp.handler)).toBe(true);
    doc.dispose();
  });

  it('capture participates in dedupe/removal and rides unlisten; passive crosses the wire', () => {
    const doc = createProxyDocument('capture-realm');
    const ops = runInRealm('capture-realm', () => {
      const el = doc.createElement('div');
      doc.body.appendChild(el);
      const fn = () => {};
      el.addEventListener('scroll', fn, { passive: true, capture: true });
      el.addEventListener('scroll', fn, { passive: true }); // different capture — NOT deduped
      el.addEventListener('scroll', fn, { passive: true, capture: true }); // deduped
      el.removeEventListener('scroll', fn, { capture: true });
      el.removeEventListener('scroll', fn); // removes the bubble listener
      return takeOps('capture-realm');
    });
    const listens = ops.filter((o) => o.t === 'listen');
    expect(listens.length).toBe(2);
    expect(
      listens.some(
        (o) => o.t === 'listen' && o.opts?.capture === true && o.opts?.passive === true,
      ),
    ).toBe(true);
    const unlistens = ops.filter((o) => o.t === 'unlisten');
    expect(unlistens.length).toBe(2);
    expect(unlistens.some((o) => o.t === 'unlisten' && o.opts?.capture === true)).toBe(true);
    doc.dispose();
  });
});

describe('listener call fidelity', () => {
  it('handlers run with this=element and a composedPath() rooted at the enriched target', () => {
    const doc = createProxyDocument('fidelity');
    let seenThis: unknown;
    let seenCurrent: unknown;
    let seenPath: unknown[] | undefined;
    let target: ProxyNode | null = null;
    const ops = runInRealm('fidelity', () => {
      const host = doc.createElement('div');
      const btn = doc.createElement('button');
      host.appendChild(btn);
      doc.body.appendChild(host);
      host.addEventListener('click', function (this: unknown, p) {
        seenThis = this;
        seenCurrent = (p as { currentTarget?: unknown }).currentTarget;
        seenPath = (p as { composedPath?: () => unknown[] }).composedPath?.();
      });
      target = btn;
      return takeOps('fidelity');
    });

    const listenOp = ops.find((o) => o.t === 'listen' && o.type === 'click') as
      | { handler: number }
      | undefined;
    expect(listenOp).toBeDefined();
    // Fire the registered handler the way dispatch() would.
    runInRealm('fidelity', () => {
      getHandler(listenOp!.handler)!.fn({ type: 'click', targetId: target!.instance.id });
      return takeOps('fidelity');
    });

    const host = target!.parentNode;
    expect(seenThis).toBe(host); // unbound invoke → bound to the element
    expect(seenCurrent).toBe(host);
    // composedPath is the full propagation path — target up to the root —
    // so the listener element sits mid-chain like the real DOM.
    expect(seenPath?.[0]).toBe(target);
    expect(seenPath).toContain(host);
    expect(seenPath?.[seenPath.length - 1]).toBe(doc.body);
    doc.dispose();
  });

  it('document listeners bind this=document and composedPath ends with the document', () => {
    const doc = createProxyDocument('doc-fidelity');
    let seenThis: unknown;
    let seenPath: unknown[] | undefined;
    let target: ProxyNode | null = null;
    const ops = runInRealm('doc-fidelity', () => {
      const btn = doc.createElement('button');
      doc.body.appendChild(btn);
      doc.addEventListener('click', function (this: unknown, p) {
        seenThis = this;
        seenPath = (p as { composedPath?: () => unknown[] }).composedPath?.();
      });
      target = btn;
      return takeOps('doc-fidelity');
    });
    const listenOp = ops.find((o) => o.t === 'listen') as { handler: number } | undefined;
    runInRealm('doc-fidelity', () => {
      getHandler(listenOp!.handler)!.fn({ type: 'click', targetId: target!.instance.id });
      return takeOps('doc-fidelity');
    });
    expect(seenThis).toBe(doc);
    expect(seenPath?.[0]).toBe(target);
    expect(seenPath?.[seenPath.length - 1]).toBe(doc);
    doc.dispose();
  });
});

describe('<template>.content', () => {
  it('innerHTML on a template fills a shared fragment view; its children splice into a host', () => {
    const ops = inRealm('template', () => {
      const doc = createProxyDocument('template');
      const tpl = doc.createElement('template');
      tpl.innerHTML = '<span>x</span><!----><b>y</b>';

      const content = tpl.content;
      expect(content).toBeInstanceOf(ProxyFragment);
      expect(tpl.content).toBe(content); // cached view
      expect(content!.childNodes.map((n) => n.nodeType)).toEqual([1, 8, 1]);

      // Svelte-style: clone the content for each fragment instance.
      const clone = tpl.cloneNode(true);
      const clonedContent = clone.content!;
      expect(clonedContent.childNodes.map((n) => n.nodeType)).toEqual([1, 8, 1]);

      // Inserting the content fragment splices its children into the host.
      const host = doc.createElement('div');
      doc.body.appendChild(host);
      host.appendChild(content!);
      expect(content!.childNodes.length).toBe(0);
      expect(host.childNodes.map((n) => n.nodeType)).toEqual([1, 8, 1]);
    });
    expect(ops.some((o) => o.t === 'create' && o.type === 'template')).toBe(true);
  });

  it('non-template elements read content as undefined', () => {
    inRealm('not-template', () => {
      const doc = createProxyDocument('not-template');
      expect(doc.createElement('div').content).toBeUndefined();
    });
  });
});

describe('document extras', () => {
  it('importNode clones through the document; baseURI is honest', () => {
    inRealm('doc-extras', () => {
      const doc = createProxyDocument('doc-extras');
      const el = doc.createElement('div');
      el.append(doc.createComment('c'));
      const imported = doc.importNode(el, true);
      expect(imported).not.toBe(el);
      expect(imported.childNodes[0].nodeType).toBe(8);
      expect(doc.baseURI).toBe('about:blank');
      expect(() => doc.importNode({} as ProxyNode)).toThrow(/not a proxy node/);
    });
  });
});
