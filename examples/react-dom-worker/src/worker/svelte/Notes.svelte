<script lang="ts">
  /**
   * 'notes' — the notes composer from the Vue demo, Svelte 5 runes style:
   * draft + notes are `$state`, the `{#each}` list and `{length}` readout
   * update through the proxy DOM, and 'noteAdded' emits to the shell.
   */
  import { emit } from '@atolljs/svelte-island/worker';

  let { title = 'svelte island' }: { title?: string } = $props();
  let draft = $state('');
  let notes = $state<string[]>([]);

  const add = (): void => {
    const text = draft.trim();
    if (text === '') return;
    notes = [...notes, text];
    draft = '';
    emit('noteAdded', { text, total: notes.length });
  };
</script>

<div class="svelte-notes">
  <h3 class="vanilla-heading">{title}</h3>
  <div class="atoll-map-places">
    <input
      placeholder="write a note…"
      value={draft}
      oninput={(e) => { draft = e.currentTarget.value; }}
      onkeydown={(e) => { if (e.key === 'Enter') add(); }}
    />
    <button class="atoll-map-place-btn" onclick={add}>add</button>
  </div>
  <ul class="vanilla-log">
    {#each notes as n, i (i)}
      <li class="vanilla-log-line">{n}</li>
    {/each}
  </ul>
  <div class="vanilla-readout">{notes.length} note(s) — state lives in the worker</div>
</div>
