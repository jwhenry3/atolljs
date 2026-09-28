/**
 * Package-internal tests for the worker-side proxy DOM + global shim.
 * These run with no Worker and no real DOM — the shadow tree is the whole
 * point: mutations emit ops onto a realm queue; reads are served locally.
 */
import { describe, expect, it } from 'vitest';
import { runInRealm, takeOps, getHandler } from '../src/worker/hostConfig';
import {
  createProxyDocument,
  installDomShim,
  ProxyElement,
  type InternalDocument,
} from '../src/worker/proxyDom';
import type { Op } from '../src/ops';

/** Run `fn` inside a realm and return the ops it emitted. */
const inRealm = (realm: string, fn: () => void): Op[] =>
  runInRealm(realm, () => {
    fn();
    return takeOps(realm);
  });

describe('proxyDom shadow tree', () => {
  it('local reads and op emission inside a realm', () => {
    const ops = inRealm('proxy-shadow', () => {
      const doc = createProxyDocument('proxy-shadow');
      const host = doc.createElement('div');
      host.id = 'host';
      host.classList.add('shell-box');
      const kid = doc.createElement('span');
      kid.className = 'kid';
      kid.dataset.role = 'marker';
      kid.textContent = 'hello';
      const tail = doc.createElement('span');
      tail.textContent = 'world';
      host.appendChild(kid);
      host.appendChild(tail);
      doc.body.appendChild(host);

      // Navigation reads are served locally — no main-thread round-trip.
      expect(doc.getElementById('host')).toBe(host);
      expect(doc.querySelector('.kid')).toBe(kid);
      expect(doc.querySelector('#host .kid')).toBe(kid);
      expect(doc.querySelector('[data-role="marker"]')).toBe(kid);
      expect(doc.querySelector('span.kid')).toBe(kid);
      expect(host.childNodes.length).toBe(2);
      expect(host.children.length).toBe(2);
      expect(host.firstChild).toBe(kid);
      expect(host.lastChild).toBe(tail);
      expect(kid.nextSibling).toBe(tail);
      expect(tail.previousSibling).toBe(kid);
      expect(kid.parentNode).toBe(host);
      expect(kid.parentElement).toBe(host);
      expect(kid.ownerDocument).toBe(doc);
      expect(kid.getRootNode()).toBe(doc.body);
      expect(host.textContent).toBe('helloworld');
      expect(kid.isConnected).toBe(true);
      expect(doc.querySelector('.missing')).toBeNull();
      // Unsupported selector shapes fail loudly.
      expect(() => doc.querySelector('div > .kid')).toThrow(/unsupported selector/);

      // textContent rewrite → utext + a phantom text child for reads.
      host.textContent = 'replaced';
      expect(host.textContent).toBe('replaced');
      expect(host.childNodes.length).toBe(1);
      expect(kid.isConnected).toBe(false);
      // The id map still resolves the connected host.
      expect(doc.getElementById('host')).toBe(host);

      // listen/unlisten ops pair up around one handler registration.
      const noopHandler = () => {};
      kid.addEventListener('click', noopHandler);
      kid.removeEventListener('click', noopHandler);
    });

    // Every mutation emitted a replayable op.
    expect(ops.some((o) => o.t === 'create' && o.type === 'div')).toBe(true);
    expect(ops.some((o) => o.t === 'create' && o.type === 'span')).toBe(true);
    expect(ops.some((o) => o.t === 'text')).toBe(false); // no createTextNode here — phantoms
    expect(ops.some((o) => o.t === 'attr' && o.name === 'id' && o.value === 'host')).toBe(true);
    expect(ops.some((o) => o.t === 'attr' && o.name === 'class' && o.value === 'shell-box')).toBe(
      true,
    );
    expect(ops.some((o) => o.t === 'attr' && o.name === 'class' && o.value === 'kid')).toBe(true);
    expect(
      ops.some((o) => o.t === 'attr' && o.name === 'data-role' && o.value === 'marker'),
    ).toBe(true);
    expect(ops.some((o) => o.t === 'utext' && o.text === 'hello')).toBe(true);
    expect(ops.some((o) => o.t === 'utext' && o.text === 'replaced')).toBe(true);
    expect(ops.some((o) => o.t === 'append' && o.parent === 0)).toBe(true);
    expect(ops.some((o) => o.t === 'listen' && o.type === 'click')).toBe(true);
    expect(ops.some((o) => o.t === 'unlisten' && o.type === 'click')).toBe(true);
  });
});

describe('proxyDom innerHTML + html APIs', () => {
  it('set innerHTML parses real HTML into create/attr/append ops; get innerHTML serializes back', () => {
    const ops = inRealm('html', () => {
      const doc = createProxyDocument('html');
      const host = doc.createElement('div');
      host.id = 'host';
      doc.body.appendChild(host);

      host.innerHTML = `<p class="lead">hello <strong data-x="1">world</strong></p><br><input type="checkbox">`;

      // Shadow tree reflects the parsed markup.
      expect(host.children.length).toBe(3);
      const p = host.children[0];
      expect(p.tagName).toBe('P');
      expect(p.className).toBe('lead');
      const strong = p.children[0];
      expect(strong.tagName).toBe('STRONG');
      expect(strong.getAttribute('data-x')).toBe('1');
      expect(p.textContent).toBe('hello world');
      expect(host.children[1].tagName).toBe('BR');
      const input = host.children[2];
      expect(input.tagName).toBe('INPUT');
      expect(input.getAttribute('type')).toBe('checkbox');
      expect(doc.querySelector('#host p.lead strong')).toBe(strong);

      // get innerHTML serializes the shadow tree (void elements, escaping).
      expect(host.innerHTML).toBe(
        '<p class="lead">hello <strong data-x="1">world</strong></p><br><input type="checkbox">',
      );

      // Setting again REPLACES children — old nodes detach.
      host.innerHTML = '<em>x &amp; y</em>';
      expect(host.children.length).toBe(1);
      expect(p.isConnected).toBe(false);
      expect(host.innerHTML).toBe('<em>x &amp; y</em>');

      // outerHTML includes the element itself.
      expect(host.outerHTML).toBe('<div id="host"><em>x &amp; y</em></div>');
    });

    expect(ops.some((o) => o.t === 'create' && o.type === 'p')).toBe(true);
    expect(ops.some((o) => o.t === 'create' && o.type === 'strong')).toBe(true);
    expect(ops.some((o) => o.t === 'create' && o.type === 'br')).toBe(true);
    expect(ops.some((o) => o.t === 'create' && o.type === 'input')).toBe(true);
    expect(ops.some((o) => o.t === 'create' && o.type === 'em')).toBe(true);
    expect(ops.some((o) => o.t === 'attr' && o.name === 'class' && o.value === 'lead')).toBe(true);
    expect(ops.some((o) => o.t === 'attr' && o.name === 'data-x' && o.value === '1')).toBe(true);
    expect(ops.some((o) => o.t === 'attr' && o.name === 'type' && o.value === 'checkbox')).toBe(
      true,
    );
    expect(ops.some((o) => o.t === 'text')).toBe(true);
    // Second innerHTML removed the first batch — remove ops were emitted.
    expect(ops.some((o) => o.t === 'remove')).toBe(true);
  });

  it('insertAdjacentHTML/Element place nodes relative to the target', () => {
    inRealm('adjacent', () => {
      const doc = createProxyDocument('adjacent');
      const root = doc.createElement('div');
      const mid = doc.createElement('p');
      mid.textContent = 'mid';
      root.appendChild(mid);
      doc.body.appendChild(root);

      mid.insertAdjacentHTML('beforebegin', '<i>before</i>');
      mid.insertAdjacentHTML('afterend', '<b>after</b>');
      mid.insertAdjacentHTML('afterbegin', '<u>first</u>');
      mid.insertAdjacentHTML('beforeend', '<s>last</s>');

      expect(root.innerHTML).toBe('<i>before</i><p><u>first</u>mid<s>last</s></p><b>after</b>');

      const extra = doc.createElement('span');
      extra.textContent = 'x';
      expect(mid.insertAdjacentElement('afterend', extra)).toBe(extra);
      expect(mid.nextSibling).toBe(extra);
    });
  });

  it('cloneNode, append/prepend/replaceChildren/remove/closest', () => {
    inRealm('misc', () => {
      const doc = createProxyDocument('misc');
      const list = doc.createElement('ul');
      list.className = 'items';
      doc.body.appendChild(list);

      const li = doc.createElement('li');
      li.className = 'item';
      li.dataset.n = '1';
      li.append('text ', 'tail');
      list.appendChild(li);
      expect(li.childNodes.length).toBe(2);
      expect(li.textContent).toBe('text tail');

      // cloneNode deep copies attrs/children into fresh instances.
      const clone = li.cloneNode(true);
      expect(clone).not.toBe(li);
      expect(clone.instance.id).not.toBe(li.instance.id);
      expect(clone.className).toBe('item');
      expect(clone.textContent).toBe('text tail');
      expect(clone.innerHTML).toBe(li.innerHTML);
      list.append(clone, 'trailing');

      // prepend inserts at the front.
      const head = doc.createElement('li');
      head.className = 'item head';
      list.prepend(head);
      expect(list.firstChild).toBe(head);

      // closest walks self + ancestors.
      expect(li.closest('ul.items')).toBe(list);
      expect(li.closest('.item')).toBe(li);
      expect(head.closest('.nothing')).toBeNull();
      expect(li.matches('li.item[data-n="1"]')).toBe(true);

      // replaceChildren swaps the whole child list; remove() detaches.
      list.replaceChildren(li);
      expect(list.children.length).toBe(1);
      expect(head.isConnected).toBe(false);
      li.remove();
      expect(li.isConnected).toBe(false);
      expect(list.children.length).toBe(0);
    });
  });

  it('document.addEventListener emits listen on id 0 and dispatches an enriched payload.target', () => {
    let received: { targetId?: number; target?: unknown } | null = null;
    let btn: ProxyElement;
    const ops = runInRealm('doc-listen', () => {
      const doc = createProxyDocument('doc-listen');
      btn = doc.createElement('button');
      btn.className = 'hit';
      doc.body.appendChild(btn);

      doc.addEventListener('click', (p) => {
        received = p;
      });
      // A second distinct fn gets its own handler id; removing it pairs
      // the unlisten op.
      const noop = () => {};
      doc.addEventListener('click', noop);
      doc.removeEventListener('click', noop);

      // Fire the registered handler the way a real dispatch would — the
      // payload's targetId resolves to the proxy node for that instance.
      const drained = takeOps('doc-listen');
      const listenOp = drained.find((o) => o.t === 'listen' && o.type === 'click');
      expect(listenOp).toBeDefined();
      getHandler((listenOp as { handler: number }).handler)!.fn({
        type: 'click',
        targetId: btn.instance.id,
      });
      return drained.concat(takeOps('doc-listen'));
    });

    expect(ops.filter((o) => o.t === 'listen').length).toBe(2); // real listener + noop
    expect(ops.every((o) => o.t !== 'listen' || o.id === 0)).toBe(true);
    expect(ops.filter((o) => o.t === 'unlisten').length).toBe(1);
    expect(received).not.toBeNull();
    expect(received!.targetId).toBeGreaterThan(0);
    expect(received!.target instanceof ProxyElement).toBe(true);
    expect((received!.target as ProxyElement).className).toBe('hit');
  });
});

describe('installDomShim', () => {
  it('sets document + window facade, does NOT clobber globalThis listeners, uninstall restores', () => {
    const doc = createProxyDocument('shim-realm');
    const originalAdd = globalThis.addEventListener;
    const originalRemove = globalThis.removeEventListener;
    const hadDoc = 'document' in globalThis;
    const hadWin = 'window' in globalThis;
    const prevDoc = (globalThis as Record<string, unknown>).document;
    const prevWin = (globalThis as Record<string, unknown>).window;

    const uninstall = installDomShim(doc);
    try {
      expect(globalThis.document).toBe(doc);
      const win = (globalThis as unknown as { window: Record<string, unknown> }).window;
      expect(win.document).toBe(doc);
      expect((win.navigator as { userAgent: string }).userAgent).toBe('mesh-worker-dom');
      expect((win.location as { href: string }).href).toBe('about:blank');
      expect(win.innerWidth).toBe(0);
      expect(win.devicePixelRatio).toBe(1);
      expect(typeof win.requestAnimationFrame).toBe('function');
      expect(typeof win.setTimeout).toBe('function');
      // THE critical invariant: the pool's message channel is untouched —
      // window is a facade object, not globalThis.
      expect(globalThis.addEventListener).toBe(originalAdd);
      expect(globalThis.removeEventListener).toBe(originalRemove);
      expect(globalThis.window).not.toBe(globalThis);

      // window.addEventListener → listen op on id 0 (the island container),
      // same mechanism as document.addEventListener.
      const ops = inRealm('shim-realm', () => {
        const fn = () => {};
        (globalThis.window as { addEventListener(t: string, f: () => void): void }).addEventListener(
          'click',
          fn,
        );
        (globalThis.window as { removeEventListener(t: string, f: () => void): void }).removeEventListener(
          'click',
          fn,
        );
      });
      expect(ops.some((o) => o.t === 'listen' && o.id === 0 && o.type === 'click')).toBe(true);
      expect(ops.some((o) => o.t === 'unlisten' && o.id === 0 && o.type === 'click')).toBe(true);
    } finally {
      uninstall();
    }

    if (hadDoc) expect(globalThis.document).toBe(prevDoc);
    else expect('document' in globalThis).toBe(false);
    if (hadWin) expect(globalThis.window).toBe(prevWin);
    else expect('window' in globalThis).toBe(false);
  });

  it('a later install unwinds the previous one — uninstall restores true originals', () => {
    const docA = createProxyDocument('shim-a');
    const docB = createProxyDocument('shim-b');
    const prevDoc = (globalThis as Record<string, unknown>).document;
    const hadDoc = 'document' in globalThis;

    installDomShim(docA);
    installDomShim(docB); // installs over A — A's shim unwinds first
    try {
      expect(globalThis.document).toBe(docB);
    } finally {
      // Uninstall B — restores the ORIGINAL globals, not stale docA.
      (docB as InternalDocument)._uninstallShim?.();
    }
    if (hadDoc) expect(globalThis.document).toBe(prevDoc);
    else expect('document' in globalThis).toBe(false);
  });

  it('dispose() auto-uninstalls the shim the document installed', () => {
    const doc = createProxyDocument('shim-dispose') as InternalDocument;
    installDomShim(doc);
    expect(globalThis.document).toBe(doc);
    doc.dispose();
    expect('document' in globalThis).toBe(false);
    expect('window' in globalThis).toBe(false);
  });
});
