<script lang="ts">
  import PageHeader from '../lib/components/PageHeader.svelte';
  import { pathFor } from '../lib/routeDefinitions';
</script>

<PageHeader title="About Me" />

<div class="terminal-box">
  <p>
    Computer Engineering and Physics student at UW–Madison with experience spanning robotics
    hardware design, quantum simulation research, and full-stack web development. Electrical Team
    Lead for Wisconsin Robotics and Undergraduate Researcher in UW–Madison's Quantum Transport
    Theory and Simulation lab.
  </p>
</div>

<div class="about-you-cta">
  <a href={pathFor('aboutYou')} class="prompt"
    >About You: see what this site can learn from your visit</a
  >
</div>

<style>
  .about-you-cta {
    margin-top: 1.5rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--color-text-primary);
  }

  .about-you-cta a {
    font-weight: 700;
  }
</style>
