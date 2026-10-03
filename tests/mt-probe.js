// Проверка машинного перевода (MyMemory — тот же сервис, что в приложении) на материале, перевод которого выверен вручную:
// целые фразы, отдельные слова в словарной форме и отдельные словоформы из фраз. Результат — mt.json (ветка mt-probe),
// сравнивается глазами: где машина ошиблась. Бесплатный предел MyMemory — 5000 знаков в день с одного адреса, поэтому выборка.
const fs = require('fs'), path = require('path');
const OUT = process.argv[2] || 'mtout';
const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const vp = JSON.parse(fs.readFileSync(path.join(__dirname, 'voiced-phrases.json'), 'utf8'));
const phrases = Object.values(vp).flat().filter(p => !p.rare).filter((_, i) => i % 2 === 0).map(p => ({ tr: p.tr, mine: p.ru }));
const seedBlock = (src.match(/const WORD_SEEDS = \{([\s\S]*?)\};/) || [])[1] || '';
const words = [...seedBlock.matchAll(/\["([^"]+)","([^"]+)"\]/g)].map(m => ({ tr: m[1], mine: m[2] })).filter((_, i) => i % 2 === 0);
const dictBlock = (src.match(/const PHRASE_DICT = \{([\s\S]*?)\n\};/) || [])[1] || '';
const forms = [];
[...dictBlock.matchAll(/"([^"]+)":\["([^"]+)", "([^"]+)"\]/g)].forEach(m => m[3].split(' ').forEach(f => { if(f !== m[1].toLocaleLowerCase('tr-TR')) forms.push({ tr: f, lemma: m[1], mine: m[2] }); }));
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function mt(text){
  const r = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=tr|ru`, { signal: AbortSignal.timeout(15000) });
  const j = await r.json(), t = String(j.responseData && j.responseData.translatedText || '');
  if(r.status === 429 || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) throw new Error('quota: ' + t.slice(0, 80));
  return { mt: t, match: j.responseData && j.responseData.match };
}
(async () => {
  const res = { when: new Date().toISOString(), service: 'api.mymemory.translated.net tr|ru', chars: 0, stopped: '', phrases: [], words: [], forms: [] };
  const run = async (list, key) => { for(const x of list){ if(res.stopped) return; try { Object.assign(x, await mt(x.tr)); res.chars += x.tr.length; res[key].push(x); } catch(e){ if(/quota/.test(e.message)) res.stopped = e.message; else res[key].push({ ...x, err: String(e.message).slice(0, 60) }); } await sleep(250); } };
  await run(phrases, 'phrases'); await run(words, 'words'); await run(forms.filter((_, i) => i % 2 === 0), 'forms');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'mt.json'), JSON.stringify(res, null, 1));
  console.log('фраз', res.phrases.length, 'слов', res.words.length, 'словоформ', res.forms.length, 'знаков', res.chars, res.stopped);
})();
