import { existsSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

const configPath = existsSync("wrangler.jsonc")
  ? "wrangler.jsonc"
  : "wrangler.example.jsonc";

export default defineConfig({
  plugins: [cloudflare({ configPath }), react(), tailwindcss()]
});
