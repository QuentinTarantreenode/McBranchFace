<script lang="ts">
  import { commandRuns } from "$lib/stores/commandRuns.svelte";
  import { CircleAlert, CircleCheck, Info, X } from "@lucide/svelte";
  import { t } from "$lib/i18n/index.svelte";
  import Button from "$lib/ui/Button.svelte";
  import IconButton from "$lib/ui/IconButton.svelte";
  import { toasts } from "$lib/stores/toasts.svelte";

  // Room to the window edge in pixels, not rem: at the app's root size a rem padding came out near 10 px.
  const EDGE = 24;
  const PAD = 12;
  const bottom = $derived(EDGE + (commandRuns.runs.length ? commandRuns.runsPanelHeight + 8 : 0));
  // Three at most in view: nine stacked over the table hid three of its columns. The rest wait behind one
  // line that unfolds them; nothing is dropped.
  const SHOWN = 3;
  let unfolded = $state(false);
  const hidden = $derived(Math.max(0, toasts.list.length - SHOWN));
  const shown = $derived(unfolded || !hidden ? toasts.list : toasts.list.slice(-SHOWN));
  $effect(() => {
    if (!hidden) unfolded = false;
  });
</script>

<!-- Above the runs panel when it is shown: both live at the bottom right. -->
<!-- The stack stops below the top bar and scrolls: many at once otherwise ran out of the window.
     The padding keeps the cards' shadows inside the scroll box, which would clip them. -->
<div
  class="pointer-events-none fixed right-[12px] z-50 flex w-[424px] max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-y-auto p-[12px]"
  style="bottom: {bottom - PAD}px; max-height: calc(100vh - {bottom + 52}px)"
  role="status"
  aria-live="polite"
>
  {#if hidden}
    <div class="pointer-events-auto flex justify-end gap-2 rounded-xl border border-line bg-panel px-3 py-2 shadow-panel">
      <Button size="sm" onclick={() => (unfolded = !unfolded)}>{unfolded ? t.common.toastsFewer : t.common.toastsMore(hidden)}</Button>
      <Button size="sm" onclick={() => toasts.list.slice().forEach((x) => toasts.dismiss(x.id))}>{t.common.toastsCloseAll}</Button>
    </div>
  {/if}
  {#each shown as toast (toast.id)}
    <!-- A CSS entrance instead of a Svelte transition: the transition runtime would be start-bundle weight for this alone. -->
    <div
      class="toast-in pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-panel px-4 py-3 shadow-panel"
    >
      <span class="mt-0.5 shrink-0 {toast.kind === 'error' ? 'text-unsafe' : toast.kind === 'success' ? 'text-safe' : 'text-accent'}">
        {#if toast.kind === "error"}<CircleAlert size={16} />{:else if toast.kind === "success"}<CircleCheck size={16} />{:else}<Info size={16} />{/if}
      </span>
      <div class="min-w-0 flex-1">
        <p class="selectable text-base leading-snug break-words">{toast.text}</p>
        <!-- eslint-disable-next-line mbf/no-break-all -- raw error output (git, OS) has long tokens; three lines at most -->
        {#if toast.detail}<p class="selectable mt-1 line-clamp-3 font-mono text-xs [overflow-wrap:anywhere] text-faint">{toast.detail}</p>{/if}
        {#if toast.action}
          {@const action = toast.action}
          <div class="mt-2">
            <Button
              size="sm"
              onclick={() => {
                action.run();
                toasts.dismiss(toast.id);
              }}>{action.label}</Button
            >
          </div>
        {/if}
      </div>
      <div class="-mt-1 -mr-2"><IconButton icon={X} size="sm" label={t.common.close} onclick={() => toasts.dismiss(toast.id)} /></div>
    </div>
  {/each}
</div>
