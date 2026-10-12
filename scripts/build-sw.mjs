import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "apps/web/dist";
async function files(dir) {
  const entries = await readdir(root + dir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) out.push(...(await files(p)));
    else if (!p.endsWith("/sw.js")) out.push(p);
  }
  return out;
}
const paths = await files("");
const hash = createHash("sha256");
for (const p of paths) hash.update(await readFile(root + p));
const cache = "eoms-shell-" + hash.digest("hex").slice(0, 16);
await writeFile(
  root + "/sw.js",
  `const CACHE=${JSON.stringify(cache)},ASSETS=${JSON.stringify(paths)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('eoms-shell-')&&key!==CACHE)await caches.delete(key);await self.clients.claim()})()));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/'))return;if(event.request.mode==='navigate'){event.respondWith(caches.open(CACHE).then(cache=>cache.match('/index.html')));return}if(ASSETS.includes(url.pathname))event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(url.pathname))||fetch(event.request)))});
`,
);
console.log("Generated versioned PWA shell; API responses excluded.");
