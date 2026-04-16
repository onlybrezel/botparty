import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        card: 'var(--card)',
        border: 'var(--border)',
        primary: 'var(--primary)',
        muted: 'var(--muted)',
      },
      borderRadius: {
        xl: 'var(--radius)',
      },
    },
  },
};

export default config;
