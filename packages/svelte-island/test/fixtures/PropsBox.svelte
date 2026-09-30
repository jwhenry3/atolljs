<script lang="ts">
  /**
   * PropsBox — exercises createPropsBox.update's deletion branch: a prop
   * present at mount that disappears from a later update must be deleted
   * from the $state record (not just left stale), which this template makes
   * observable.
   */
  let { label = 'props', gone }: { label?: string; gone?: string } = $props();
</script>

<p class="pb">{label}|{gone ?? 'deleted'}</p>
