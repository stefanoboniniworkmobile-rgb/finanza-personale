import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0a2540",
        ink2: "#425466",
        sub: "#697386",
        line: "#e3e8ee",
        line2: "#eef0f4",
        bg: "#f6f9fc",
        brand: {
          50: "#f4f5ff",
          100: "#ebebff",
          200: "#d6d4ff",
          500: "#635bff",
          600: "#5b54ee",
          700: "#4f48d4",
        },
        ok: {
          50: "#e6f7ee",
          100: "#cdedd9",
          500: "#00a663",
          600: "#008a52",
          700: "#0a7a48",
        },
        warn: {
          50: "#fff4e0",
          100: "#fde8c4",
          500: "#f59e0b",
          600: "#bf6a02",
          700: "#9a5602",
        },
        err: {
          50: "#fde8ec",
          100: "#fcd0d8",
          500: "#df1b41",
          600: "#c01536",
          700: "#9a0f29",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
} satisfies Config;
