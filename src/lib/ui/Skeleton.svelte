<script lang="ts">
  /** A shimmering placeholder in the shape of the content it stands for. */
  let { class: extra = "" }: { class?: string } = $props();
</script>

<span aria-hidden="true" class="skeleton block {extra}"></span>
