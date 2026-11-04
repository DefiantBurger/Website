import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'

// Every page sets its own description, so drop index.html's fallback to avoid duplicates.
document.querySelector('meta[name="description"][data-static-meta]')?.remove()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
