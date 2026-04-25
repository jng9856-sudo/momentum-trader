import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-mono)', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      colors: {
        bg: {
          base:  '#09090b',
          card:  '#111115',
          hover: '#18181b',
        },
        border: {
          DEFAULT: '#27272a',
          subtle:  '#1c1c1f',
        },
        signal: {
          buy:  '#10b981',
          sell: '#ef4444',
          hold: '#f59e0b',
        },
      },
    },
  },
  plugins: [],
};
export default config;
