import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    allowedHosts: ["edinburgh-assistance-noon-enzyme.trycloudflare.com"],
    watch: {
      usePolling: true,
    },
  },
});