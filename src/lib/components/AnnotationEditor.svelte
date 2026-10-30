<script lang="ts">
  import { Tag } from "@lucide/svelte";
  import { untrack } from "svelte";
  import { addTag } from "$lib/annotations";
  import { t } from "$lib/i18n/index.svelte";
  import TagPill from "$lib/ui/TagPill.svelte";
  import { rules } from "$lib/stores/rules.svelte";

  let { repoPath, branch }: { repoPath: string; branch: string | null } = $props();

  let note = $state("");
  let tags = $state<string[]>([]);
  let input = $state("");
  let focused = $state(false);

  // Re-read only when the subject changes; a save must not reset what is being typed. Closing a
  // dialog or switching the selection does not always blur the field first, so pending text is
  // saved for the previous subject here and on unmount.
  let subject: { path: string; name: string | null } | null = null;
  const flush = () => {
    if (!subject) return;
    const saved = rules.annotationOf(subject.path, subject.name);
    if (saved.note !== note || saved.tags.join("\n") !== tags.join("\n")) rules.setAnnotation(subject.path, subject.name, { note, tags });
  };
  $effect(() => {
    const [path, name] = [repoPath, branch];
    untrack(() => {
      flush();
      subject = { path, name };
      const a = rules.annotationOf(path, name);
      note = a.note;
      tags = [...a.tags];
      input = "";
    });
  });
  $effect(() => () => untrack(flush));

  const inherited = $derived(branch === null ? [] : rules.annotationOf(repoPath, null).tags.filter((x) => !tags.some((y) => y.toLowerCase() === x.toLowerCase())));
  const suggestions = $derived.by(() => {
    const q = input.trim().replace(/^#/, "").toLowerCase();
    const have = [...tags, ...inherited].map((y) => y.toLowerCase());
    return rules.tags.filter((x) => !have.includes(x.toLowerCase()) && x.toLowerCase().includes(q)).slice(0, 8);
  });

  function save() {
    rules.setAnnotation(repoPath, branch, { note, tags });
  }

  function add(text: string) {
    const next = addTag(tags, text);
    input = "";
    if (next !== tags) {
      tags = next;
      save();
    }
  }

  function remove(tag: string) {
    tags = tags.filter((x) => x !== tag);
    save();
  }

  function onKey(e: KeyboardEvent) {
    if ((e.key === "Enter" || e.key === ",") && input.trim()) {
      e.preventDefault();
      add(input);
    } else if (e.key === "Backspace" && input === "" && tags.length) {
      remove(tags[tags.length - 1]);
    }
  }
</script>

<div class="flex flex-col gap-2.5 rounded-lg bg-panel-2/60 px-3 py-2.5">
  <!-- The tag field looks like one input: pills and the text cursor share the inset surface. -->
  <div
    class="flex min-h-8 flex-wrap items-center gap-1 rounded-lg border bg-input px-2 py-1 transition-colors
      {focused ? 'border-accent ring-2 ring-accent/20' : 'border-line-strong'}"
  >
    <Tag size={13} class="shrink-0 text-faint" />
    {#each tags as tag (tag)}
      <TagPill {tag} onremove={() => remove(tag)} removeLabel={t.detail.removeTag(tag)} removeHint={t.detail.removeTagTip} />
    {/each}
    {#each inherited as tag (tag)}
      <TagPill {tag} muted tip={t.detail.inheritedTag} />
    {/each}
    <input
      bind:value={input}
      class="h-6 min-w-[90px] flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint"
      placeholder={t.detail.tagPlaceholder}
      aria-label={t.detail.tagPlaceholder}
      onkeydown={onKey}
      onfocus={() => (focused = true)}
      onblur={() => {
        focused = false;
        if (input.trim()) add(input);
      }}
    />
  </div>
  {#if (focused || input) && suggestions.length}
    <div class="flex flex-wrap items-center gap-1" aria-label={t.detail.tagSuggestions}>
      <span class="mr-1 text-xs text-faint">{t.detail.tagSuggestions}</span>
      {#each suggestions as s (s)}
        <!-- mousedown: choosing must not blur the field first, which would add the half-typed text. -->
        <button type="button" class="rounded-full" onmousedown={(e) => { e.preventDefault(); add(s); }}>
          <TagPill tag={s} />
        </button>
      {/each}
    </div>
  {/if}
  <textarea
    bind:value={note}
    rows="3"
    maxlength="2000"
    class="block w-full resize-y rounded-lg border border-line-strong bg-input px-2.5 py-2 text-base text-fg outline-none transition-colors
      placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/20"
    placeholder={t.detail.notePlaceholder}
    aria-label={t.detail.annotation}
    onblur={save}
  ></textarea>
</div>
