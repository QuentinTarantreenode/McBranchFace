<script lang="ts" generics="T">
  let {
    group = $bindable(),
    value,
    label,
    name,
  }: { group: T; value: T; label: string; name: string } = $props();

  const on = $derived(group === value);
</script>

<!-- Same grid as Checkbox: the dot centred on the first text line. -->
<label class="inline-grid cursor-pointer grid-cols-[16px_minmax(0,1fr)] items-start gap-x-2.5 text-base">
  <span class="relative flex h-[19px] items-center">
    <input type="radio" class="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0" {name} checked={on} onchange={() => (group = value)} />
    <span
      aria-hidden="true"
      class="grid size-4 place-items-center rounded-full border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40
        {on ? 'border-accent' : 'border-line-strong bg-input peer-hover:border-faint'}"
    >
      {#if on}<span class="size-2 rounded-full bg-accent"></span>{/if}
    </span>
  </span>
  <span class="min-w-0 leading-[19px]">{label}</span>
</label>
