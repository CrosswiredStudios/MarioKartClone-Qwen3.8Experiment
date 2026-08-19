/// <reference types="vitest/config" />
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
  },
  optimizeDeps: {
    // The Havok ESM bundle locates its .wasm via `new URL(..., import.meta.url)`.
    // Vite's dep optimizer rewrites that to a non-existent .vite/deps/HavokPhysics.wasm
    // (SPA fallback serves HTML → "expected magic word 00 61 73 6d" crash). Excluding
    // the package makes Vite serve it straight from node_modules with the correct
    // application/wasm MIME type.
    exclude: ["@babylonjs/havok"],
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: ["index.html", "hf-test.html"],
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
});
