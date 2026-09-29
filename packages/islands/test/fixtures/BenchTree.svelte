<script lang="ts">
  /**
   * BenchTree — the svelte entry in the cross-framework perf fixture. Same
   * tree every adapter builds: `rows` rows of [.row[data-index] > .cell +
   * .bump] plus one `.inc` button bumping local `$state` — the props-drive-
   * mount + fine-grained-update + dispatch→commit surface the bench spec
   * measures.
   */
  let { rows = 200, label = 'row' }: { rows?: number; label?: string } = $props();
  let n = $state(0);
</script>

<div class="tree">
  {#each Array.from({ length: rows }, (_, i) => i) as i (i)}
    <div class="row" data-index={i}>
      <span class="cell">{label} {i}</span>
      <button class="bump">x</button>
    </div>
  {/each}
  <button class="inc" onclick={() => (n += 1)}>inc {n}</button>
</div>
