<script lang="ts">
  import PageHeader from '../lib/components/PageHeader.svelte';
  import { MESSAGE_TTL_SECONDS } from '../lib/messageboard/api';

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
        'Upload a file with a password label, then retrieve it later by entering the same password before the 10-minute expiration window closes.',
    },
    {
      name: 'Message Board',
      path: '/utilities/message-board',
      description: `Post short anonymous notes that self-destruct after around ${MESSAGE_TTL_SECONDS} seconds. Uses a strict URL-safe allowlist for sanitization.`,
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

  .utility-card .button {
    margin-top: 0.5rem;
    width: 100%;
  }
</style>
