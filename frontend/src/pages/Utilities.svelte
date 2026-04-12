<script lang="ts">
  import { navigate } from '../lib/router';

  function openScheduler(): void {
    navigate('/utilities/scheduler/');
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
  }

  .page-header h1 {
    font-size: 2.5rem;
    margin-bottom: 0.5rem;
  }

  .utility-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 680px;
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
    align-self: flex-start;
    margin-top: 0.5rem;
  }

  @media (max-width: 768px) {
    .page-header h1 {
      font-size: 1.8rem;
    }
  }
</style>
