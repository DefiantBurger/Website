<script lang="ts">
  import { navigate } from '../lib/router';
  import PageHeader from '../lib/components/PageHeader.svelte';
</script>

<svelte:head>
  <title>About</title>
  <meta name="description" content="Learn more about the developer behind this website." />
</svelte:head>

<div class="page page-frame">
  <PageHeader title="About Me" />

  <div class="content terminal-box">
    <p>Coming soon...</p>
    <p>Tell your story here.</p>
  </div>

  <div class="about-you-cta">
    <a href="/about-you" on:click={(e) => { e.preventDefault(); navigate('/about-you'); }}>
      > See what this site can learn from your visit
    </a>
  </div>
</div>

<style>
  .content {
    padding: 2rem;
  }

  .content p {
    margin-bottom: 1rem;
    line-height: 1.8;
  }

  .about-you-cta {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--color-text-primary);
  }

  .about-you-cta a {
    font-weight: 700;
  }
</style>
