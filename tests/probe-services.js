// Проверка внешних сервисов из CI (из среды разработки они закрыты): отвечают ли, какие поля, есть ли CORS.
// Результат — probe.json в ветке screens.
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2] || 'shots';
const H = { 'Origin':'https://euxgb.github.io' };
async function get(url){
  try { const r = await fetch(url, { headers:H }); const t = await r.text();
    return { url, status:r.status, cors:r.headers.get('access-control-allow-origin'), type:r.headers.get('content-type'), body: (r.headers.get('content-type')||'').includes('json') || (r.headers.get('content-type')||'').includes('javascript') ? t.slice(0, 2500) : ('двоичные данные, байт: ' + t.length) };
  } catch(e){ return { url, error:String(e) }; }
}
(async () => {
  const q = encodeURIComponent;
  const urls = [
    'https://api.tatoeba.org/v1/sentences?lang=tur&has_audio=yes&limit=3',
    'https://api.tatoeba.org/v1/sentences?lang=tur&has_audio=yes&limit=3&include=audios',
    `https://api.tatoeba.org/v1/sentences?lang=tur&has_audio=yes&q=${q('teşekkür')}&limit=3&showtrans=rus`,
    'https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&limit=2',
    'https://api.tatoeba.org/unstable/audios?lang=tur&limit=2',
    `https://api.mymemory.translated.net/get?q=${q('Hesabı alabilir miyim?')}&langpair=tr|ru`,
    'https://youglish.com/public/emb/widget.js',
    'https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&sort=random&limit=2&showtrans=rus',
    'https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&sort=random&limit=2&include=audios',
    `https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&sort=relevance&limit=3&q=${q('Teşekkür ederim')}`,
    `https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&sort=words&limit=3&trans:lang=rus&showtrans=rus`,
    'https://api.tatoeba.org/unstable/audio/66596/file',
  ];
  urls.push(
    'https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&sort=words&limit=5&trans:lang=rus&showtrans=matching&showtrans:lang=rus&include=audios',
    'https://api.tatoeba.org/v1/audios/1161844/file', 'https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&trans:lang=rus&showtrans:lang=rus&include=audios&sort=random&limit=2');
  const res = []; for(const u of urls) res.push(await get(u));
  // сколько фраз тренажёра есть в Tatoeba целиком с записью носителя
  const b0 = await chromium.launch(); const p0 = await b0.newPage(); await p0.addInitScript(() => { window.SOYLE_TEST = true; });
  await p0.goto('file://' + require('path').resolve(__dirname, '..', 'index.html'));
  const phrases = await p0.evaluate(() => PHRASE_SETS.flatMap(g => g.items.map(i => i.tr))); await b0.close();
  const norm = t => t.toLocaleLowerCase('tr').replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const found = [];
  for(const ph of phrases){
    try { const r = await fetch(`https://api.tatoeba.org/unstable/sentences?lang=tur&has_audio=yes&sort=relevance&limit=5&include=audios&q=${q(ph)}`); const d = await r.json();
      const hit = (d.data || []).find(x => norm(x.text) === norm(ph)); if(hit) found.push({ ph, id: hit.id, audio: hit.audios && hit.audios[0] && hit.audios[0].download_url, author: hit.audios && hit.audios[0] && hit.audios[0].author, license: hit.audios && hit.audios[0] && hit.audios[0].license });
    } catch(e){}
    await new Promise(z => setTimeout(z, 150));
  }
  res.push({ tatoebaExact: { phrases: phrases.length, found: found.length, list: found } });
  // аудио: первый download_url из ответов
  const m = JSON.stringify(res).match(/https?:[^"\\]*audios[^"\\]*file[^"\\]*/);
  if(m) res.push(await get(m[0]).then(r => ({ ...r, body: r.body && r.body.length + ' bytes (обрезано)' })));
  // YouGlish виджет в настоящем браузере
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<div id="yg"></div>');
  const yg = await p.evaluate(() => new Promise(done => {
    const t = setTimeout(() => done({ ok:false, why:'timeout', html: document.getElementById('yg').innerHTML.slice(0, 500) }), 20000);
    window.onYouglishAPIReady = () => { try {
      const w = new YG.Widget('yg', { width:360, components:9, events:{ onFetchDone: e => { clearTimeout(t); done({ ok:true, fetch:e, html: document.getElementById('yg').innerHTML.slice(0, 300) }); }, onError: e => { clearTimeout(t); done({ ok:false, error:e }); } } });
      w.fetch('teşekkür ederim', 'turkish');
    } catch(e){ clearTimeout(t); done({ ok:false, error:String(e) }); } };
    const s = document.createElement('script'); s.src = 'https://youglish.com/public/emb/widget.js'; document.head.appendChild(s);
  }));
  res.push({ youglishWidget: yg });
  await p.screenshot({ path:`${OUT}/probe-youglish.png` });
  await b.close();
  fs.mkdirSync(OUT, { recursive:true });
  fs.writeFileSync(`${OUT}/probe.json`, JSON.stringify(res, null, 2));
  console.log(JSON.stringify(res, null, 2).slice(0, 4000));
})();
