<script lang="ts">
  /**
   * Counter — the svelte-island test fixture. `label` is wire-driven (proves
   * mount props + fine-grained updateProps), `n` is local `$state` mutated by
   * a delegated onclick (proves dispatch → ops round-trip), the `{#if}`
   * branch exercises `<!>` comment anchors over the proxy DOM, and `emit`
   * proves the island→shell channel.
   */
  import { emit } from '@jwhenry123/mesh-islands/worker';
  import { untrack } from 'svelte';

  let { label = 'count' }: { label?: string } = $props();
  let n = $state(0);

  // Mount-time emit — runs inside the mount task's realm scope, lands in
  // the initial op batch the driver routes to onEvent. `untrack` keeps the
  // one-shot prop read from registering as a dependency.
  emit('ready', { label: untrack(() => label) });
</script>

<div class="counter">
  <span class="lbl">{label}: {n}</span>
  {#if n > 0}<em class="pos">positive</em>{/if}
  <button class="inc" onclick={() => (n += 1)}>inc</button>
  <button class="tell" onclick={() => emit('clicked', { n })}>tell</button>
</div>
