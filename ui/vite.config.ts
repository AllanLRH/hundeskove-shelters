import { readFileSync, cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vite";

const DATA_DIR = resolve(__dirname, "../output");

/**
 * Serve `output/` at /data/ in dev, and copy it into the build.
 *
 * The pipeline writes into `output/` at the repo root, which is outside Vite's
 * project root. A symlink into `public/` would work but is awkward to commit;
 * this keeps the data where the Python side already puts it.
 */
function hundeskoveData(): Plugin {
  return {
    name: "hundeskove-data",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/data/")) return next();
        const name = req.url.slice("/data/".length).split("?")[0] ?? "";
        if (!/^[\w.-]+$/.test(name)) return next();
        const file = resolve(DATA_DIR, name);
        if (!existsSync(file)) return next();
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(readFileSync(file));
      });
    },
    closeBundle() {
      if (existsSync(DATA_DIR)) {
        cpSync(DATA_DIR, resolve(__dirname, "dist/data"), { recursive: true });
      }
    },
  };
}

export default defineConfig({ base: "./", plugins: [hundeskoveData()] });
