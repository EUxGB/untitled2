// Общий каркас автотестов Söyle: счётчики, test/eq/ok, заглушки речи и микрофона, openPage с подменой сети.
// Используется tests/soyle.test.js и tests/city.test.js. Запуск файла теста: node tests/<файл> [путь к index.html]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const counts = { passed:0, failed:0 };
async function test(name, fn){
  if(process.env.ONLY && !name.includes(process.env.ONLY)) return;   // ONLY="часть названия" — прогнать выбранные тесты
  try { await fn(); counts.passed++; console.log('  ✓', name); }
  catch(e){ counts.failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const tap = (q, id) => q.evaluate(id => document.getElementById(id).click(), id);   // подвкладки тренировки скрыты вне неё — нажимаем из страницы
const eq = (a, b, msg) => { if(JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg||''} ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if(!v) throw new Error(msg || 'условие не выполнено'); };

// Заглушки: распознаватель отдаёт window.__say (или последовательность window.__seq), микрофон — тон генератора
const INIT = () => {
  window.SOYLE_TEST = true; // без случайных бонусов и окон-праздников; отдельные тесты включают их сами
  const SR = function(){ const self = this;
    this.start = () => setTimeout(() => {
      if(window.__silent){ self.onend(); return; }
      const seq = window.__seq || [window.__say || ''];
      const results = seq.map(t => { const r = [{ transcript:t, confidence:.9 }]; r.isFinal = true; return r; });
      self.onresult({ resultIndex:0, results }); self.onend();
    }, 20);
    this.stop = () => {}; this.abort = () => {};
  };
  window.SpeechRecognition = SR; window.webkitSpeechRecognition = SR;
  // журнал событий звука и микрофона: synth / rec / me / mic
  window.__log = [];
  navigator.mediaDevices.getUserMedia = async () => { window.__log.push('mic'); const c = new AudioContext(), d = c.createMediaStreamDestination(), o = c.createOscillator(); o.connect(d); o.start(); return d.stream; };
  window.SpeechSynthesisUtterance = function(t){ this.text = t; };
  window.__spoken = []; speechSynthesis.speak = u => { window.__spoken.push(u.text); window.__log.push('synth'); if(!window.__noOnEnd) setTimeout(() => u.onend && u.onend(), 10); };
  HTMLMediaElement.prototype.play = function(){
    (window.__played = window.__played || []).push(this.src);
    if(this.src.includes('broken')) return Promise.reject(new Error('load failed'));
    window.__log.push(this.src.startsWith('blob:') ? 'me' : 'rec');
    setTimeout(() => this.onended && this.onended(), 10); return Promise.resolve();
  };
};
async function openPage(browser, opts = {}){
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, userAgent: opts.android ? 'Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile' : undefined, colorScheme: opts.scheme || 'light' });
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push((e.stack || e.message).split('\n').slice(0, 3).join(' | ')));   // со стеком: видно, где упало
  // тесты не зависят от сети: всё внешнее, что не подменено ниже, отклоняется (как в CI, так и локально)
  await p.route(u => /^https?:/.test(u.href) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(u.href), r => r.abort());
  await p.route('**/*googleapis*/**', r => r.abort());
  await p.route('**/*wiktionary.org/**', r => r.fulfill({ json:{ tr:[{ partOfSpeech:'Noun', definitions:[{ definition:'<i>test</i> meaning' }] }] } }));
  await p.route('**/commons.wikimedia.org/**', r => {
    const u = decodeURIComponent(r.request().url());
    if(u.includes('categorymembers')) return r.fulfill({ json:{ query:{ pages: u.includes('Lingua') ? {
      1:{ title:'File:LL-Q256 (tur)-Zeynep-merhaba.wav', imageinfo:[{ url:'https://x/m1.wav' }] },
      2:{ title:'File:LL-Q256 (tur)-Ali-merhaba.wav', imageinfo:[{ url:'https://x/m2.wav' }] },
      3:{ title:'File:LL-Q256 (tur)-Ali-köy.wav', imageinfo:[{ url:'https://x/k.wav' }] } } : {} } } });
    const m = u.match(/"([^"]+)"$/);
    if(m && ['köy','ön'].includes(m[1])) return r.fulfill({ json:{ query:{ pages:{ 1:{ title:`File:LL-Q256 (tur)-Zeynep-${m[1]}.wav`, imageinfo:[{ url:`https://x/${m[1]}.wav` }] } } } } });
    return r.fulfill({ json:{ query:{ pages:{} } } });
  });
  await p.addInitScript(INIT);
  if(opts.storage) await p.addInitScript(s => { if(!sessionStorage.getItem('seeded')){ localStorage.clear(); Object.entries(s).forEach(([k,v]) => localStorage.setItem(k, v)); sessionStorage.setItem('seeded','1'); } }, opts.storage);
  else await p.addInitScript(() => { if(!sessionStorage.getItem('seeded')){ localStorage.clear(); sessionStorage.setItem('seeded','1'); } });
  await p.goto(FILE); await p.waitForTimeout(150);
  return p;
}

function summary(){ console.log(`\nИтог: ${counts.passed} пройдено, ${counts.failed} с ошибкой`); return counts.failed ? 1 : 0; }
module.exports = { chromium, fs, path, FILE, counts, test, tap, eq, ok, INIT, openPage, summary };
