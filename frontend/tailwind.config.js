/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#000000',
        'bg-card': '#080808',
        'bg-card-hover': '#0f0f0f',
        'bg-input': '#050505',
        'surface': '#000000',
        'surface-lighter': '#0a0a0a',
        border: 'rgba(255,255,255,0.05)',
        'border-focus': '#5eead4',
        text: '#f1f5f9',
        'text-muted': '#94a3b8',
        'text-dim': '#475569',
        accent: '#5eead4',
        'accent-glow': 'rgba(94,234,212,0.15)',
        'accent-2': '#2dd4bf',
        'accent-3': '#0f766e',
        danger: '#f87171',
        warning: '#fbbf24',
        success: '#4ade80',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        'DEFAULT': '0.375rem',
        'lg': '0.5rem',
        'xl': '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        'full': '9999px',
      },
      boxShadow: {
        'glow-sm': '0 0 15px -5px rgba(94, 234, 212, 0.15)',
        'glow': '0 0 30px -10px rgba(94, 234, 212, 0.2)',
        'glow-lg': '0 0 60px -15px rgba(94, 234, 212, 0.25)',
        'inner-glow': 'inset 0 0 20px -8px rgba(94, 234, 212, 0.1)',
      },
      animation: {
        'shimmer': 'shimmer 2s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
        'slide-up': 'slide-up 0.4s ease-out',
        'fade-in': 'fade-in 0.3s ease-out',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '-200% center' },
          '100%': { backgroundPosition: '200% center' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'glow-pulse': {
          '0%, 100%': { opacity: '0.5', filter: 'blur(40px)' },
          '50%': { opacity: '0.8', filter: 'blur(50px)' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'accent-gradient': 'linear-gradient(135deg, #5eead4 0%, #2dd4bf 50%, #0f766e 100%)',
      },
    },
  },
  plugins: [],
}
