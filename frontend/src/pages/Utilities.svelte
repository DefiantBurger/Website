<script lang="ts">
  import LinkCard from '../lib/components/LinkCard.svelte';
  import PageHeader from '../lib/components/PageHeader.svelte';

  const utilities = [
    {
      name: 'Class Scheduler',
      path: '/utilities/scheduler',
      description:
        'Interactive semester planning with prerequisite validation, drag-and-drop course movement, and dependency visualization.',
    },
    {
      name: 'File Share',
      path: '/utilities/fileshare',
      description:
        'Upload a file with an access key, then retrieve it later by entering the same key before it expires.',
    },
    {
      name: 'Message Board',
      path: '/utilities/message-board',
      description:
        'Post short anonymous notes that self-destruct shortly after posting. Uses a strict URL-safe allowlist for sanitization.',
    },
  ];
</script>

<svelte:head>
  <title>Utilities · JosephCicalese.com</title>
  <meta
    name="description"
    content="Interactive tools and experiments, including a class scheduler, file sharing utility, and message board."
  />
</svelte:head>

<div class="auto-grid" style:--grid-min="350px">
  <PageHeader title="Utilities" description="A few of my small tools and experiments." />

  {#each utilities as utility (utility.path)}
    <LinkCard title={utility.name} href={utility.path} cta="Open {utility.name}" button>
      <p>{utility.description}</p>
    </LinkCard>
  {/each}
</div>
