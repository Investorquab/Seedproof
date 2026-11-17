import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const core = path.resolve(__dirname, "../../packages/core/src/index.ts");

export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer"], globals: { Buffer: true } })],
  resolve: {
    alias: { "@seedproof/core": core },
    // One copy of the SDK and CosmJS, whether imported by the app or by core.
    dedupe: ["@qorechain/sdk", "@cosmjs/proto-signing", "@cosmjs/stargate", "@cosmjs/amino", "cosmjs-types"],
  },
  server: { fs: { allow: [path.resolve(__dirname, "../..")] } },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
