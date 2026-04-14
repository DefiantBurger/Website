<script lang="ts">
  import { navigate } from '../lib/router';
</script>

<div class="page">
  <header class="page-header">
    <h1>> About Me</h1>
  </header>

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

  @media (max-width: 768px) {
    .page-header h1 {
      font-size: 1.8rem;
    }
  }
</style>
