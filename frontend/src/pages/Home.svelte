<script lang="ts">
  import LinkCard from '../lib/components/LinkCard.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import { pathFor } from '../lib/routeDefinitions';

  const featuredProjects: { title: string; description: string; slug: string }[] = [
    {
      title: 'Personal Website',
      slug: 'personal-website-platform',
      description:
        'A minimal terminal aesthetic website built with Flask and Svelte, hosted on GCP.',
    },
    {
      title: 'Quantum Scattering Research',
      slug: 'quantum-scattering-research',
      description:
        'A split-operator Schrödinger solver with total-field/scattered-field sources, generating data for neural networks that solve the inverse scattering problem.',
    },
  ];

  const quickLinks = [
    {
      title: 'About Me',
      text: 'Learn more about who I am and what I do.',
      href: pathFor('about'),
      cta: 'Read',
    },
    {
      title: 'Utilities',
      text: 'Interactive tools including the class scheduler utility.',
      href: pathFor('utilities'),
      cta: 'Open',
    },
    { title: 'Contact', text: 'Get in touch with me.', href: pathFor('contact'), cta: 'Reach Out' },
  ];
</script>

<PageHeader title="Welcome" description="I'm Joseph Cicalese. This is my website." />

<section>
  <h2 class="prompt section-title">Featured Projects</h2>

  <div class="auto-grid card-grid" style:--grid-min="300px">
    {#each featuredProjects as project (project.title)}
      <LinkCard
        title={project.title}
        headingLevel={3}
        href={pathFor('projectDetail', { slug: project.slug })}
        cta="View Project"
      >
        <p>{project.description}</p>
      </LinkCard>
    {/each}
  </div>
</section>

<section>
  <h2 class="prompt section-title">Quick Links</h2>

  <div class="auto-grid card-grid" style:--grid-min="250px">
    {#each quickLinks as link (link.href)}
      <LinkCard title={link.title} headingLevel={3} href={link.href} cta={link.cta}>
        <p>{link.text}</p>
      </LinkCard>
    {/each}
  </div>
</section>

<style>
  section {
    margin: 3rem 0;
  }

  .card-grid {
    margin-top: 1.5rem;
  }
</style>
