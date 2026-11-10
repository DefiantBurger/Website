<script lang="ts">
  import LinkCard from '../lib/components/LinkCard.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';
  import { pathFor, routeDefinitions } from '../lib/routeDefinitions';

  const sectionLinks = (['about', 'projects', 'utilities', 'contact'] as const).map((key) => ({
    label: routeDefinitions[key].meta.title,
    href: pathFor(key),
  }));

  const featuredProjects: { title: string; description: string; slug?: string }[] = [
    {
      title: 'Personal Website',
      slug: 'personal-website-platform',
      description:
        'A minimal terminal aesthetic website built with Flask and Svelte, hosted on GCP.',
    },
    {
      title: 'Project 2',
      description: 'Description coming soon...',
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

<PageHeader title="Welcome" description="I'm a developer. This is my website.">
  <p class="section-links">
    {#each sectionLinks as link, index (link.href)}
      <!-- eslint-disable-next-line svelte/no-useless-mustaches -- Svelte trims literal whitespace at block edges -->
      {#if index > 0}{' • '}{/if}<a href={link.href}>{link.label}</a>
    {/each}
  </p>
</PageHeader>

<section>
  <h2 class="prompt section-title">Featured Projects</h2>

  <div class="auto-grid card-grid" style:--grid-min="300px">
    {#each featuredProjects as project (project.title)}
      <LinkCard
        title={project.title}
        headingLevel={3}
        href={project.slug ? pathFor('projectDetail', { slug: project.slug }) : pathFor('projects')}
        cta={project.slug ? 'View Project' : 'View More'}
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
  .section-links {
    margin-top: 1rem;
  }

  section {
    margin: 3rem 0;
  }

  .card-grid {
    margin-top: 1.5rem;
  }
</style>
