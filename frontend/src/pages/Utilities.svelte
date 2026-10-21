<script lang="ts">
  import { navigate } from '../lib/router';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import { MESSAGE_TTL_SECONDS } from '../lib/messageboard/api';

  function openScheduler(): void {
    navigate('/utilities/scheduler/');
  }

  function openFileShare(): void {
    navigate('/utilities/fileshare/');
  }

  function openMessageBoard(): void {
    navigate('/utilities/message-board/');
  }
</script>

<svelte:head>
  <title>Utilities</title>
  <meta name="description" content="Interactive tools and experiments, including a class scheduler, file sharing utility, and message board." />
</svelte:head>

<div class="page page-frame">
  <PageHeader
    title="Utilities"
    description="A few of my small tools and experiments."
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

  <section class="terminal-box utility-card">
    <h2>Message Board</h2>
    <p>
      Post short anonymous notes that self-destruct after around {MESSAGE_TTL_SECONDS} seconds. Uses a strict URL-safe
      allowlist for sanitization.
    </p>
    <button type="button" on:click={openMessageBoard}>Open Message Board</button>
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
