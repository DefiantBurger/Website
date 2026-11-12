// Site color theme: persisted in localStorage and applied as <html data-theme>.
export type Theme = 'dark' | 'light';

function readStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Storage can be unavailable (e.g. blocked site data); use the default.
  }
  return 'light';
}

class ThemeState {
  current = $state<Theme>(readStoredTheme());

  constructor() {
    document.documentElement.dataset.theme = this.current;
  }

  toggle(): void {
    this.set(this.current === 'dark' ? 'light' : 'dark');
  }

  set(theme: Theme): void {
    this.current = theme;
    document.documentElement.dataset.theme = this.current;
    try {
      localStorage.setItem('theme', this.current);
    } catch {
      // Not persisted; the theme still applies for this visit.
    }
  }
}

export const theme = new ThemeState();
