<script lang="ts">
  import PageHeader from '../lib/components/PageHeader.svelte';

  const contacts = [
    { label: 'email', text: 'joseph.cicalese@gmail.com', href: 'mailto:joseph.cicalese@gmail.com' },
    { label: 'github', text: 'github.com/DefiantBurger', href: 'https://github.com/DefiantBurger' },
    {
      label: 'linkedin',
      text: 'linkedin.com/in/joseph-cicalese',
      href: 'https://www.linkedin.com/in/joseph-cicalese/'
    },
    { label: 'location', text: 'Madison, WI & Philadelphia, PA' }
  ];
</script>

<svelte:head>
  <title>Contact</title>
  <meta name="description" content="Get in touch with me." />
</svelte:head>

<PageHeader title="Contact" />

<div class="content terminal-box">
  <ul class="contact-list">
    {#each contacts as contact (contact.label)}
      <li>
        <span class="label">{contact.label}:</span>
        {#if contact.href?.startsWith('http')}
          <a href={contact.href} target="_blank" rel="noreferrer">{contact.text}</a>
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
  .content {
    padding: 2rem;
  }

  .contact-list {
    list-style: none;
    display: grid;
    gap: 0.75rem;
  }

  .contact-list li {
    padding: 0.5rem 0;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
  }

  .label {
    color: #2ebdff;
    font-weight: 700;
  }

  a {
    color: inherit;
    text-decoration: underline;
  }
</style>
