<script lang="ts">
  import { t } from "$lib/i18n/index.svelte";
  import type { RepoEntry } from "$lib/stores/scanResults.svelte";
  import Button from "$lib/ui/Button.svelte";
  import Modal from "$lib/ui/Modal.svelte";
  import AnnotationEditor from "./AnnotationEditor.svelte";

  let { repo, onclose }: { repo: RepoEntry; onclose: () => void } = $props();
</script>

<Modal open title={t.detail.repoAnnotationTitle(repo.info.name)} width="520px" {onclose}>
  <p class="mb-3 text-sm text-muted">{t.detail.repoAnnotationHint}</p>
  <AnnotationEditor repoPath={repo.info.path} branch={null} />
  {#snippet footer()}
    <Button variant="primary" data-autofocus onclick={onclose}>{t.common.close}</Button>
  {/snippet}
</Modal>
