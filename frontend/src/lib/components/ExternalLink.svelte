<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAnchorAttributes } from 'svelte/elements';

  let { href, children, ...rest }: HTMLAnchorAttributes & { href: string; children: Snippet } =
    $props();
</script>

<a {href} target="_blank" rel="noopener noreferrer" {...rest}
  >{@render children()}<span class="sr-only">&nbsp;(opens in new tab)</span></a
>
