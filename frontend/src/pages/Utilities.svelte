<script lang="ts">
  import PageHeader from '../lib/components/PageHeader.svelte';

  const utilities = [
    {
      name: 'Class Scheduler',
      path: '/utilities/scheduler',
      description:
        'Interactive semester planning with prerequisite validation, drag-and-drop course movement, and dependency visualization.',
    },
    {
      name: 'File Share',
      path: '/utilities/fileshare',
      description:
        'Upload a file with an access key, then retrieve it later by entering the same key before it expires.',
    },
    {
      name: 'Message Board',
      path: '/utilities/message-board',
      description:
        'Post short anonymous notes that self-destruct shortly after posting. Uses a strict URL-safe allowlist for sanitization.',
    },
  ];
</script>

<svelte:head>
  <title>Utilities · JosephCicalese.com</title>
  <meta
    name="description"
    content="Interactive tools and experiments, including a class scheduler, file sharing utility, and message board."
  />
</svelte:head>

<div class="auto-grid" style:--grid-min="350px">
  <PageHeader title="Utilities" description="A few of my small tools and experiments." />

  {#each utilities as utility (utility.path)}
    <section class="terminal-box hover-lift clickable-card utility-card">
      <h2>{utility.name}</h2>
      <p>{utility.description}</p>
      <a href={utility.path} class="button stretched-link">Open {utility.name}</a>
    </section>
  {/each}
</div>

<style>
  .utility-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .utility-card h2 {
    margin: 0;
    border: 0;
    font-size: 1.35rem;
  }

  /* Takes the card's spare height so buttons line up across a row. */
  .utility-card p {
    flex-grow: 1;
  }

  .utility-card .button {
    margin-top: 0.5rem;
    width: 100%;
  }
</style>
