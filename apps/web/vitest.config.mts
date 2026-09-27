import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The "@/*" path alias from tsconfig.json (lib/api/auth.ts imports "@/lib/env").
    alias: { "@": dirname(fileURLToPath(import.meta.url)) },
  },
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
