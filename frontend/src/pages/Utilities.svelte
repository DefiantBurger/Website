<script lang="ts">
  import { navigate } from '../lib/router';
  import PageHeader from '../lib/components/PageHeader.svelte';

  function openScheduler(): void {
    navigate('/utilities/scheduler/');
  }

  function openFileShare(): void {
    navigate('/utilities/fileshare/');
  }
</script>

<svelte:head>
  <title>Utilities</title>
  <meta name="description" content="Interactive tools and experiments, including a class scheduler and file sharing utility." />
</svelte:head>

<div class="page page-frame">
  <PageHeader
    title="Utilities"
    description="Small tools and experiments that are useful beyond portfolio projects."
  />

  <section class="terminal-box utility-card">
    <h2>Class Scheduler</h2>
    <p>
      Interactive semester planning with prerequisite validation, drag-and-drop course movement,
      and dependency visualization.
    </p>
    <button type="button" on:click={openScheduler}>Open Scheduler</button>
  </section>

  <section class="terminal-box utility-card">
    <h2>File Share</h2>
    <p>
      Upload a file with a password label, then retrieve it later by entering the same password
      before the 10-minute expiration window closes.
    </p>
    <button type="button" on:click={openFileShare}>Open File Share</button>
  </section>
</div>

<style>
  .page {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
    gap: 1.5rem;
  }

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

  .utility-card p {
    margin: 0;
    line-height: 1.8;
  }

  .utility-card button {
    margin-top: 0.5rem;
    width: 100%;
  }
</style>
