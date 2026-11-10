<script lang="ts">
  import PageHeader from '../lib/components/PageHeader.svelte';
  import ExternalLink from '../lib/components/ExternalLink.svelte';

  const contacts = [
    { label: 'email', text: 'joseph.cicalese@gmail.com', href: 'mailto:joseph.cicalese@gmail.com' },
    { label: 'github', text: 'github.com/DefiantBurger', href: 'https://github.com/DefiantBurger' },
    {
      label: 'linkedin',
      text: 'linkedin.com/in/joseph-cicalese',
      href: 'https://www.linkedin.com/in/joseph-cicalese/',
    },
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
    border-bottom: 1px dashed var(--color-primary-opacity-30);
  }

  .label {
    color: var(--color-accent);
    font-weight: 700;
  }

  .contact-list :global(a) {
    color: inherit;
  }
</style>
