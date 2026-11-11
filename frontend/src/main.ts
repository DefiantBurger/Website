import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';

// The app renders its own description and canonical link, so drop the build's copies
// to avoid duplicates (and stale ones after client-side navigation).
document.querySelectorAll('[data-static-meta]').forEach((element) => element.remove());

const app = mount(App, {
  target: document.getElementById('app')!,
});

export default app;
