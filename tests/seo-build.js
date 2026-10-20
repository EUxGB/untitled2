// Страницы ситуаций для поиска (2026-10-12: «Мне нравится, делай»; навыки programmatic-seo, ai-seo, schema).
// Собирает из данных приложения (index.html: PHRASE_SETS, trToCyr, localNative) лёгкие страницы frazy/<тема>/,
// общую frazy/, llms.txt и sitemap.xml. Только фразы с записью живого носителя. Запуск: node tests/seo-build.js
// Тест «страницы ситуаций для поиска» сверяет файлы с этой сборкой — после правки фраз запустить скрипт и закоммитить.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), SITE = 'https://www.simitci.ru/';
// адрес = id темы в приложении (адрес не меняется при переименовании темы); тексты — вручную
const TOPICS = [
  { id:'basic', slug:'osnovnye', h1:'Основные фразы на турецком', short:'Основные', lead:'Фразы на каждый день: просьбы, благодарность, «не понимаю», «повторите, пожалуйста».' },
  { id:'greet', slug:'privetstviya', h1:'Приветствия на турецком', short:'Приветствия', lead:'Как поздороваться, попрощаться и ответить на «как дела?» — вежливо и по-дружески.' },
  { id:'hotel', slug:'v-otele', h1:'В отеле: фразы на турецком', short:'В отеле', lead:'Заселение, номер, завтрак и просьбы на ресепшене.' },
  { id:'food', slug:'v-kafe', h1:'В кафе и ресторане: фразы на турецком', short:'В кафе', lead:'Заказать, попросить счёт, спросить, что в блюде.' },
  { id:'transport', slug:'v-transporte', h1:'В транспорте и такси: фразы на турецком', short:'В транспорте', lead:'Такси, автобус, метро, долмуш: куда ехать, сколько стоит, где выйти.' },
  { id:'shop', slug:'v-magazine', h1:'В магазине и на базаре: фразы на турецком', short:'В магазине', lead:'Спросить цену, примерить, поторговаться, заплатить картой.' },
  { id:'health', slug:'u-vracha', h1:'У врача и в аптеке: фразы на турецком', short:'У врача', lead:'Что болит, температура, аллергия, вызвать врача.' },
  { id:'talk', slug:'razgovor', h1:'Разговор: фразы на турецком для общения', short:'Разговор', lead:'Познакомиться, поддержать беседу, рассказать о себе.' },
  { id:'sos', slug:'ekstrennye', h1:'Экстренные фразы на турецком', short:'Экстренные', lead:'Позвать на помощь, вызвать полицию или скорую, сказать, что потерялись.' },
];
const DATE_RE = /<!--d-->[^<]*<!--\/d-->|"dateModified":"[^"]*"|<lastmod>[^<]*<\/lastmod>/g;
const strip = s => s.replace(DATE_RE, '§');   // сравнение без дат: дата меняется, только когда меняется содержимое
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const pl = (n, a, b, c) => { const m = n % 10, h = n % 100; return `${n} ${m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c}`; };
const phr = n => pl(n, 'фраза', 'фразы', 'фраз');
const ruDate = d => { const [y, m, dd] = d.split('-'); return `${+dd} ${['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'][m - 1]} ${y}`; };
const splitRu = ru => { const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(ru); if(!m) return [ru, '']; let n = m[2].trim(); n = n[0].toLocaleUpperCase('ru') + n.slice(1); return [m[1], /[.!?»]$/.test(n) ? n : n + '.']; };

async function data(browser){
  const { openPage } = require('./harness');
  const q = await openPage(browser);
  const cv = JSON.parse(fs.readFileSync(path.join(ROOT, 'audio', 'cv', 'index.json'), 'utf8')).phrases;   // в file:// приложение не может сам прочитать индекс записей
  const r = await q.evaluate(cv => { CV_INDEX = cv; return { nGram:GRAMMAR.length, sets:PHRASE_SETS.map(g => ({ id:g.id, label:g.label, items:g.items.filter(x => !x.rare).map(x => ({ tr:x.tr, ru:x.ru, cyr:trToCyr(x.tr), rec:(localNative(x.tr)[0] || {}).url || '' })).filter(x => x.rec) })) }; }, cv);
  await q.context().close(); return r;
}

const CSS = `@font-face{font-family:'Simit Sans'; font-weight:100 900; font-display:swap; src:url(__R__fonts/onest-latin-wght-normal.woff2) format('woff2'); unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:'Simit Sans'; font-weight:100 900; font-display:swap; src:url(__R__fonts/onest-latin-ext-wght-normal.woff2) format('woff2'); unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Simit Sans'; font-weight:100 900; font-display:swap; src:url(__R__fonts/onest-cyrillic-wght-normal.woff2) format('woff2'); unicode-range:U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116}
:root{--bg:#F2F5F6; --surface:#FFFFFF; --line:#DDE5E7; --ink:#12262B; --ink-2:#3A4F54; --muted:#4E6468;
  --accent:#0F7C74; --accent-ink:#0A5E58; --accent-soft:#E8F4F2; --on-accent:#FFFFFF;
  --display:"Simit Sans",system-ui,-apple-system,"Segoe UI",sans-serif; --body:"Simit Sans",system-ui,-apple-system,"Segoe UI",sans-serif; color-scheme:light}
@media (prefers-color-scheme: dark){:root{--bg:#0E1719; --surface:#162124; --line:#2A3B3F; --ink:#E4EDEB; --ink-2:#BCCBCA; --muted:#98ACAD;
  --accent:#5DB3AA; --accent-ink:#8ED3CB; --accent-soft:#16332F; --on-accent:#0E1719; color-scheme:dark}}
*{box-sizing:border-box}
body{margin:0; background:var(--bg); color:var(--ink); font:16px/1.5 var(--body); -webkit-text-size-adjust:100%}
.wrap{max-width:680px; margin:0 auto; padding:16px 16px 48px}
header{display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:48px}
.brand{font:700 24px var(--display); letter-spacing:-.02em; color:var(--ink); text-decoration:none; display:inline-flex; align-items:center; min-height:44px}
.open{display:inline-flex; align-items:center; min-height:44px; padding:0 16px; border-radius:22px; background:var(--accent); color:var(--on-accent); font-weight:700; font-size:14px; text-decoration:none}
.crumbs{font-size:13px; color:var(--muted); margin:4px 0 18px} .crumbs a{color:var(--accent-ink)}
h1{font:700 clamp(26px,7vw,34px)/1.15 var(--display); margin:0 0 10px}
.lead{color:var(--ink-2); margin:0 0 6px} .upd{font-size:13px; color:var(--muted); margin:0 0 20px}
h2{font:700 21px/1.25 var(--display); margin:30px 0 10px}
.list{list-style:none; margin:0; padding:0 16px; display:flex; flex-direction:column; background:var(--surface); border-radius:18px}
.ph{display:flex; gap:12px; align-items:flex-start; padding:14px 0; border-bottom:1px solid var(--line)} .ph:last-child{border-bottom:0}
.play{flex:none; width:44px; height:44px; border-radius:50%; border:0; background:var(--accent-soft); color:var(--accent); display:grid; place-items:center; cursor:pointer; touch-action:manipulation}
.play svg{width:20px; height:20px; fill:currentColor} .play.on{background:var(--accent); color:var(--on-accent)}
.play:focus-visible,.open:focus-visible,.cta a:focus-visible,.topic:focus-visible,summary:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
.ph-t p{margin:0} .tr{font:700 19px/1.3 var(--display)} .rd{font-size:14px; color:var(--muted)} .ru{margin-top:2px !important} .nt{font-size:13px; color:var(--ink-2); margin-top:4px !important}
.cta{margin:22px 0 0; background:var(--accent-soft); border-radius:18px; padding:16px} .cta p{margin:0 0 12px}
.cta a{display:flex; justify-content:center; align-items:center; min-height:52px; padding:0 20px; border-radius:16px; background:var(--accent); color:var(--on-accent); font-weight:700; text-decoration:none}
.faq{background:var(--surface); border-radius:18px; padding:0 16px}
details{border-bottom:1px solid var(--line)} details:last-child{border-bottom:0}
summary{cursor:pointer; display:flex; align-items:center; gap:12px; min-height:48px; padding:12px 0; font-weight:600; list-style:none}
summary::-webkit-details-marker{display:none}
summary::after{content:""; flex:none; margin-left:auto; width:7px; height:7px; border:0 solid var(--muted); border-width:0 2px 2px 0; transform:translateY(-2px) rotate(45deg)} details[open] summary::after{transform:translateY(2px) rotate(-135deg)}
details p{margin:0; padding:0 0 14px; color:var(--ink-2)}
.next{display:flex; flex-wrap:wrap; gap:8px} .next a{display:inline-flex; align-items:center; min-height:44px; padding:0 14px; border:1px solid var(--line); border-radius:22px; font-size:14px; font-weight:600; color:var(--ink); text-decoration:none; background:var(--surface)}
.topics{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px}
.topic{display:grid; grid-template-columns:minmax(0,1fr) auto 8px; column-gap:10px; align-items:center; background:var(--surface); border:0; border-radius:16px; padding:14px 16px; color:var(--ink); text-decoration:none}
.topic b{grid-column:1; grid-row:1; font:700 18px/1.3 var(--display)} .topic span{grid-column:2; grid-row:1 / span 2; font-size:13px; color:var(--muted); white-space:nowrap} .topic i{grid-column:1; grid-row:2; font-style:normal; font-size:14px; color:var(--accent-ink); margin-top:2px; overflow-wrap:anywhere}
.topic::after{content:""; grid-column:3; grid-row:1 / span 2; width:7px; height:7px; border:0 solid var(--muted); border-width:2px 2px 0 0; transform:rotate(45deg); margin-left:-2px}
footer{margin-top:32px; font-size:12px; color:var(--muted)}`;
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>';
const JS = `<script>
const au = new Audio(); let cur = null;
document.querySelectorAll('.play').forEach(b => b.addEventListener('click', () => {
  if(cur === b && !au.paused){ au.pause(); b.classList.remove('on'); cur = null; return; }
  if(cur) cur.classList.remove('on'); cur = b; b.classList.add('on'); au.src = b.dataset.src; au.play().catch(() => b.classList.remove('on'));
}));
au.addEventListener('ended', () => { if(cur) cur.classList.remove('on'); cur = null; });
</script>`;
const FAQ = [
  ['Откуда записи?', 'Это живые носители турецкого из открытых проектов Mozilla Common Voice (лицензия CC0) и Tatoeba, а не синтезатор речи.'],
  ['Как читать «ğ» и «ı»?', '«ğ» не произносится, а тянет гласную перед ней: «ağrıyor» звучит как «аарыйор». «ı» — это «ы»: «kız» — «кыз».'],
  ['Как проверить своё произношение?', 'Нажмите «Произнести и проверить»: Simit послушает фразу, поставит оценку от 0 до 100 и покажет, какой звук не получился (например, «c» вместо «ç»).'],
  ['Это бесплатно?', 'Да. Регистрация не нужна, прогресс хранится на вашем телефоне.'],
];
const faqHtml = list => `    <div class="faq">\n` + list.map(([q, a]) => `    <details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('\n') + `\n    </div>`;
const page = ({ R, title, desc, canon, ld, body }) => `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canon}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${canon}"><meta property="og:image" content="${SITE}icon-512.png">
<meta name="theme-color" content="#F2F5F6">
<link rel="icon" href="${R}icon-192.png">
<link rel="preload" href="${R}fonts/onest-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<style>
${CSS.replace(/__R__/g, R)}
</style>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</head>
<body>
<div class="wrap">
${body}
</div>
${JS}
</body>
</html>
`;

function render({ sets, nGram }, dates){
  const out = {}, today = new Date().toISOString().slice(0, 10), date = f => dates[f] || today;
  const bySet = Object.fromEntries(sets.map(s => [s.id, s]));
  const T = TOPICS.filter(t => bySet[t.id] && bySet[t.id].items.length);
  for(const t of T){
    const f = `frazy/${t.slug}/index.html`, R = '../../', canon = `${SITE}frazy/${t.slug}/`, items = bySet[t.id].items, d = date(f);
    const li = items.map(x => { const [ru, nt] = splitRu(x.ru), src = /^https?:/.test(x.rec) ? x.rec : R + x.rec;
      return `      <li class="ph">
        <button class="play" type="button" data-src="${esc(src)}" aria-label="Послушать: ${esc(x.tr)}">${PLAY}</button>
        <div class="ph-t">
          <p class="tr" lang="tr" translate="no">${esc(x.tr)}</p>
          <p class="rd">${esc(x.cyr)}</p>
          <p class="ru">${esc(ru)}</p>${nt ? `\n          <p class="nt">${esc(nt)}</p>` : ''}
        </div>
      </li>`; }).join('\n');
    const others = T.filter(o => o !== t).map(o => `<a href="../${o.slug}/">${esc(o.short)}</a>`).join('');
    const title = `${t.short}: турецкие фразы с голосом носителя | Simit`;   // ≤ 60 знаков (seo-audit, title-tags.md)
    const desc = `${t.lead} ${phr(items.length)}: перевод, чтение русскими буквами и запись живого носителя. Произнесите сами — Simit оценит произношение.`;
    const ld = [{ '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[
        { '@type':'ListItem', position:1, name:'Simit', item:SITE }, { '@type':'ListItem', position:2, name:'Фразы', item:SITE + 'frazy/' }, { '@type':'ListItem', position:3, name:t.short } ] },
      { '@context':'https://schema.org', '@type':'LearningResource', name:t.h1, inLanguage:'ru', teaches:'Турецкие фразы: ' + bySet[t.id].label, educationalLevel:'Начальный', isAccessibleForFree:true, url:canon, dateModified:d }];
    out[f] = page({ R, title, desc, canon, ld, body:`  <header><a class="brand" href="${R}">Simit</a><a class="open" href="${R}#phrases=${t.id}">Открыть тренажёр</a></header>
  <nav class="crumbs" aria-label="Навигация"><a href="${R}">Simit</a> › <a href="../">Фразы</a> › ${esc(t.short)}</nav>
  <main>
    <h1>${esc(t.h1)}</h1>
    <p class="lead">${esc(t.lead)} У каждой фразы — перевод, чтение русскими буквами и запись живого носителя.</p>
    <p class="upd">Обновлено <!--d-->${ruDate(d)}<!--/d--> · ${phr(items.length)}</p>
    <ul class="list">
${li}
    </ul>
    <div class="cta"><p><b>Скажите это сами.</b> Simit послушает и покажет, какой звук не получился (например, «c» вместо «ç»).</p><a href="${R}#phrases=${t.id}">Произнести и проверить</a></div>
    <h2>Вопросы</h2>
${faqHtml(FAQ.slice(0, 3))}
    <h2>Другие ситуации</h2>
    <nav class="next" aria-label="Другие ситуации">${others}</nav>
  </main>
  <footer>Записи: Mozilla Common Voice (CC0), Tatoeba. Переводы проверены вручную.</footer>` });
  }
  // общая страница
  { const f = 'frazy/index.html', R = '../', canon = SITE + 'frazy/', d = date(f), total = T.reduce((a, t) => a + bySet[t.id].items.length, 0);
    const li = T.map(t => { const it = bySet[t.id].items; return `      <li><a class="topic" href="${t.slug}/"><b>${esc(t.h1.replace(/: фразы на турецком.*$| на турецком.*$/, ''))}</b><span>${phr(it.length)}</span><i lang="tr" translate="no">${esc(it.slice(0, 2).map(x => x.tr).join(' · '))}</i></a></li>`; }).join('\n');
    const title = `Турецкие фразы с голосом носителя — ${phr(total)} по ситуациям | Simit`;
    const desc = `Разговорник турецкого с записями живых носителей: ${phr(total)} в отеле, кафе, такси, магазине, у врача. Перевод, чтение русскими буквами и проверка произношения.`;
    const ld = [{ '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[{ '@type':'ListItem', position:1, name:'Simit', item:SITE }, { '@type':'ListItem', position:2, name:'Фразы' }] },
      { '@context':'https://schema.org', '@type':'CollectionPage', name:'Турецкие фразы с голосом носителя', inLanguage:'ru', url:canon, dateModified:d }];
    out[f] = page({ R, title, desc, canon, ld, body:`  <header><a class="brand" href="${R}">Simit</a><a class="open" href="${R}#phrases">Открыть тренажёр</a></header>
  <nav class="crumbs" aria-label="Навигация"><a href="${R}">Simit</a> › Фразы</nav>
  <main>
    <h1>Турецкие фразы с голосом носителя</h1>
    <p class="lead">${phr(total)} для жизни в Турции — по ситуациям. У каждой — перевод, чтение русскими буквами и запись живого носителя, а в тренажёре Simit — проверка вашего произношения.</p>
    <p class="upd">Обновлено <!--d-->${ruDate(d)}<!--/d--></p>
    <ul class="topics">
${li}
    </ul>
    <div class="cta"><p><b>Не только читать, но и говорить.</b> В Simit вы произносите фразу, а тренажёр оценивает её от 0 до 100 и подсказывает, какой звук не получился.</p><a href="${R}#phrases">Открыть тренажёр</a></div>
    <h2>Вопросы</h2>
${faqHtml(FAQ)}
  </main>
  <footer>Записи: Mozilla Common Voice (CC0), Tatoeba. Переводы проверены вручную.</footer>` }); }
  // llms.txt — описание сайта для ИИ (llmstxt.org)
  out['llms.txt'] = `# Simit

> Бесплатный тренажёр турецкого произношения и разговора для русскоязычных. Работает в браузере, без регистрации. Игра-квартал Стамбула, где дела в магазине, банке и такси решаются фразой вслух; оценка произношения от 0 до 100 с разбором ошибок по звукам; записи живых носителей; повторение по расписанию FSRS; ${pl(nGram, 'урок', 'урока', 'уроков')} грамматики.

## Фразы по ситуациям (перевод, чтение русскими буквами, запись носителя)

${T.map(t => `- [${t.h1}](${SITE}frazy/${t.slug}/): ${phr(bySet[t.id].items.length)}`).join('\n')}
- [Все ситуации](${SITE}frazy/)

## Приложение

- [Simit — тренажёр](${SITE}): квартал, «Память», тренировка фраз, «На слух», «Свободно», грамматика, прогресс
`;
  // карта сайта
  const urls = [[SITE, null], [SITE + 'frazy/', 'frazy/index.html'], ...T.map(t => [`${SITE}frazy/${t.slug}/`, `frazy/${t.slug}/index.html`])];
  out['sitemap.xml'] = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, f]) => `  <url><loc>${u}</loc>${f ? `<lastmod>${date(f)}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
  return out;
}

// дата страницы остаётся прежней, если её содержимое (без дат) не изменилось
async function build(browser){
  const sets = await data(browser);   // { sets, nGram }
  const old = f => { try { return fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch(e){ return null; } };
  const first = render(sets, {}), dates = {};
  for(const f of Object.keys(first)){ const o = old(f); if(o && strip(o) === strip(first[f])){ const m = /"dateModified":"([^"]+)"/.exec(o); if(m) dates[f] = m[1]; } }
  return render(sets, dates);
}
module.exports = { build, strip, TOPICS };

if(require.main === module) (async () => {
  const { chromium } = require('./harness'); const b = await chromium.launch();
  const out = await build(b); await b.close();
  for(const [f, s] of Object.entries(out)){ fs.mkdirSync(path.dirname(path.join(ROOT, f)), { recursive:true }); fs.writeFileSync(path.join(ROOT, f), s); }
  console.log('записано: ' + Object.keys(out).join(', '));
})();
