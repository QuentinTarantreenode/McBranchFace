<script lang="ts">
  /**
   * A number setting as one row: label on the left, the field with its unit inside, the hint below.
   * The unit sits in the field, so the label never has to end in "every" or start the sentence.
   */
  let {
    label,
    value = $bindable(""),
    unit,
    hint,
    min,
    max,
    disabled = false,
  }: { label: string; value?: string; unit: string; hint?: string; min: number; max: number; disabled?: boolean } = $props();
</script>

<div class="contents {disabled ? '[&>*]:pointer-events-none [&>*]:opacity-50' : ''}">
  <span class="pt-1.5 text-sm font-medium">{label}</span>
  <div>
    <label
      class="flex h-8 w-36 items-center gap-2 rounded-lg border border-line-strong bg-input px-2.5 transition-colors focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20"
    >
      <input type="number" {min} {max} bind:value aria-label={label} {disabled} class="min-w-0 flex-1 bg-transparent text-base text-fg tabular-nums outline-none" />
      <span class="shrink-0 text-sm text-faint">{unit}</span>
    </label>
    {#if hint}<span class="mt-1 block text-xs text-faint">{hint}</span>{/if}
  </div>
</div>
