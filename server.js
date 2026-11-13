/* GAKI — zero-dependency static server with live reload. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8802);
const HOST = process.env.HOST || "127.0.0.1";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

const RELOAD = `
<script>
(() => {
  try {
    const es = new EventSource('/__livereload');
    es.addEventListener('reload', () => location.reload());
  } catch (e) {}
})();
</script>
`;

function send(res, code, body, type, extra = {}) {
  res.writeHead(code, {
    "content-type": type,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    ...extra,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}`);
  let rel = decodeURIComponent(url.pathname);
  if (rel === "/__livereload") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
    res.write("retry: 800\n\n");
    watchers.add(res);
    req.on("close", () => watchers.delete(res));
    return;
  }
  if (rel === "/") rel = "/index.html";
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) return send(res, 403, "forbidden", "text/plain");
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, `404 ${rel}`, "text/plain; charset=utf-8");
    const ext = path.extname(file).toLowerCase();
    let body = buf;
    let type = MIME[ext] || "application/octet-stream";
    if (ext === ".html") {
      body = Buffer.concat([buf, Buffer.from(RELOAD)]);
    }
    send(res, 200, body, type);
  });
});

const watchers = new Set();
let timer = null;
fs.watch(ROOT, { recursive: true }, (_event, name) => {
  if (!name) return;
  if (name.includes("node_modules") || name.startsWith("shots") || name.startsWith("assets\\gen")) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    for (const res of watchers) {
      res.write(`event: reload\ndata: ${name}\n\n`);
    }
  }, 180);
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(`  Port ${PORT} is already serving — open http://${HOST}:${PORT} and leave the other window running.`);
    process.exit(0);
  }
  console.error(err.message);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`  GAKI serving ${ROOT}  ->  http://${HOST}:${PORT}`);
});
