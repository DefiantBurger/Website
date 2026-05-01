<script lang="ts">
  import { onMount } from 'svelte';
  import { navigate } from '../lib/router';
  
  interface Project {
    title: string;
    description: string;
  }

  let projects: Project[] = [];
  let loading = false;
  let error: string | null = null;

  onMount(async () => {
    loading = true;
    try {
      // Placeholder: will connect to API later
      projects = [
        {
          title: 'Personal Website',
          description: 'A minimal terminal aesthetic website built with Flask and Svelte, hosted on GCP.'
        },
        {
          title: 'Project 2',
          description: 'Description coming soon...'
        }
      ];
    } catch (e) {
      error = 'Failed to load projects';
    } finally {
      loading = false;
    }
  });
</script>

<svelte:head>
  <title>Home</title>
  <meta name="description" content="Personal portfolio and projects by me." />
</svelte:head>

<div class="home">
  <header class="hero">
    <h1>> Welcome</h1>
    <p>
      I'm a developer. This is my website.
    </p>
    <p>
      <a href="/" on:click={(e) => { e.preventDefault(); navigate('/about'); }}>About</a> • 
      <a href="/" on:click={(e) => { e.preventDefault(); navigate('/projects'); }}>Projects</a> • 
      <a href="/" on:click={(e) => { e.preventDefault(); navigate('/utilities'); }}>Utilities</a> • 
      <a href="/" on:click={(e) => { e.preventDefault(); navigate('/contact'); }}>Contact</a>
    </p>
  </header>

  <section class="featured-projects">
    <h2>> Featured Projects</h2>
    
    {#if loading}
      <div class="loading">> Loading projects...</div>
    {:else if error}
      <div class="error">> {error}</div>
    {:else}
      <div class="projects-grid">
        {#each projects as project}
          <div class="project-card terminal-box">
            <h3>{project.title}</h3>
            <p>{project.description}</p>
            <a href="/" on:click={(e) => { e.preventDefault(); navigate('/projects'); }} class="view-more">> View More</a>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="quick-links">
    <h2>> Quick Links</h2>
    <div class="links-grid">
      <div class="link-item terminal-box">
        <strong>> About Me</strong>
        <p>Learn more about who I am and what I do.</p>
        <a href="/" on:click={(e) => { e.preventDefault(); navigate('/about'); }}>Read →</a>
      </div>
      <div class="link-item terminal-box">
        <strong>> Utilities</strong>
        <p>Interactive tools including the class scheduler utility.</p>
        <a href="/" on:click={(e) => { e.preventDefault(); navigate('/utilities'); }}>Open →</a>
      </div>
      <div class="link-item terminal-box">
        <strong>> Contact</strong>
        <p>Get in touch with me.</p>
        <a href="/" on:click={(e) => { e.preventDefault(); navigate('/contact'); }}>Reach Out →</a>
      </div>
    </div>
  </section>
</div>

<style>
  .home {
    animation: fadeIn var(--transition-fade) ease-in;
  }

  @keyframes fadeIn {
    from {
      opacity: 0.5;
    }
    to {
      opacity: 1;
    }
  }

  .hero {
    margin-bottom: 3rem;
    padding-bottom: 2rem;
    border-bottom: 1px dashed var(--color-text-primary);
  }

  .hero h1 {
    font-size: 3rem;
    margin-bottom: 1rem;
  }

  .hero p {
    font-size: 1.2rem;
    margin-bottom: 1.5rem;
  }

  .hero a {
    margin-right: 1rem;
  }

  .featured-projects {
    margin: 3rem 0;
  }

  .projects-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
    margin-top: 1.5rem;
  }

  .project-card {
    transition: all 0.2s ease;
  }

  .project-card:hover {
    box-shadow: 0 0 20px var(--color-primary-opacity-30);
    transform: translateY(-2px);
  }

  .project-card h3 {
    margin-top: 0;
    margin-bottom: 0.5rem;
  }

  .view-more {
    display: inline-block;
    margin-top: 1rem;
  }

  .quick-links {
    margin: 3rem 0;
  }

  .links-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1.5rem;
    margin-top: 1.5rem;
  }

  .link-item {
    transition: all 0.2s ease;
  }

  .link-item:hover {
    box-shadow: 0 0 20px var(--color-primary-opacity-30);
    transform: translateY(-2px);
  }

  .link-item strong {
    display: block;
    margin-bottom: 0.5rem;
  }

  .link-item p {
    margin-bottom: 1rem;
    font-size: 0.95rem;
  }

  .loading {
    color: var(--color-text-primary);
    opacity: 0.7;
    animation: blink 1s infinite;
  }

  @keyframes blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0.3; }
  }

  .error {
    color: #ff6b6b;
    border: 1px solid #ff6b6b;
    padding: 1rem;
    border-radius: 3px;
    background-color: rgba(255, 107, 107, 0.05);
  }

  @media (max-width: 768px) {
    .hero h1 {
      font-size: 2rem;
    }

    .hero p {
      font-size: 1rem;
    }

    .projects-grid,
    .links-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
