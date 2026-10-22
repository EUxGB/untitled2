// Simit — работа без интернета (2026-10-22; спек docs/superpowers/specs/2026-10-22-offline-design.md, навык service-worker).
// Страница приложения и списки — СНАЧАЛА СЕТЬ (новая версия приходит сразу; без сети или при сети дольше 4 с — сохранённая копия).
// Шрифты, записи носителей, озвучка, значки — СНАЧАЛА КЭШ. Номер сборки подставляет публикация (файл меняется — браузер обновляет его).
// Выключить совсем: см. «Откат» в спеке (sw.js, который снимает себя и чистит кэш).
// Ревью 2026-10-22 (отдельный агент): только своя страница (не frazy/), Range → 206 (Safari), 206 не сохраняется,
// новый audio/cv/index.json сбрасывает записи (их номера 001.mp3… раздаются заново при пересборке), сохранение — в waitUntil.
const BUILD = "__BUILD__";
const SHELL = "simit-shell", MEDIA = "simit-media";
const SHELL_URLS = ["index.html", "manifest.json", "audio/cv/index.json", "tts/manifest.json",
  "fonts/onest-latin-wght-normal.woff2", "fonts/onest-latin-ext-wght-normal.woff2", "fonts/onest-cyrillic-wght-normal.woff2",
  "icon-192.png", "icon-512.png", "icon-apple-180.png", "icon-maskable-512.png"];
const BASE = new URL("./", self.location).href;
const LISTS = ["manifest.json", "tts/manifest.json", "audio/cv/index.json"].map(u => BASE + u);

self.addEventListener("install", e => {
  // по одному файлу: нет одного (например, tts/manifest.json на тестовом сервере) — остальные всё равно сохраняются
  e.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_URLS.map(u => fetch(new Request(BASE + u, { cache:"no-cache" }))
    .then(r => r.status === 200 ? c.put(BASE + u, r) : null).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== SHELL && k !== MEDIA).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// страница приложения — только сам адрес приложения и index.html рядом с ним; frazy/… и прочие страницы сайта не трогаем
const isApp = url => url.pathname === new URL(BASE).pathname || url.href.split(/[?#]/)[0] === BASE + "index.html";
const isMedia = url => /\/(fonts|audio|tts)\//.test(url.pathname) || /\/icon-[\w-]+\.png$/.test(url.pathname);

const timeout = ms => new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms));
async function networkFirst(e, key, ms){
  const net = fetch(e.request).then(async r => {
    if(r.status === 200){
      const c = await caches.open(SHELL);
      if(key === BASE + "audio/cv/index.json"){            // список записей сменился → старые записи могли получить чужие номера
        const old = await c.match(key);
        if(old && (await old.clone().text()) !== (await r.clone().text())){
          const m = await caches.open(MEDIA);
          await Promise.all((await m.keys()).filter(q => q.url.startsWith(BASE + "audio/cv/")).map(q => m.delete(q)));
        }
      }
      await c.put(key, r.clone());
    }
    return r;
  });
  e.waitUntil(net.catch(() => null));
  try { return await (ms ? Promise.race([net, timeout(ms)]) : net); }
  catch(err){
    const hit = await caches.match(key, { ignoreSearch:true });
    if(hit) return hit;
    return net;                                             // копии нет — ждём сеть до конца
  }
}
// ответ на Range из полного файла (Safari шлёт Range для <audio> и ждёт 206)
async function ranged(resp, range){
  const buf = await resp.arrayBuffer(), n = buf.byteLength, m = /bytes=(\d*)-(\d*)/.exec(range || "");
  if(!m) return resp;
  let s = m[1] === "" ? Math.max(0, n - +m[2]) : +m[1], end = m[1] === "" || m[2] === "" ? n - 1 : Math.min(+m[2], n - 1);
  if(s >= n) return new Response(null, { status:416, headers:{ "Content-Range":`bytes */${n}` } });
  return new Response(buf.slice(s, end + 1), { status:206, headers:{ "Content-Type":resp.headers.get("Content-Type") || "audio/mpeg",
    "Content-Range":`bytes ${s}-${end}/${n}`, "Content-Length":String(end - s + 1), "Accept-Ranges":"bytes" } });
}
async function cacheFirst(e, key){
  const range = e.request.headers.get("range");
  let hit = await caches.match(key, { ignoreSearch:true });
  if(!hit){
    const r = await fetch(key);                             // целиком, без Range: 206 в кэш не кладётся
    if(r.status !== 200) return range ? fetch(e.request) : r;
    const copy = r.clone();                                 // копию — сразу: после ответа странице тело уже читается, и поздний clone() падает (найдено тестом 2026-10-22)
    e.waitUntil(caches.open(MEDIA).then(c => c.put(key, copy)).catch(() => null));
    hit = r;
  }
  return range ? ranged(hit.clone(), range) : hit;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);
  if(url.origin !== self.location.origin || !url.href.startsWith(BASE)) return;
  if(req.cache === "no-store") return;   // проверка версии («Обновить приложение», checkUpdate) — только сеть: без связи пусть честно скажет «нет связи»
  const clean = url.href.split(/[?#]/)[0];
  if(isApp(url)) e.respondWith(networkFirst(e, BASE + "index.html", req.mode === "navigate" ? 4000 : 0));
  else if(LISTS.includes(clean)) e.respondWith(networkFirst(e, clean, 0));
  else if(isMedia(url)) e.respondWith(cacheFirst(e, clean));
});
