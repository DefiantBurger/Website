<script lang="ts">
  import { requirementParts } from '../catalog';
  import type { RequirementNode } from '../types';

  let { node }: { node: RequirementNode } = $props();

  const parts = $derived(requirementParts(node));
</script>

<!-- Kept on one line: whitespace between the spans would show up in the text. -->
<span
  >{#each parts as part, index (index)}{#if part.concurrent}<span
        class="concurrent"
        title="May be taken in the same semester">{part.text}*</span
      >{:else}{part.text}{/if}{/each}</span
>

<style>
  .concurrent {
    color: var(--color-concurrent);
  }
</style>
