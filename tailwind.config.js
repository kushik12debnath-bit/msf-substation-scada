/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#070B12',
          900: '#0B0F17',
          850: '#0F1522',
          800: '#141B2B',
          700: '#1C2536',
          600: '#28324A',
          500: '#3A4664',
        },
        grid: '#1B2537',
        volt: {
          red: '#F87171',
          green: '#4ADE80',
          amber: '#FBBF24',
          cyan: '#22D3EE',
          blue: '#60A5FA',
        },
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'Consolas', 'ui-monospace', 'monospace'],
        display: ['Inter', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        flash: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.25' },
        },
        pulseRing: {
          '0%': { boxShadow: '0 0 0 0 rgba(251,191,36,0.55)' },
          '70%': { boxShadow: '0 0 0 7px rgba(251,191,36,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(251,191,36,0)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
      },
      animation: {
        flash: 'flash 1s steps(2, start) infinite',
        pulseRing: 'pulseRing 1.4s ease-out infinite',
        scan: 'scan 6s linear infinite',
      },
    },
  },
  plugins: [],
}
