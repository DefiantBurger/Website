<script lang="ts">
  import PageHeader from '../lib/components/PageHeader.svelte';
  import ExternalLink from '../lib/components/ExternalLink.svelte';

  import { EMAIL, GITHUB_URL, LINKEDIN_URL } from '../lib/site';

  // Shown without the scheme, "www.", or trailing slash.
  const displayUrl = (url: string) => url.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, '');

  const contacts = [
    { label: 'email', text: EMAIL, href: `mailto:${EMAIL}` },
    { label: 'github', text: displayUrl(GITHUB_URL), href: GITHUB_URL },
    { label: 'linkedin', text: displayUrl(LINKEDIN_URL), href: LINKEDIN_URL },
    { label: 'location', text: 'Madison, WI & Philadelphia, PA' },
  ];
</script>

<PageHeader title="Contact" />

<div class="terminal-box">
  <ul class="contact-list">
    {#each contacts as contact (contact.label)}
      <li>
        <span class="label">{contact.label}:</span>
        {#if contact.href?.startsWith('http')}
          <ExternalLink href={contact.href}>{contact.text}</ExternalLink>
        {:else if contact.href}
          <a href={contact.href}>{contact.text}</a>
        {:else}
          {contact.text}
        {/if}
      </li>
    {/each}
  </ul>
</div>

<style>
  .contact-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .contact-list li {
    padding: 0.5rem 0;
    border-bottom: var(--divider);
  }

  .label {
    color: var(--color-accent);
    font-weight: 700;
  }

  .contact-list :global(a) {
    color: inherit;
  }
</style>
