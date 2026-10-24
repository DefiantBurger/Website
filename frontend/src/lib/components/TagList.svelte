<script lang="ts">
  let { tags }: { tags: string[] } = $props();
</script>

{#if tags.length > 0}
  <div class="tag-list">
    {#each tags as tag (tag)}
      <span class="tag">{tag}</span>
    {/each}
  </div>
{/if}

<style>
  .tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .tag {
    border: 1px solid var(--color-text-primary);
    padding: 0.15rem 0.45rem;
    border-radius: 3px;
    font-size: 0.85rem;
  }
</style>
