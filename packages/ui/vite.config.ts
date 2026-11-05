import { defineConfig } from "vite";

// Mantine marks its modules "use client" for React Server Components; a browser bundle has no use for the directive.
export default defineConfig({
  build: {
    rolldownOptions: {
      onwarn: (warning, warn) => {
        if (warning.code !== "MODULE_LEVEL_DIRECTIVE") warn(warning);
      },
    },
  },
});
