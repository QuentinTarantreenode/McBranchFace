<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import PathText from "$lib/ui/PathText.svelte";
  import { dialogs } from "$lib/stores/dialogs.svelte";

  const a = $derived(dialogs.ask);

  function confirm() {
    const run = a?.run;
    dialogs.ask = null;
    run?.();
  }
</script>

{#if a}
  <Modal open title={a.title} width="480px" onclose={() => (dialogs.ask = null)}>
    <p class="text-base leading-relaxed text-muted">{a.text}</p>
    {#if a.detail}<p class="selectable mt-2 rounded-lg bg-panel-2 px-3 py-2 font-mono text-sm [overflow-wrap:break-word]">{#if a.detailIsPath}<PathText path={a.detail} />{:else}{a.detail}{/if}</p>{/if}
    {#snippet footer()}
      <Button variant="ghost" data-autofocus onclick={() => (dialogs.ask = null)}>{t.common.cancel}</Button>
      <Button variant={a.danger ? "danger" : "primary"} onclick={confirm}>{a.action}</Button>
    {/snippet}
  </Modal>
{/if}
