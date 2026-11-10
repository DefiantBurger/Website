<script lang="ts">
  import type { Fact } from './facts';

  let { facts }: { facts: Fact[] } = $props();
</script>

<dl class="facts">
  {#each facts as fact (fact.label)}
    <dt>{fact.label}</dt>
    <dd class:muted={fact.muted}>
      {fact.value}
      {#if fact.note}
        <small>{fact.note}</small>
      {/if}
    </dd>
  {/each}
</dl>

<style>
  .facts {
    display: grid;
    grid-template-columns: minmax(9rem, max-content) 1fr;
    margin: 0;
  }

  dt,
  dd {
    padding: 0.45rem 0;
    border-top: 1px dashed var(--color-primary-opacity-50);
    line-height: 1.5;
  }

  dt:first-of-type,
  dt:first-of-type + dd {
    border-top: none;
  }

  dt {
    padding-right: 1.25rem;
    font-weight: 700;
  }

  dd {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .muted,
  small {
    color: var(--color-text-muted);
  }

  small {
    display: block;
    font-size: 0.8rem;
  }

  @media (max-width: 600px) {
    .facts {
      grid-template-columns: 1fr;
    }

    dd {
      padding-top: 0;
      border-top: none;
    }
  }
</style>
