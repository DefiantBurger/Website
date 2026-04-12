<script lang="ts">
</script>

<div class="page">
  <header class="page-header">
    <h1>> About Me</h1>
  </header>

  <div class="content terminal-box">
    <p>Coming soon...</p>
    <p>Tell your story here.</p>
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

  @media (max-width: 768px) {
    .page-header h1 {
      font-size: 1.8rem;
    }
  }
</style>
