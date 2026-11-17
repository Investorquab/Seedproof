import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { nodePolyfills } from "vite-plugin-node-polyfills";

const proxy = {
  "/qore-rest": { target: "https://api-testnet.qore.host", changeOrigin: true, rewrite: (p: string) => p.replace(/^\/qore-rest/, "") },
};

const core = path.resolve(__dirname, "../../packages/core/src/index.ts");

export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer"], globals: { Buffer: true } })],
  resolve: {
    alias: { "@seedproof/core": core },
    // One copy of the SDK and CosmJS, whether imported by the app or by core.
    dedupe: ["@qorechain/qoreseal", "viem", "@qorechain/sdk", "@cosmjs/proto-signing", "@cosmjs/stargate", "@cosmjs/amino", "cosmjs-types"],
  },
  // The testnet REST API sends no CORS headers, so the browser calls /qore-rest on its own origin
  // and this proxy (or the host's rewrite, see vercel.json) forwards it.
  server: { fs: { allow: [path.resolve(__dirname, "../..")] }, proxy },
  preview: { proxy },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
});
