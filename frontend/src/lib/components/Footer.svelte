<script lang="ts">
  import { onMount } from 'svelte';

  import { apiJson } from '../api';
  import { commitInfo, formatUptime, type Uptime } from '../footer';
  import { shell } from '../shell/shell.svelte';
  import { REPO_URL, STATUS_PAGE_URL } from '../site';
  import ExternalLink from './ExternalLink.svelte';

  const commit = commitInfo(__BUILD_SHA__, REPO_URL);
  let uptime = $state<Uptime | null>(null);

  // Ambient info: on any failure the uptime segment just stays hidden.
  onMount(() => {
    apiJson<{ uptime: Uptime | null }>('/api/site-info/')
      .then((info) => (uptime = info.uptime))
      .catch(() => {});
  });
</script>

<footer class="footer" class:shell-open={shell.isOpen}>
  <ul class="footer-items">
    <li>
      <span class="label">build</span>
      {#if commit.url}
        <ExternalLink href={commit.url} aria-label="Commit {commit.short} on GitHub"
          >{commit.short}</ExternalLink
        >
      {:else}
        {commit.short}
      {/if}
      · {__BUILD_DATE__}
    </li>
    <li>
      <!-- Without a number, a plain link keeps the status page reachable. -->
      <ExternalLink href={STATUS_PAGE_URL}>
        {#if uptime}
          <span class="label">uptime</span>
          {formatUptime(uptime.percent)}% ({uptime.days}d)
        {:else}
          status
        {/if}
      </ExternalLink>
    </li>
  </ul>
</footer>

<style>
  .footer {
    border-top: var(--divider);
    padding: 1rem 2rem;
    font-size: 0.8rem;
  }

  /* Lets the footer scroll above the docked shell. */
  .footer.shell-open {
    margin-bottom: var(--shell-height);
  }

  .footer-items {
    list-style: none;
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 0.25rem 2rem;
  }

  .label {
    color: var(--color-text-muted);
  }

  @media (max-width: 768px) {
    .footer {
      padding: 1rem;
    }
  }
</style>
