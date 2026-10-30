<script lang="ts">
  import Modal from "$lib/ui/Modal.svelte";

  let {
    savedSize = null,
    onsize = () => {},
  }: { savedSize?: { width: number; height: number } | null; onsize?: (s: { width: number; height: number } | null) => void } = $props();
</script>

<Modal open title="Settings" resizable {savedSize} {onsize} onclose={() => {}}>
  <p>Body</p>
</Modal>
