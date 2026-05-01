<script lang="ts">
  import { navigate } from '../lib/router';

  function openScheduler(): void {
    navigate('/utilities/scheduler/');
  }

  function openFileShare(): void {
    navigate('/utilities/fileshare/');
  }
</script>

<div class="page">
  <header class="page-header">
    <h1>> Utilities</h1>
    <p>Small tools and experiments that are useful beyond portfolio projects.</p>
  </header>

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
    animation: fadeIn 0.5s ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0.5;
    }
    to {
      opacity: 1;
    }
  }

  .page-header {
    margin-bottom: 2rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px dashed var(--color-text-primary);
    grid-column: 1 / -1;
  }

  .page-header h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

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

  @media (max-width: 768px) {
    .page-header h1 {
      font-size: 1.8rem;
    }
  }
</style>
