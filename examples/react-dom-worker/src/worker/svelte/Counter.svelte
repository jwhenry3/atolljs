<script lang="ts">
  /**
   * 'counter' — the docs' canonical Svelte island: a `label` wire prop
   * ($props), a local `$state` count mutated by a delegated onclick, and an
   * 'incremented' emit for the shell's status line.
   */
  import { emit } from '@atolljs/svelte-island/worker';

  let { label = 'count' }: { label?: string } = $props();
  let count = $state(0);
  const bump = (): void => {
    count += 1;
    emit('incremented', { count, label });
  };
</script>

<div class="svelte-counter">
  <span class="vanilla-heading">{label}: {count}</span>
  <button class="mw-btn" onclick={bump}>increment</button>
</div>
