<script lang="ts">
  import { identities } from "$lib/stores/identities.svelte";
  import { untrack } from "svelte";
  import { Check } from "@lucide/svelte";
  import { t } from "$lib/i18n/index.svelte";
  import type { IdentityTarget } from "$lib/stores/identities.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Input from "$lib/ui/Input.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import { tooltip } from "$lib/ui/tooltip";
  import { settings } from "$lib/stores/settings.svelte";

  /**
   * The identity of a folder, a repo or a repo group: a short sign and a colour, shown wherever the object
   * is named. Empty fields fall back to what the app computes, shown as the placeholder and the preview.
   */
  let { target, onclose }: { target: IdentityTarget; onclose: () => void } = $props();

  const PALETTE = Array.from({ length: 12 }, (_, i) => `id-${i}`);
  // The dialog opens for one object; its fields start from what that object has.
  const current = untrack(() => settings.config?.identities[target.key]);
  let short = $state(current?.short ?? "");
  let color = $state<string | null>(current?.color ?? null);
  const shown = $derived({ text: short.trim() || target.auto.text, color: color ? `var(--${color})` : target.auto.color });

  async function save() {
    await identities.setIdentity(target.key, { short: short.trim() || null, color });
    onclose();
  }
  async function reset() {
    await identities.setIdentity(target.key, null);
    onclose();
  }
</script>

<Modal open title={t.identity.title(target.name)} width="460px" {onclose}>
  <p class="text-sm text-muted">{t.identity.hint[target.kind]}</p>
  <div class="mt-4 flex items-center gap-3 rounded-lg bg-panel-2/60 px-3 py-2.5">
    <span class="t-meta">{t.identity.preview}</span>
    {#if shown.text}<span class="mbf-root-badge" style="--root: {shown.color}">{shown.text}</span>{/if}
    <span class="min-w-0 truncate text-sm font-medium">{target.name}</span>
  </div>
  <label class="mt-4 flex flex-col gap-1.5">
    <span class="t-meta">{t.identity.short}</span>
    <Input bind:value={short} maxlength={4} placeholder={target.auto.text} aria-label={t.identity.short} data-autofocus />
  </label>
  <div class="mt-4 flex flex-col gap-1.5">
    <span class="t-meta">{t.identity.color}</span>
    <div class="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label={t.identity.color}>
      <button
        type="button"
        role="radio"
        aria-checked={color === null}
        class="h-7 rounded-md border px-2 text-xs transition-colors {color === null ? 'border-accent bg-accent/10 text-accent-ink' : 'border-line-strong text-muted hover:bg-hover'}"
        use:tooltip={t.identity.autoTip}
        onclick={() => (color = null)}>{t.identity.auto}</button
      >
      {#each PALETTE as c, i (c)}
        <!-- The name on hover, as for icon buttons: the tip sits on the frame, the label on the button. -->
        <span class="inline-flex" use:tooltip={{ title: t.sidebar.colors[i], text: t.identity.colorTip }}>
          <button
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={t.sidebar.colors[i]}
            class="grid size-7 place-items-center rounded-md border transition-colors {color === c ? 'border-fg' : 'border-transparent hover:border-line-strong'}"
            onclick={() => (color = c)}
          >
            <span class="grid size-5 place-items-center rounded" style="background: var(--{c})">{#if color === c}<Check size={12} class="text-white" />{/if}</span>
          </button>
        </span>
      {/each}
    </div>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={reset}>{t.identity.reset}</Button>
    <span class="flex-1"></span>
    <Button variant="secondary" onclick={onclose}>{t.common.cancel}</Button>
    <Button variant="primary" onclick={save}>{t.identity.save}</Button>
  {/snippet}
</Modal>
