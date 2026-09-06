/**
 * scripts/dev-kv.mjs — DEVELOPMENT ONLY. NEVER RUN THIS IN PRODUCTION.
 *
 * A minimal, in-memory, Upstash-REST-compatible KV so the order ledger can be
 * exercised end to end locally without provisioning anything. Data lives in
 * process memory and is gone when you stop it.
 *
 * Implements only what the ledger and rate limiter use:
 *   SET (with NX/EX), GET, MGET, INCR, PEXPIRE, LPUSH, ZADD, ZRANGE (REV).
 *
 * Usage:
 *   node scripts/dev-kv.mjs &
 *   UPSTASH_REDIS_REST_URL=http://localhost:7788 \
 *   UPSTASH_REDIS_REST_TOKEN=dev \
 *   ADMIN_API_TOKEN=$(openssl rand -hex 32) \
 *   NODE_ENV=production node dist/index.js
 */
import http from "node:http";

const store = new Map();   // key -> string
const zsets = new Map();   // key -> Map(member -> score)

function run(cmd) {
  const name = String(cmd[0] || "").toLowerCase();
  const a = cmd.slice(1);
  switch (name) {
    case "set": {
      const [key, value, ...opts] = a;
      const flat = opts.map((o) => String(o).toLowerCase());
      if (flat.includes("nx") && store.has(key)) return null;
      store.set(key, String(value));
      return "OK";
    }
    case "get": return store.has(a[0]) ? store.get(a[0]) : null;
    case "mget": return a.map((k) => (store.has(k) ? store.get(k) : null));
    case "incr": {
      const n = Number(store.get(a[0]) || 0) + 1;
      store.set(a[0], String(n));
      return n;
    }
    case "pexpire": case "expire": return 1;
    case "lpush": return 1;
    case "zadd": {
      const key = a[0];
      if (!zsets.has(key)) zsets.set(key, new Map());
      const z = zsets.get(key);
      const rest = a.slice(1).filter((x) => !["nx","xx","gt","lt","ch","incr"].includes(String(x).toLowerCase()));
      for (let i = 0; i + 1 < rest.length; i += 2) z.set(String(rest[i + 1]), Number(rest[i]));
      return 1;
    }
    case "zrange": {
      const [key, start, stop, ...opts] = a;
      const rev = opts.map((o) => String(o).toLowerCase()).includes("rev");
      const z = zsets.get(key) || new Map();
      let members = [...z.entries()].sort((x, y) => x[1] - y[1]).map((e) => e[0]);
      if (rev) members.reverse();
      const s = Number(start), e = Number(stop);
      return members.slice(s, e < 0 ? undefined : e + 1);
    }
    default: return null;
  }
}

http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let out;
    try {
      const path = req.url.split("?")[0].split("/").filter(Boolean).map(decodeURIComponent);
      let parsed = null;
      if (body) { try { parsed = JSON.parse(body); } catch { parsed = null; } }

      if (path[0] === "pipeline" || path[0] === "multi-exec") {
        out = (parsed || []).map((c) => ({ result: run(c) }));
      } else if (Array.isArray(parsed) && parsed.length && Array.isArray(parsed[0])) {
        out = parsed.map((c) => ({ result: run(c) }));
      } else if (Array.isArray(parsed) && parsed.length) {
        out = { result: run(parsed) };
      } else if (path.length) {
        // path style: /set/key/value  (+ JSON body as the value when present)
        const cmd = [...path];
        if (parsed !== null && !Array.isArray(parsed)) cmd.push(JSON.stringify(parsed));
        else if (body && parsed === null) cmd.push(body);
        out = { result: run(cmd) };
      } else out = { result: null };
    } catch (e) {
      out = { error: String(e) };
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  });
}).listen(7788, () => console.log("fake-kv on 7788"));
