<script lang="ts">
  import PageHeader from '../lib/components/PageHeader.svelte';

  const sectionLinks = [
    { label: 'About', href: '/about' },
    { label: 'Projects', href: '/projects' },
    { label: 'Utilities', href: '/utilities' },
    { label: 'Contact', href: '/contact' }
  ];

  const featuredProjects = [
    {
      title: 'Personal Website',
      description: 'A minimal terminal aesthetic website built with Flask and Svelte, hosted on GCP.'
    },
    {
      title: 'Project 2',
      description: 'Description coming soon...'
    }
  ];

  const quickLinks = [
    { title: 'About Me', text: 'Learn more about who I am and what I do.', href: '/about', cta: 'Read →' },
    {
      title: 'Utilities',
      text: 'Interactive tools including the class scheduler utility.',
      href: '/utilities',
      cta: 'Open →'
    },
    { title: 'Contact', text: 'Get in touch with me.', href: '/contact', cta: 'Reach Out →' }
  ];
</script>

<svelte:head>
  <title>Home</title>
  <meta name="description" content="Personal portfolio and projects by me." />
</svelte:head>

<PageHeader title="Welcome" description="I'm a developer. This is my website.">
  <p class="section-links">
    {#each sectionLinks as link, index (link.href)}
      {#if index > 0}{' • '}{/if}<a href={link.href}>{link.label}</a>
    {/each}
  </p>
</PageHeader>

<section>
  <h2>> Featured Projects</h2>

  <div class="card-grid projects-grid">
    {#each featuredProjects as project (project.title)}
      <div class="terminal-box hover-lift">
        <h3>{project.title}</h3>
        <p>{project.description}</p>
        <a href="/projects" class="card-link">> View More</a>
      </div>
    {/each}
  </div>
</section>

<section>
  <h2>> Quick Links</h2>

  <div class="card-grid links-grid">
    {#each quickLinks as link (link.href)}
      <div class="terminal-box hover-lift quick-link">
        <strong>> {link.title}</strong>
        <p>{link.text}</p>
        <a href={link.href}>{link.cta}</a>
      </div>
    {/each}
  </div>
</section>

<style>
  .section-links {
    margin-top: 1rem;
  }

  section {
    margin: 3rem 0;
  }

  .card-grid {
    display: grid;
    gap: 1.5rem;
    margin-top: 1.5rem;
  }

  .projects-grid {
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  }

  .links-grid {
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  }

  h3 {
    margin-bottom: 0.5rem;
  }

  .card-link {
    display: inline-block;
    margin-top: 1rem;
  }

  .quick-link strong {
    display: block;
    margin-bottom: 0.5rem;
  }

  .quick-link p {
    margin-bottom: 1rem;
    font-size: 0.95rem;
  }

  @media (max-width: 768px) {
    .card-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
