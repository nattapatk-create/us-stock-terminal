/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["'IBM Plex Sans Thai'", "'IBM Plex Sans'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        zinc: {
          50: "#f6f6fb",
          100: "#eaeaf3",
          200: "#cfd0e2",
          300: "#a6a8c4",
          400: "#7d7fa1",
          500: "#5c5e80",
          600: "#454764",
          700: "#31324a",
          800: "#1e1f33",
          900: "#141526",
          950: "#0a0a17",
        },
        blue: {
          50: "#eef1ff",
          100: "#e0e4ff",
          200: "#c5cbfe",
          300: "#a2a9fc",
          400: "#8087f8",
          500: "#6366f1",
          600: "#4f4de5",
          700: "#423fc9",
          800: "#3735a2",
          900: "#302f80",
          950: "#1c1b4d",
        },
      },
    },
  },
  plugins: [],
};
