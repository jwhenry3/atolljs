<script lang="ts">
  /** Mono — the defineSvelteMonoWorker fixture component. */
  let { label = 'mono' }: { label?: string } = $props();
</script>

<p class="mono">{label}</p>
