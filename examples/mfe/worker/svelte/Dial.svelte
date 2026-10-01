<script lang="ts">
  /**
   * 'dial' — a range input MFE running inside the worker via Svelte's
   * mount() on the proxy DOM. Input events dispatch back into the worker;
   * the wire payload's `value` is stamped on the event target.
   */
  import { untrack } from 'svelte';
  import { emit } from '@atolljs/svelte-island/worker';

  let { label = 'svelte mfe', value = 40 }: { label?: string; value?: number } = $props();
  let current = $state(untrack(() => value));
  const change = (e: Event): void => {
    current = Number((e.target as HTMLInputElement).value);
    emit('changed', { value: current });
  };
</script>

<div class="mfe-card">
  <span class="mfe-heading">{label}: {current}</span>
  <input class="mfe-range" type="range" min="0" max="100" {value} oninput={change} />
</div>
