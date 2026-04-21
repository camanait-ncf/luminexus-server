/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.{html,js}"
  ],
  theme: {
    extend: {
      colors: {
        // Custom cyberpunk theme colors
        luminex: {
          bg: '#050a0f',
          panel: '#0a1520',
          border: '#0ff3',
          cyan: '#00f5ff',
          green: '#00ff88',
          orange: '#ff6b00',
          red: '#ff2244',
          body: '#fffde0',
          text: '#cce8ef',
          dim: '#4a7a8a',
          yellow: '#ffe040',
          purple: '#c084fc',
        }
      },
      fontFamily: {
        tech: ['Share Tech Mono', 'monospace'],
        orbitron: ['Orbitron', 'sans-serif'],
      },
      fontSize: {
        xs: '0.58rem',
        sm: '0.65rem',
        base: '0.85rem',
        lg: '1rem',
        xl: '1.5rem',
      }
    },
  },
  plugins: [],
}
