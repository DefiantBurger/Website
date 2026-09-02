<script lang="ts">
  import PageHeader from '../lib/components/PageHeader.svelte';
</script>

<svelte:head>
  <title>Contact</title>
  <meta name="description" content="Get in touch with me." />
</svelte:head>

<div class="page page-frame">
  <PageHeader title="Contact" />

  <div class="content terminal-box">
    <ul class="contact-list">
      <li><span class="label">email:</span> <a href="mailto:joseph.cicalese@gmail.com">joseph.cicalese@gmail.com</a></li>
      <li><span class="label">github:</span> <a href="https://github.com/DefiantBurger" target="_blank" rel="noreferrer">github.com/DefiantBurger</a></li>
      <li><span class="label">linkedin:</span> <a href="https://www.linkedin.com/in/joseph-cicalese/" target="_blank" rel="noreferrer">linkedin.com/in/joseph-cicalese</a></li>
      <li><span class="label">location:</span> Madison, WI & Philadelphia, PA</li>
    </ul>
  </div>
</div>

<style>
  .content {
    padding: 2rem;
  }

  .contact-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: 0.75rem;
  }

  .contact-list li {
    padding: 0.5rem 0;
    border-bottom: 1px dashed rgba(255, 255, 255, 0.15);
  }

  .label {
    color: var(--color-accent, #2ebdff);
    font-weight: 700;
  }

  a {
    color: inherit;
    text-decoration: underline;
  }
</style>
