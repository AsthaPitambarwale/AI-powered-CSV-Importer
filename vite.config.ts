import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Resolve imports like:
// import logo from "GrowEasy:asset/logo.svg"
function GrowEasyAssetResolver() {
  return {
    name: "groweasy-asset-resolver",

    resolveId(id: string) {
      if (id.startsWith("GrowEasy:asset/")) {
        const filename = id.replace("GrowEasy:asset/", "");

        return path.resolve(
          __dirname,
          "src",
          "assets",
          filename
        );
      }

      return null;
    },
  };
}

export default defineConfig({
  plugins: [
    GrowEasyAssetResolver(),
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },

  // Allow importing CSV/SVG files
  assetsInclude: [
    "**/*.csv",
    "**/*.svg",
  ],

  server: {
    port: 5173,
    open: true,
  },

  preview: {
    port: 4173,
  },

  build: {
    outDir: "dist",
    sourcemap: false,
  },
});