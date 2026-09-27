// Автотесты тренажёра Söyle. Запуск: node tests/soyle.test.js [путь к index.html]
// Нужен Playwright (npm i playwright). Распознавание речи, микрофон и сеть подменяются заглушками.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const AXE = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;

let passed = 0, failed = 0;
async function test(name, fn){
  try { await fn(); passed++; console.log('  ✓', name); }
  catch(e){ failed++; console.log('  ✗', name, '\n     ', e.message); }
}
const eq = (a, b, msg) => { if(JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg||''} ожидалось ${JSON.stringify(b)}, получено ${JSON.stringify(a)}`); };
const ok = (v, msg) => { if(!v) throw new Error(msg || 'условие не выполнено'); };

// Заглушки: распознаватель отдаёт window.__say (или последовательность window.__seq), микрофон — тон генератора
const INIT = () => {
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
  navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(), d = c.createMediaStreamDestination(), o = c.createOscillator(); o.connect(d); o.start(); return d.stream; };
  window.__spoken = []; speechSynthesis.speak = u => { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 10); };
  HTMLMediaElement.prototype.play = function(){ (window.__played = window.__played || []).push(this.src); setTimeout(() => this.onended && this.onended(), 10); return Promise.resolve(); };
};
async function openPage(browser, opts = {}){
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, userAgent: opts.android ? 'Mozilla/5.0 (Linux; Android 14) Chrome/128 Mobile' : undefined, colorScheme: opts.scheme || 'light' });
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
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
const setItem = (p, it) => p.evaluate(it => { item = Object.assign({ gid:'o', meaning:'', partnerMeaning:'' }, it); }, it);

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser);

  console.log('Загрузка и режимы');
  await test('страница открывается без ошибок во всех режимах', async () => {
    for(const m of ['pairs','phrases','listen','free']) await p.evaluate(m => setMode(m), m);
    eq(p.errors, []);
  });
  await test('все наборы фраз на месте и без пустых полей', async () => {
    const bad = await p.evaluate(() => PHRASE_SETS.flatMap(g => g.items.filter(i => !i.tr || !i.tl || !i.ru).map(i => g.id + ':' + i.tr)));
    eq(bad, []);
    const ids = await p.evaluate(() => PHRASE_SETS.map(g => g.id));
    eq(ids, ['basic','hotel','greet','food','transport','shop','health','talk','sos']);
  });

  console.log('Минимальные пары');
  await p.evaluate(() => setMode('pairs'));
  await test('верное слово засчитывается', async () => {
    await setItem(p, { target:'ön', partner:'on', gid:'o' });
    await p.evaluate(() => evalPair(['Ön'])); ok((await p.textContent('#result')).includes('Верно'));
  });
  await test('подмена звука распознаётся и называется («o» вместо «ö»)', async () => {
    await setItem(p, { target:'ön', partner:'on', partnerMeaning:'десять', gid:'o' });
    await p.evaluate(() => evalPair(['on'])); const t = await p.textContent('#result');
    ok(t.includes('Прозвучало') && t.includes('«o» вместо «ö»'), t);
  });
  await test('цифра от распознавателя понимается как слово (10 → on)', async () => {
    await setItem(p, { target:'on', partner:'ön', gid:'o' });
    await p.evaluate(() => evalPair(['10'])); ok((await p.textContent('#result')).includes('Верно'));
  });
  await test('нужное слово только в запасных вариантах — «почти»', async () => {
    await setItem(p, { target:'köy', partner:'koy', gid:'o' });
    await p.evaluate(() => evalPair(['kay', 'köy'])); ok((await p.textContent('#result')).includes('Почти'));
  });

  console.log('Фразы');
  await test('фраза целиком — все слова распознаны', async () => {
    await p.evaluate(() => { setMode('phrases'); item = { target:'Köyde büyüdüm.', gid:'ph-basic' }; evalPhrase(['köyde büyüdüm']); });
    ok((await p.textContent('#result')).includes('Все слова'));
  });
  await test('ошибка в одном слове подсвечивается', async () => {
    await p.evaluate(() => { item = { target:'Köyde büyüdüm.', gid:'ph-basic' }; evalPhrase(['koyde büyüdüm']); });
    const t = await p.textContent('#result'); ok(t.includes('1 из 2') && t.includes('«o» вместо «ö»'), t);
  });
  await test('апостроф и цифры в ответе не ломают сравнение', async () => {
    const r = await p.evaluate(() => [compareText("Bu otobüs Taksim'e gider mi?", "bu otobüs Taksim'e gider mi").score, compareText('İki gece için bir oda istiyorum.', '2 gece için bir oda istiyorum').score]);
    eq(r, [1, 1]);
  });

  console.log('Носитель (только живые записи)');
  await test('«Носитель» играет запись, повторное нажатие — другой голос', async () => {
    await p.evaluate(() => { nativeCache.set('merhaba', [{ url:'https://x/a.wav', who:'A' }, { url:'https://x/b.wav', who:'B' }]); item = { target:'Merhaba.', gid:'ph-greet' }; nativeIdx = 0; window.__played = []; playNative(); playNative(); playNative(); });
    eq(await p.evaluate(() => window.__played.map(s => s.split('/').pop())), ['a.wav','b.wav','a.wav']);
  });
  await test('нет записи — «Носитель» молчит, синтез не включается', async () => {
    await p.evaluate(() => { nativeCache.set('zzz', []); item = { target:'zzz', gid:'x' }; window.__spoken = []; window.__played = []; playNative(); });
    eq(await p.evaluate(() => [window.__spoken.length, window.__played.length]), [0, 0]);
    ok((await p.textContent('#nativeStatus')).includes('нет'));
  });
  await test('набор «с записями» собирается из Wikimedia и объединяет голоса', async () => {
    await p.evaluate(() => { setId = 'native'; renderChips(); next(); });
    await p.waitForTimeout(300);
    const r = await p.evaluate(() => [nativeSet.map(i => i.tr).sort(), nativeCache.get('merhaba').length]);
    eq(r[0], ['köy','merhaba']); ok(r[1] >= 2);
  });
  await test('у слова из набора появляется значение из Викисловаря', async () => {
    await p.evaluate(() => { item = { target:'köy', native:true }; descCache.clear(); describeNative('köy'); });
    await p.waitForTimeout(100); ok((await p.textContent('#meaning')).includes('test meaning'));
  });

  console.log('Игра и повторения');
  await test('XP, комбо ×2 максимум, цель дня, серия дней', async () => {
    const r = await p.evaluate(() => { game = { xp:0, streak:0, lastDay:'', today:'', todayOk:0, combo:0 }; for(let i=0;i<8;i++) award(1); award(0); return [game.xp, game.combo, game.todayOk, game.streak, levelOf(game.xp)]; });
    eq(r, [10+12+14+16+18+20+20+20, 0, 8, 1, 2]);
  });
  await test('интервальные повторения: верно → следующая ступень, ошибка → через 10 минут', async () => {
    const r = await p.evaluate(() => { saveList('soyle-srs', []); item = { target:'Hesap lütfen.', gid:'ph-food' };
      srsUpdate(1); const a = loadList('soyle-srs')[0]; srsUpdate(1); const b = loadList('soyle-srs')[0]; srsUpdate(0); const c = loadList('soyle-srs')[0];
      return [a.box, Math.round((a.due-Date.now())/864e5), b.box, Math.round((b.due-Date.now())/864e5), c.box, Math.round((c.due-Date.now())/60e3)]; });
    eq(r, [1, 1, 2, 3, 0, 10]);
  });
  await test('«на сегодня» показывает только то, что пора повторить', async () => {
    const r = await p.evaluate(() => { saveList('soyle-srs', [{ tr:'a', box:1, due:0 }, { tr:'b', box:2, due:Date.now()+864e5 }]); return srsDue().map(c => c.tr); });
    eq(r, ['a']);
  });
  await test('старые «ошибки» переносятся в повторения', async () => {
    const q = await openPage(browser, { storage:{ 'soyle-mistakes': JSON.stringify([{ tr:'kör', ru:'слепой' }]) } });
    eq(await q.evaluate(() => [loadList('soyle-srs').map(c => c.tr), localStorage.getItem('soyle-mistakes')]), [['kör'], null]);
    await q.context().close();
  });

  console.log('На слух');
  await test('верный выбор засчитывается и даёт XP', async () => {
    await p.evaluate(() => setMode('listen'));
    const r = await p.evaluate(() => { const xp = game.xp; answerListen(ls.right); return [document.getElementById('lsResult').textContent.includes('Верно'), game.xp > xp]; });
    eq(r, [true, true]);
  });
  await test('неверный выбор показывает правильное слово', async () => {
    await p.waitForTimeout(1100);
    const t = await p.evaluate(() => { answerListen(ls.right === 'A' ? 'B' : 'A'); return document.getElementById('lsResult').textContent; });
    ok(t.includes('прозвучало'), t);
  });

  console.log('Свободная речь');
  await test('с заданной фразой — вердикт «поймёт»', async () => {
    await p.evaluate(() => { setMode('free'); recordOn = false; });
    await p.fill('#intent', 'Bana bir taksi çağırır mısınız?');
    await p.evaluate(() => { window.__seq = null; window.__say = 'bana bir taksi çağırır mısınız'; });
    await p.click('#freeSpeak'); await p.waitForTimeout(150);
    ok((await p.textContent('#freeResult')).includes('Носитель поймёт'));
  });
  await test('без фразы — показывает, что услышит носитель, и даёт перевод', async () => {
    await p.fill('#intent', ''); await p.evaluate(() => { window.__say = 'merhaba'; });
    await p.click('#freeSpeak'); await p.waitForTimeout(150);
    const t = await p.textContent('#freeResult'); ok(t.includes('Носитель услышит') && t.includes('merhaba'), t);
    eq(await p.getAttribute('#freeTranslate', 'aria-disabled'), null);
  });
  await test('«⭐ В мои фразы»: сохранить, не дублировать, удалить', async () => {
    await p.click('#freeSave'); eq(await p.textContent('#freeSave'), '✓ Сохранено');
    await p.click('#freeSave'); eq(await p.textContent('#freeSave'), 'Уже есть в моих');
    await p.evaluate(() => { setMode('phrases'); setId = 'mine'; renderChips(); next(); });
    eq(await p.textContent('#target'), 'merhaba');
    await p.click('#delMine'); eq(await p.evaluate(() => loadList('soyle-mine').length), 0);
  });
  const a = await openPage(browser, { android:true });
  await test('Android: нарастающие повторы фразы склеиваются в одну', async () => {
    await a.evaluate(() => { recordOn = false; setMode('free'); window.__seq = ['bana', 'bana bir', 'bana bir taksi', 'bana bir taksi çağırır mısınız']; });
    await a.click('#freeSpeak'); await a.waitForTimeout(150);
    ok((await a.textContent('#freeResult')).includes('«bana bir taksi çağırır mısınız»'));
  });
  await test('Android: если микрофон не делится, запись отключается один раз и запоминается', async () => {
    const r = await a.evaluate(async () => { recordOn = true; window.__silent = true; setMode('pairs'); await startListening(); await new Promise(z => setTimeout(z, 100)); window.__silent = false; return [recordOn, localStorage.getItem('soyle-rec-conflict'), document.getElementById('freeMine').textContent]; });
    eq(r, [false, '1', '🎙 Записать себя']);
  });
  await test('Android: «Сравнить» сам записывает и проигрывает образец → вас', async () => {
    const r = await a.evaluate(async () => { window.__played = []; window.__spoken = []; item.target = 'on'; nativeCache.set('on', [{ url:'https://x/on.wav', who:'T' }]); compareWithFreshRecording(); await new Promise(z => setTimeout(z, 2600)); return [window.__spoken.length + window.__played.filter(s => !s.startsWith('blob:')).length >= 2, window.__played.some(s => s.startsWith('blob:')), myRecFor]; });
    eq(r, [true, true, 'on']);
  });
  await a.context().close();

  console.log('Запись и сравнение');
  await test('«Сравнить» не играет запись другого слова', async () => {
    await p.evaluate(() => setMode('pairs'));
    const r = await p.evaluate(async () => { recordOn = true; stream = null; window.__say = item.target; await startListening(); await new Promise(z => setTimeout(z, 200)); const first = [myRecFor === item.target, document.getElementById('compare').disabled]; next(); const afterNext = document.getElementById('compare').disabled; compareVoices(); return [first, afterNext, document.getElementById('result').textContent.includes('Сначала скажите')]; });
    eq(r, [[true, false], true, true]);
  });

  await test('«Эхо»: образец → ваша попытка → сразу образец и ваша запись', async () => {
    const r = await p.evaluate(async () => { setMode('pairs'); recordOn = true; stream = null; await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 100)); nativeCache.set(clean(item.target), [{ url:'https://x/ref.wav', who:'T' }]);
      window.__say = item.target; window.__played = []; echo(); await new Promise(z => setTimeout(z, 1600));
      return window.__played.map(s => s.startsWith('blob:') ? 'me' : s.split('/').pop()); });
    eq(r, ['ref.wav', 'ref.wav', 'me']);
  });

  console.log('Интерфейс');
  await test('кнопки не сдвигаются при смене слов и нажатиях', async () => {
    const pos = () => p.evaluate(() => [...document.querySelectorAll('#card .btngrid .btn')].map(b => { const r = b.getBoundingClientRect(); return Math.round(r.y + scrollY) + ',' + Math.round(r.x); }).join(' '));
    await p.evaluate(() => { setMode('phrases'); setId = 'hotel'; next(); }); const base = await pos();
    for(let i = 0; i < 15; i++){ await p.evaluate(() => next()); ok(await pos() === base, 'сдвиг после смены фразы'); }
  });
  await test('подсказки скрыты и открываются кнопкой «?», выбор запоминается', async () => {
    eq(await p.evaluate(() => getComputedStyle(document.getElementById('tip')).display), 'none');
    await p.click('#hintsBtn'); eq(await p.evaluate(() => getComputedStyle(document.getElementById('tip')).display), 'block');
    eq(await p.evaluate(() => localStorage.getItem('soyle-hints')), '1'); await p.click('#hintsBtn');
  });
  await test('упражнение видно на первом экране телефона (390×844)', async () => {
    for(const m of ['pairs','phrases','listen','free']){
      await p.evaluate(m => { setMode(m); scrollTo(0,0); }, m);
      const bottom = await p.evaluate(() => [...document.querySelectorAll('.card')].find(c => !c.hidden).querySelector('.btn.primary').getBoundingClientRect().bottom);
      ok(bottom < 844, `${m}: главная кнопка ниже экрана (${Math.round(bottom)})`);
    }
  });
  await test('нет горизонтальной прокрутки на 320px (≈ масштаб 200%)', async () => {
    await p.setViewportSize({ width:320, height:700 });
    for(const m of ['pairs','phrases','listen','free']){ await p.evaluate(m => setMode(m), m); ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), m); }
    await p.setViewportSize({ width:390, height:844 });
  });
  await test('пробел на кнопке нажимает кнопку, а не включает микрофон', async () => {
    await p.evaluate(() => setMode('pairs')); await p.focus('#next'); const t = await p.evaluate(() => item.target);
    let changed = false; for(let i = 0; i < 6 && !changed; i++){ await p.keyboard.press('Space'); changed = (await p.evaluate(() => item.target)) !== t; }
    ok(changed);
  });
  await test('зоны нажатия не меньше 44×44', async () => {
    const small = await p.evaluate(() => [...document.querySelectorAll('button,a.btn,input,select')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { id:e.id || e.textContent.trim(), w:r.width, h:r.height }; }).filter(x => x.w < 44 || x.h < 44).map(x => x.id));
    eq(small, []);
  });
  if(AXE) for(const scheme of ['light','dark']) await test(`WCAG 2.1 AA (axe-core), ${scheme === 'light' ? 'светлая' : 'тёмная'} тема`, async () => {
    const q = await openPage(browser, { scheme });
    const v = [];
    for(const m of ['pairs','phrases','listen','free']){
      await q.evaluate(m => { setMode(m); document.body.classList.add('hints'); }, m); await q.addScriptTag({ content:AXE });
      v.push(...(await q.evaluate(async () => (await axe.run(document, { runOnly:['wcag2a','wcag2aa','wcag21aa'] })).violations.map(x => x.id))).map(id => m + ':' + id));
    }
    await q.context().close(); eq(v, []);
  });
  await test('за весь прогон на странице не было JS-ошибок', async () => eq(p.errors, []));

  await browser.close();
  console.log(`\nИтог: ${passed} пройдено, ${failed} с ошибкой`);
  process.exit(failed ? 1 : 0);
})();
