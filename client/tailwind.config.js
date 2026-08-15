/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#09090B',
        surface: '#111113',
        elevated: '#18181B',
        primary: '#3B82F6',
        secondary: '#8B5CF6',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
        textPrimary: '#F8FAFC',
        textSecondary: '#94A3B8',
        borderMuted: '#27272A',
      }
    },
  },
  plugins: [],
}