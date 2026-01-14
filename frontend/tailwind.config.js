/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          900: 'rgb(30 58 138)',
          800: 'rgb(30 64 175)',
          600: 'rgb(37 99 235)',
        },
        amber: {
          800: 'rgb(146 64 14)',
        },
        status: {
          critical: '#dc2626',
          high: '#f59e0b',
          medium: '#eab308',
          low: '#22c55e',
          pass: '#10b981',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
};
