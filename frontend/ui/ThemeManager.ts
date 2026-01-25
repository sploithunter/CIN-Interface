/**
 * ThemeManager - Handles light/dark theme switching
 *
 * Uses CSS custom properties defined in theme.css
 * Persists theme preference to localStorage
 */

type Theme = 'dark' | 'light';

const STORAGE_KEY = 'cin-interface-theme';
const META_THEME_COLORS = {
  dark: '#0f172a',
  light: '#f8fafc'
};

class ThemeManager {
  private currentTheme: Theme = 'dark';
  private toggleBtn: HTMLElement | null = null;

  constructor() {
    // Load saved theme or use system preference
    this.currentTheme = this.getSavedTheme();
  }

  /**
   * Initialize the theme manager - call after DOM is ready
   */
  init(): void {
    // Apply the initial theme
    this.applyTheme(this.currentTheme);

    // Set up the toggle button
    this.toggleBtn = document.getElementById('theme-toggle');
    if (this.toggleBtn) {
      this.updateToggleUI();
      this.toggleBtn.addEventListener('click', (e) => this.handleToggleClick(e));
    }
  }

  /**
   * Get the saved theme from localStorage or use system preference
   */
  private getSavedTheme(): Theme {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }

    // Check system preference
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }

    return 'dark';
  }

  /**
   * Apply a theme to the document
   */
  private applyTheme(theme: Theme): void {
    this.currentTheme = theme;

    // Set the data-theme attribute on the document
    document.documentElement.setAttribute('data-theme', theme);

    // Update the meta theme-color for mobile browsers
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', META_THEME_COLORS[theme]);
    }

    // Save to localStorage
    localStorage.setItem(STORAGE_KEY, theme);

    // Dispatch custom event for other components to react
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  /**
   * Handle click on the toggle button
   */
  private handleToggleClick(e: MouseEvent): void {
    const target = e.target as HTMLElement;
    const themeOption = target.closest('.theme-option') as HTMLElement;

    if (themeOption) {
      const newTheme = themeOption.dataset.theme as Theme;
      if (newTheme && newTheme !== this.currentTheme) {
        this.applyTheme(newTheme);
        this.updateToggleUI();
      }
    }
  }

  /**
   * Update the toggle button UI to reflect current theme
   */
  private updateToggleUI(): void {
    if (!this.toggleBtn) return;

    const options = this.toggleBtn.querySelectorAll('.theme-option');
    options.forEach((option) => {
      const el = option as HTMLElement;
      if (el.dataset.theme === this.currentTheme) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  }

  /**
   * Get the current theme
   */
  getTheme(): Theme {
    return this.currentTheme;
  }

  /**
   * Set the theme programmatically
   */
  setTheme(theme: Theme): void {
    this.applyTheme(theme);
    this.updateToggleUI();
  }

  /**
   * Toggle between light and dark themes
   */
  toggle(): void {
    const newTheme = this.currentTheme === 'dark' ? 'light' : 'dark';
    this.applyTheme(newTheme);
    this.updateToggleUI();
  }
}

// Export singleton instance
export const themeManager = new ThemeManager();
