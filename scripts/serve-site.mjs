// Minimal static server for website/ (no Vite: a second Vite instance would share and
// clobber the app's dependency cache in node_modules/.vite, leaving the app window blank).
// Usage: npm run site:serve   ->  http://localhost:4321
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const root = join(import.meta.dirname, "..", "website");
const port = Number(process.env.PORT) || 4321;
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".exe": "application/octet-stream",
  ".msi": "application/octet-stream",
};

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = normalize(join(root, path));
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
    const size = statSync(file).size;
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream", "Content-Length": size, "Cache-Control": "no-cache" });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(port, () => console.log(`Aktobly website: http://localhost:${port}`));
