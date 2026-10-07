import { defineConfig } from "vitest/config";

// Inline postcss config stops Vite from searching parent directories for a stray postcss.config.*
export default defineConfig({ css: { postcss: { plugins: [] } }, test: { include: ["test/**/*.test.ts"] } });
