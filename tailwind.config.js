/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './js/**/*.js',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#FFFFFF',
          surface: '#F1F5F9',
          border: '#E2E8F0',
        },
        brand: {
          primary: '#0F0F0F',
          accent: '#0F0F0F',
        },
        score: {
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
          solid: '#0F0F0F',
        },
        content: {
          DEFAULT: '#0F172A',
          muted: '#64748B',
          subtle: '#475569',
        },
      },
      fontFamily: {
        display: ['"Syne"', 'sans-serif'],
        body: ['"DM Sans"', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-up': 'fadeUp 0.6s ease forwards',
        'spin-slow': 'spin 2s linear infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
