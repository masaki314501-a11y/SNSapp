import path from "node:path";
import { defineConfig } from "vitest/config";

// tsconfig.json のパスエイリアスと合わせる(@/* → src/*, @video/* → remotion/*)。
export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@video": path.resolve(__dirname, "./remotion"),
    },
  },
});
