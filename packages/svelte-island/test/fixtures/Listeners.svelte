<script lang="ts">
  /**
   * Listeners — exercises the svelteIslandApp listener-patch surface:
   *   - document-level addEventListener (patchDocumentListeners wrap +
   *     flushSync) including a duplicate registration (byType.has → skip)
   *   - doc.body (id-0 element) registration through the proto patch
   *   - the SAME fn on both id-0 targets → the second claim dedupes to null
   *     so a single event emits exactly once
   *   - { once: true } auto-removal replaying through the wrapped-fn surface
   *   - removeEventListener for unregistered fns (wrapped === undefined →
   *     base impl), for a wrapped fn, and for a deduped (null) fn
   * Event dispatches emit over the island→shell channel so the test can
   * count how many times each handler actually fired.
   */
  import { emit } from '@atolljs/islands/worker';

  const docHeard = (): void => emit('doc-heard', {});
  const bodyHeard = (): void => emit('body-heard', {});
  const sharedHeard = (): void => emit('shared-heard', {});
  const onceHeard = (): void => emit('once-heard', {});
  const ghost = (): void => emit('ghost', {});

  document.addEventListener('atoll-doc', docHeard);
  document.addEventListener('atoll-doc', docHeard); // dup → early return
  document.body.addEventListener('atoll-body', bodyHeard);

  // Same fn on both id-0 surfaces — the body's claim dedupes to null.
  document.addEventListener('atoll-shared', sharedHeard);
  document.body.addEventListener('atoll-shared', sharedHeard);

  // once → upstream auto-removal routes the WRAPPED fn back through the
  // patched removeEventListener (wrapped === undefined branch).
  document.addEventListener('atoll-once', onceHeard, { once: true });

  // Removing a fn that was never wrapped → base removeEventListener.
  document.removeEventListener('atoll-ghost', ghost);
  document.body.removeEventListener('atoll-ghost', ghost);

  const removeDoc = (): void => {
    document.removeEventListener('atoll-doc', docHeard); // wrapped → origRemove + releaseShared
    emit('doc-removed', {});
  };
  const removeBody = (): void => {
    document.body.removeEventListener('atoll-body', bodyHeard); // id-0 → releaseShared + protoRemove
    emit('body-removed', {});
  };
  const removeShared = (): void => {
    document.body.removeEventListener('atoll-shared', sharedHeard); // deduped → wrapped === null
    emit('shared-body-removed', {});
  };
</script>

<div class="listeners-root">
  <button class="rm-doc" onclick={removeDoc}>rm-doc</button>
  <button class="rm-body" onclick={removeBody}>rm-body</button>
  <button class="rm-shared" onclick={removeShared}>rm-shared</button>
</div>
