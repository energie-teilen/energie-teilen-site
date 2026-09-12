import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
import { siteOrigin } from "./shared/routes";

// =============================================================================
// Energie Teilen — Vite configuration
//
// CRITICAL FIX vs. previous version:
//   ALL Manus / Builder dev tooling is now gated behind `command === "serve"`.
//   Previously `jsxLocPlugin()` and `vitePluginManusRuntime()` ran in the
//   production build too, injecting a ~385KB inline runtime into index.html
//   (110KB gzipped, render-blocking, and refused by the production CSP).
//   The production HTML is now clean: no inline executable scripts, so the
//   strict CSP in vercel.json (no 'unsafe-inline' on script-src) is honoured.
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) return;
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > TRIM_TARGET_BYTES) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => `[${new Date().toISOString()}] ${JSON.stringify(entry)}`);
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",
    apply: "serve",
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          { tag: "script", attrs: { src: "/__manus__/debug-collector.js", defer: true }, injectTo: "head" },
        ],
      };
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") return next();
        const handlePayload = (payload: any) => {
          if (payload.consoleLogs?.length > 0) writeToLogFile("browserConsole", payload.consoleLogs);
          if (payload.networkRequests?.length > 0) writeToLogFile("networkRequests", payload.networkRequests);
          if (payload.sessionEvents?.length > 0) writeToLogFile("sessionReplay", payload.sessionEvents);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try { handlePayload(reqBody); }
          catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ success: false, error: String(e) })); }
          return;
        }
        let body = "";
        req.on("data", (chunk) => { body += chunk.toString(); });
        req.on("end", () => {
          try { handlePayload(JSON.parse(body)); }
          catch (e) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(JSON.stringify({ success: false, error: String(e) })); }
        });
      });
    },
  };
}


const API_DEV_TARGET = process.env.VITE_DEV_API_TARGET || "http://localhost:3001";

/**
 * The public origin, into the two places a bundler has to put it.
 *
 * index.html is static, so it cannot call siteOrigin(): it carries
 * %SITE_ORIGIN% in its canonical link, hreflang, OpenGraph, Twitter and
 * structured data, and this replaces the token — in dev too, so what a
 * developer sees is what ships. The browser bundle has no process.env, so the
 * same value is defined as __APP_ORIGIN__ for shared/routes.ts to read.
 *
 * Both come from APP_URL through siteOrigin(), so there is one address and a
 * missing APP_URL degrades in exactly one way.
 */
function siteOriginPlugin(origin: string): Plugin {
  return {
    name: "energie-teilen:site-origin",
    transformIndexHtml: {
      order: "pre",
      handler: (html: string) => html.split("%SITE_ORIGIN%").join(origin),
    },
  };
}

export default defineConfig(({ command }) => {
  const isDev = command === "serve";

  // Dev-only tooling. NEVER shipped to production.
  const devPlugins = isDev
    ? [jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()]
    : [];

  const origin = siteOrigin();

  return {
    plugins: [react(), tailwindcss(), siteOriginPlugin(origin), ...devPlugins],

    /*
     * The client has no process.env. Without this the running application
     * would compute canonical and OpenGraph URLs from the fallback origin
     * while the generated documents used APP_URL — the two answers a crawler
     * compares.
     */
    define: {
      __APP_ORIGIN__: JSON.stringify(process.env.APP_URL ?? ""),
    },

    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "client", "src"),
        "@shared": path.resolve(import.meta.dirname, "shared"),
        "@assets": path.resolve(import.meta.dirname, "attached_assets"),
      },
    },

    envDir: path.resolve(import.meta.dirname),
    root: path.resolve(import.meta.dirname, "client"),

    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
      sourcemap: true,
      target: "es2022",
      rollupOptions: {
        output: {
          manualChunks: {
            "react-vendor": ["react", "react-dom"],
            /*
             * recharts is deliberately NOT a manual chunk. Naming it here put
             * it into the entry's preload graph, so every visitor downloaded
             * the largest bundle in the build before the first paint even
             * though the charts it draws are only reached further down the
             * page. Left to Rollup, it lands in the lazily imported chunks
             * that actually use it.
             */
            framer: ["framer-motion"],
            /* Only the primitives the surviving components actually use. */
            radix: ["@radix-ui/react-tooltip", "@radix-ui/react-slot"],
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },

    server: {
      port: 3000,
      strictPort: false,
      host: true,
      proxy: {
        "/api": { target: API_DEV_TARGET, changeOrigin: true, secure: false },
      },
      allowedHosts: [
        ".manuspre.computer", ".manus.computer", ".manus-asia.computer",
        ".manuscomputer.ai", ".manusvm.computer", "localhost", "127.0.0.1",
      ],
      fs: { strict: true, deny: ["**/.*"] },
    },

    preview: { port: 3000, strictPort: false, host: true },
  };
});
