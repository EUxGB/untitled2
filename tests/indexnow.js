// IndexNow (2026-10-16: «делай добавляй адреса»): после публикации сообщает Яндексу и Bing адреса из sitemap.xml.
// Ключ — файл indexnow-<ключ>.txt в корне сайта (публикация копирует его). Запуск в CI (задача verify): node tests/indexnow.js;
// node tests/indexnow.js --dry — только напечатать, что будет отправлено (так проверяет тест). Сбой отправки публикацию не роняет.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), HOST = 'www.simitci.ru';
const ENDPOINTS = ['https://yandex.com/indexnow', 'https://api.indexnow.org/indexnow'];
const keyFile = fs.readdirSync(ROOT).find(f => /^indexnow-[0-9a-f]{32}\.txt$/.test(f));
if(!keyFile) throw new Error('нет файла indexnow-<ключ>.txt');
const key = fs.readFileSync(path.join(ROOT, keyFile), 'utf8').trim();
const urlList = [...fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
const body = { host:HOST, key, keyLocation:'https://' + HOST + '/' + keyFile, urlList };

if(process.argv.includes('--dry')) console.log(JSON.stringify({ body, endpoints:ENDPOINTS }));
else (async () => {
  for(const url of ENDPOINTS){
    try {
      const r = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json; charset=utf-8' }, body:JSON.stringify(body), signal:AbortSignal.timeout(20000) });
      // 200 — принято, 202 — принято, ключ ещё проверяется; остальное — предупреждение в аннотации запуска
      const msg = url + ': ' + r.status + ' (' + urlList.length + ' адресов)';
      console.log(r.ok ? msg : '::warning::IndexNow ' + msg + ' ' + (await r.text()).slice(0, 200));
    } catch(e){ console.log('::warning::IndexNow ' + url + ': ' + e.message); }
  }
})();
