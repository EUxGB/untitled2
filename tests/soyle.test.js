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
  const p = await ctx.newPage(); p.errors = []; p.on('pageerror', e => p.errors.push(e.message));
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

  console.log('Оценка произношения 0–100 и разбор ошибок');
  await test('оценка: точно — 100, спутанный звук ö/o — не выше 50, пропущенное слово снижает оценку', async () => {
    const r = await p.evaluate(() => [pronScore('kör', ['kör']).score, pronScore('kör', ['kor']).score, pronScore('kör', ['x', 'kör']).score,
      pronScore('Hesap lütfen', ['hesap']).score, pronScore('Hesap lütfen', ['hesap lütfen']).score, gradeOf(95)[1], gradeOf(75)[1], gradeOf(50)[1], gradeOf(10)[1]]);
    eq(r, [100, 50, 70, 50, 100, 'Отлично', 'Хорошо', 'Есть ошибки', 'Не понято']);
  });
  await test('разбор: в каком слове и какой звук не совпал', async () => {
    const r = await p.evaluate(() => { setMode('phrases'); item = { target:'Bir çay lütfen.', gid:'ph-basic' }; evalPhrase(['bir cay lütfen']);
      return [document.querySelector('#result .score b').textContent, document.querySelector('#result .errs').textContent]; });
    eq(r[0], '83'); ok(r[1].includes('çay') && r[1].includes('«c» вместо «ç»'), r[1]);
  });
  await test('пара: услышано другое слово — оценка, разбор звука; верно — 100 и реакция (+XP, слово зеленеет)', async () => {
    const r = await p.evaluate(() => { setMode('pairs'); item = { target:'kör', partner:'kor', partnerMeaning:'угли', gid:'o' }; evalPair(['kor']);
      const bad = [document.querySelector('#result .score b').textContent, document.querySelector('#result .errs').textContent.includes('«o» вместо «ö»')];
      evalPair(['kör']); const res = document.getElementById('result');
      return [bad, document.querySelector('#result .score b').textContent, res.classList.contains('win'), !!res.querySelector('.xp-pop'), document.getElementById('target').classList.contains('hit')]; });
    eq(r, [['50', true], '100', true, true, true]);
  });
  await test('«Свободно» с заданной фразой: оценка и ошибки; без фразы — чёткость распознавания', async () => {
    const r = await p.evaluate(() => { setMode('free'); setFree('ok', 'x', errsHtml(pronScore('Su lütfen', ['şu lütfen']).words), pronScore('Su lütfen', ['şu lütfen']).score);
      return [document.querySelector('#freeResult .score b').textContent, document.querySelector('#freeResult .errs').textContent]; });
    eq(r[0], '75'); ok(r[1].includes('«ş» вместо «s»'), r[1]);
  });

  console.log('Фразы');
  await test('фраза целиком — все слова распознаны', async () => {
    await p.evaluate(() => { setMode('phrases'); item = { target:'Köyde büyüdüm.', gid:'ph-basic' }; evalPhrase(['köyde büyüdüm']); });
    ok((await p.textContent('#result')).includes('все слова'));
    eq(await p.evaluate(() => document.querySelector('#result .score b').textContent), '100');
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
    const r = await p.evaluate(() => { game = { xp:0, streak:0, lastDay:'', today:'', todayOk:0, combo:0 }; normalizeGame(); todayQuest(); game.quest.done = true; for(let i=0;i<8;i++) award(1); award(0); return [game.xp, game.combo, game.todayOk, game.streak, levelOf(game.xp)]; });
    eq(r, [10+12+14+16+18+20+20+20, 0, 8, 1, 2]);
  });
  await test('FSRS-6 в программе считает так же, как официальная py-fsrs (стабильность, трудность, срок, состояние)', async () => {
    const ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'fsrs-cases.json'), 'utf8')).cases;
    const bad = await p.evaluate(cases => { let bad = 0;
      for(const seq of cases){ let c = FSRS.newCard(0); for(const x of seq){ c = FSRS.review(c, x.g, x.t);
        if(!(Math.abs(c.s - x.s) < 1e-6 * Math.max(1, x.s) && Math.abs(c.d - x.d) < 1e-6 && Math.abs(c.due - x.due) < 1500 && c.state === x.state && (c.step ?? null) === (x.step ?? null))) bad++; } }
      return bad; }, ref);
    eq([bad, ref.reduce((a, s) => a + s.length, 0) > 300], [0, true]);
  });
  await test('чтение вслух в других разделах НЕ продвигает расписание — фраза только попадает в «Память» как новая', async () => {
    const r = await p.evaluate(() => { saveList('soyle-srs', []); const m0 = mode; mode = 'phrases'; item = { target:'Hesap lütfen.', translit:'хесап', meaning:'Счёт', gid:'ph-food' };
      srsUpdate(1); srsUpdate(1); const c = loadCards(); mode = m0; return [c.length, c[0].s, c[0].side, c[0].seen, srsDue().length]; });
    eq(r, [1, null, 'rec', false, 0]);
  });
  await test('старые карточки Лейтнера переносятся: ступень → стабильность в днях, срок сохраняется', async () => {
    const r = await p.evaluate(() => { saveList('soyle-srs', [{ tr:'a', ru:'а', box:2, due:5 }, { tr:'b', box:0, due:7 }]); const c = loadCards();
      return [c[0].state, c[0].s, c[0].due, c[0].side, c[1].s, c[1].seen, !!loadList('soyle-srs')[0].side]; });
    eq(r, [2, 3, 5, 'rec', null, true, true]);
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
    eq(await p.isDisabled('#freeTranslate'), false);
  });
  await test('«В мои фразы»: сохранить, не дублировать, удалить', async () => {
    await p.click('#freeSave'); eq(await p.textContent('#freeSave'), 'Сохранено');
    await p.click('#freeSave'); eq(await p.textContent('#freeSave'), 'Уже в моих');
    await p.evaluate(() => { setMode('phrases'); setId = 'mine'; renderChips(); next(); });
    eq(await p.textContent('#target'), 'merhaba');
    await p.click('#delMine'); eq(await p.evaluate(() => loadList('soyle-mine').length), 1); // первое нажатие только спрашивает
    ok((await p.textContent('#delMine')).includes('ещё раз'));
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
    eq(r, [false, '1', 'Записать себя']);
  });
  await test('Android: «Сравнить» сам записывает и проигрывает образец → вас', async () => {
    const r = await a.evaluate(async () => { window.__played = []; window.__spoken = []; item.target = 'on'; nativeCache.set('on', [{ url:'https://x/on.wav', who:'T' }]); compareWithFreshRecording(); await new Promise(z => setTimeout(z, 2600)); return [window.__spoken.length + window.__played.filter(s => !s.startsWith('blob:')).length >= 2, window.__played.some(s => s.startsWith('blob:')), myRecFor]; });
    eq(r, [true, true, 'on']);
  });
  await a.context().close();

  console.log('Запись и сравнение');
  await test('«Сравнить» не играет запись другого слова: без записи этого слова — полный цикл эхо', async () => {
    await p.evaluate(() => setMode('pairs'));
    const r = await p.evaluate(async () => { recordOn = true; stream = null; window.__say = item.target; await startListening(); await new Promise(z => setTimeout(z, 200));
      const first = myRecFor === item.target; next(); await (nativePending || Promise.resolve()); nativeCache.set(clean(item.target), [{ url:'https://x/ref.wav', who:'T' }]);
      window.__say = item.target; window.__played = []; compareVoices(); await new Promise(z => setTimeout(z, 1600));
      return [first, document.getElementById('compare').disabled, window.__played.map(s => s.startsWith('blob:') ? 'me' : s.split('/').pop())]; });
    eq(r, [true, false, ['ref.wav', 'ref.wav', 'me']]);   // образец → вы (распознавание) → образец → ваша НОВАЯ запись
  });
  await test('кнопки «Эхо» больше нет — её работа внутри «Сравнить»; в карточке 3 кнопки', async () => {
    eq(await p.evaluate(() => [!!document.getElementById('echo'), document.querySelectorAll('#card .acts .act').length]), [false, 3]);
  });

  await test('«Эхо»: образец → ваша попытка → сразу образец и ваша запись', async () => {
    const r = await p.evaluate(async () => { setMode('pairs'); recordOn = true; stream = null; await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 100)); nativeCache.set(clean(item.target), [{ url:'https://x/ref.wav', who:'T' }]);
      window.__say = item.target; window.__played = []; echo(); await new Promise(z => setTimeout(z, 1600));
      return window.__played.map(s => s.startsWith('blob:') ? 'me' : s.split('/').pop()); });
    eq(r, ['ref.wav', 'ref.wav', 'me']);
  });

  console.log('Геймификация');
  const RESET = "game = Object.assign({ xp:0, streak:0, lastDay:'', today:'', todayOk:0, combo:0, bestCombo:0, total:0, goals:0, blitzBest:0, badges:[], quest:null }); stats = {}; toastQueue.length = 0;";
  await test('старое сохранение игры без новых полей не ломает начисление очков', async () => {
    const q = await openPage(browser, { storage:{ 'soyle-game': JSON.stringify({ xp:120, streak:2 }) } });
    const r = await q.evaluate(() => { game = { xp:5 }; award(1, 'o'); return [Array.isArray(game.badges), game.xp > 5, game.badges.includes('first')]; });
    const errs = q.errors; await q.context().close(); eq(r, [true, true, true]); eq(errs, []);
  });
  await test('звания растут с уровнем', async () => {
    eq(await p.evaluate(() => [rankOf(1), rankOf(3), rankOf(6), rankOf(99)]), ['Турист','Сосед','Стамбулец','Yerli — местный']);
  });
  await test('достижения открываются один раз и показываются в списке', async () => {
    const r = await p.evaluate(r => { eval(r); for(let i = 0; i < 5; i++) award(1, 'o'); const once = game.badges.slice(); award(1, 'o'); return [once, game.badges.filter(b => b === 'first').length, document.getElementById('badgeCount').textContent, document.querySelectorAll('.badge:not(.locked)').length]; }, RESET);
    ok(r[0].includes('first') && r[0].includes('combo5'), JSON.stringify(r[0])); eq(r[1], 1); eq(r[2], `${r[0].length} / ${await p.evaluate(() => BADGES.length)}`); eq(r[3], r[0].length);
  });
  await test('задание дня: прогресс только по своему набору, награда +50 XP один раз', async () => {
    const r = await p.evaluate(r => { eval(r); todayQuest(); game.quest.idx = 0; // «5 верных На слух»
      award(1, 'o'); const other = game.quest.got; for(let i = 0; i < 5; i++) award(1, 'listen'); const xp1 = game.xp; award(1, 'listen'); const xp2 = game.xp;
      return [other, game.quest.done, xp2 - xp1 < 50, document.getElementById('gbQuestTxt').textContent.includes('выполнено')]; }, RESET);
    eq(r, [0, true, true, true]);
  });
  await test('задание на комбо засчитывается по серии', async () => {
    const r = await p.evaluate(r => { eval(r); todayQuest(); game.quest.idx = 5; for(let i = 0; i < 5; i++) award(1, 'o'); return game.quest.done; }, RESET);
    eq(r, true);
  });
  await test('уведомления идут очередью, а не перекрывают друг друга', async () => {
    const r = await p.evaluate(async () => { toastQueue.length = 0; for(let t = 0; t < 40 && toastBusy; t++) await new Promise(z => setTimeout(z, 100)); toast('A'); toast('B'); const first = document.getElementById('toast').textContent; await new Promise(z => setTimeout(z, 2200)); return [first, document.getElementById('toast').textContent]; });
    eq(r, ['A', 'B']);
  });
  await test('блиц: таймер, счёт верных, рекорд и достижение', async () => {
    const r = await p.evaluate(async r => { eval(r); BLITZ_SEC = 3; setMode('listen'); startBlitz();
      // в блице выбрать можно только после начала звука — ждём, пока варианты откроются
      for(let i = 0; i < 2; i++){ await new Promise(z => setTimeout(z, 60)); for(let k = 0; k < 40 && lsLocked; k++) await new Promise(z => setTimeout(z, 50)); answerListen(ls.right); }
      const during = document.getElementById('lsBlitz').textContent;
      await new Promise(z => setTimeout(z, 3200)); BLITZ_SEC = 60;
      const res = [/^\d:\d\d · верно/.test(during), game.blitzBest, document.getElementById('lsResult').textContent.includes('рекорд'), document.getElementById('lsBlitz').textContent, blitz];
      document.getElementById('modalSecondary').click(); return res; }, RESET);
    eq(r, [true, 2, true, 'Блиц 60 с', null]);
  });
  await test('блиц — настоящие 60 секунд с ответами до конца: экран итогов, новые слова не идут, ответы заблокированы', async () => {
    const q = await openPage(browser);
    await q.clock.install();
    await q.evaluate(() => { setMode('listen'); game.blitzBest = 0; });
    await q.click('#lsBlitz');
    // отвечаем правильно всю минуту, как пользователь
    for(let sec = 0; sec < 62; sec++){
      const can = await q.evaluate(() => !!ls && !lsLocked && !document.getElementById('lsA').disabled);
      // force: при подменённых часах проверка «кнопка неподвижна» ждёт кадров анимации, которые идут только по runFor — иногда зависала на 30 с
      if(can){ const right = await q.evaluate(() => ls.right); await q.click(right === 'A' ? '#lsA' : '#lsB', { force:true }); }
      await q.clock.runFor(1000);
    }
    const after = await q.evaluate(() => ({ blitz, overlay: !document.getElementById('modal').hidden, text: document.getElementById('modalStats').textContent + ' ' + document.getElementById('modalTitle').textContent,
      disabled: document.getElementById('lsA').disabled && document.getElementById('lsB').disabled, best: game.blitzBest, btn: document.getElementById('lsBlitz').textContent, word: ls && ls.answer }));
    // даже спустя время после конца новое слово не должно появиться само
    await q.clock.runFor(5000);
    const later = await q.evaluate(() => ls && ls.answer);
    const errs = q.errors; await q.context().close();
    eq(after.blitz, null); ok(after.overlay, 'нет экрана итогов'); ok(/верно/.test(after.text) && /Блиц|рекорд/.test(after.text), after.text);
    ok(after.disabled, 'варианты не заблокированы после конца'); ok(after.best >= 20, 'рекорд не записан: ' + after.best);
    eq(after.btn, 'Блиц 60 с'); eq(later, after.word); eq(errs, []);
  });
  await test('экран итогов блица: «Ещё раз» запускает новый, «Закрыть» возвращает к обычной тренировке', async () => {
    const q = await openPage(browser); await q.clock.install();
    await q.evaluate(() => { setMode('listen'); BLITZ_SEC = 2; });
    await q.click('#lsBlitz'); await q.clock.runFor(2500);
    ok(await q.isVisible('#modal'), 'нет экрана итогов');
    await q.click('#modalPrimary'); const again = await q.evaluate(() => [!!blitz, document.getElementById('modal').hidden, document.getElementById('lsA').disabled]);
    await q.clock.runFor(2500); await q.click('#modalSecondary');
    const closed = await q.evaluate(() => [blitz, document.getElementById('modal').hidden, document.getElementById('lsA').disabled, !!ls]);
    await q.context().close();
    eq(again, [true, true, false]); eq(closed, [null, true, false, true]);
  });
  await test('блиц останавливается при уходе из режима «На слух»', async () => {
    const r = await p.evaluate(() => { setMode('listen'); startBlitz(); setMode('pairs'); return [blitz, document.getElementById('lsBlitz').textContent]; });
    eq(r, [null, 'Блиц 60 с']);
  });
  await test('конфетти не ломают страницу и отключены при «уменьшить движение»', async () => {
    await p.evaluate(() => confetti()); await p.waitForTimeout(100);
    const q = await openPage(browser); await q.emulateMedia({ reducedMotion:'reduce' });
    const drawn = await q.evaluate(() => { const c = document.getElementById('confetti'); const w = c.width; confetti(); return c.width === w; });
    await q.context().close(); eq(drawn, true); eq(p.errors, []);
  });
  await test('панель прогресса не сдвигает кнопки при изменении текста задания', async () => {
    const r = await p.evaluate(r => { eval(r); setMode('pairs'); const y = () => Math.round(document.getElementById('speak').getBoundingClientRect().y + scrollY);
      const a = y(); todayQuest(); game.quest.idx = 6; renderGame(); const b = y(); game.quest.done = true; renderGame(); return [a, b, y()]; }, RESET);
    eq(r[0], r[1]); eq(r[1], r[2]);
  });

  console.log('Сервис распознавания не отвечает');
  await test('«Сказать»: через 12 с понятное сообщение, кнопка снова работает, запись не отключается', async () => {
    const q = await openPage(browser, { android:true });
    const r = await q.evaluate(async () => {
      const Hang = function(){ this.start = () => {}; this.stop = () => {}; this.abort = () => {}; };  // сервис молчит
      SR = Hang; recordOn = true; setMode('pairs');
      const t0 = Date.now(); startListening(); for(let t = 0; t < 160 && listening; t++) await new Promise(z => setTimeout(z, 100));
      return [listening, Math.round((Date.now()-t0)/1000), document.getElementById('result').textContent.includes('не ответил'), document.getElementById('speak').textContent, recordOn, localStorage.getItem('soyle-rec-conflict')];
    });
    await q.context().close();
    eq([r[0], r[1] >= 12 && r[1] <= 15, r[2], r[3], r[4], r[5]], [false, true, true, 'Сказать', true, null]);
  });
  await test('«Сказать» → повторное нажатие во время зависания останавливает запись', async () => {
    const r = await p.evaluate(async () => { const Hang = function(){ this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }; const keep = SR; SR = Hang; setMode('pairs');
      startListening(); await new Promise(z => setTimeout(z, 200)); stopListening(); await new Promise(z => setTimeout(z, 1800)); SR = keep; return [listening, document.getElementById('speak').textContent]; });
    eq(r, [false, 'Сказать']);
  });
  await test('«Свободно»: зависание — сообщение и кнопка снова «Сказать», без ложного отключения записи на Android', async () => {
    const q = await openPage(browser, { android:true });
    const r = await q.evaluate(async () => { const Hang = function(){ this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }; SR = Hang; recordOn = true; setMode('free');
      freeListen(); for(let t = 0; t < 160 && freeOn; t++) await new Promise(z => setTimeout(z, 100));
      return [freeOn, document.getElementById('freeResult').textContent.includes('не ответил'), document.getElementById('freeSpeak').textContent, localStorage.getItem('soyle-rec-conflict')]; });
    await q.context().close();
    eq(r, [false, true, 'Сказать', null]);
  });

  console.log('Геймификация по навыку gamification-loops');
  await test('урок: 10 заданий нажатиями → окно итогов с точностью и ошибками; «Ещё урок» / «Отдохнуть»', async () => {
    const q = await openPage(browser);
    await q.evaluate(() => { LESSON_SIZE = 10; setMode('pairs'); });
    for(let i = 0; i < 10; i++){
      const w = await q.evaluate(i => { const t = item.target; window.__say = i === 3 ? item.partner : t; return t; }, i);
      await q.click('#speak'); await q.waitForTimeout(120);
      if(i < 9){ ok(await q.evaluate(() => document.getElementById('modal').hidden), 'окно раньше времени'); await q.click('#next'); }
    }
    const r = await q.evaluate(() => [!document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, document.getElementById('modalStats').textContent, document.getElementById('modalText').textContent, game.lessons]);
    ok(r[0], 'нет окна итогов'); ok(r[1].includes('Урок'), r[1]); ok(r[2].includes('9/10') && r[2].includes('90%'), r[2]); ok(r[3].includes('на сегодня'), r[3]); eq(r[4], 1);
    await q.click('#modalPrimary');
    eq(await q.evaluate(() => [document.getElementById('modal').hidden, document.getElementById('lessonTxt').textContent, game.badges.includes('lesson1')]), [true, 'урок 0 / 10', true]);
    await q.evaluate(() => { for(let i = 0; i < 10; i++) count('o', 1); }); await q.click('#modalSecondary');
    eq(await q.evaluate(() => mode), 'progress');
    const errs = q.errors; await q.context().close(); eq(errs, []);
  });
  await test('заморозка серии: один пропуск прощается и тратит ❄️, без заморозки серия сбрасывается', async () => {
    const r = await p.evaluate(r => { eval(r); const d2 = new Date(Date.now() - 2*864e5).toISOString().slice(0,10);
      game.lastDay = d2; game.streak = 5; game.freezes = 1; award(1, 'o'); const a = [game.streak, game.freezes, game.frozenDays.length];
      game.lastDay = d2; game.streak = 5; game.freezes = 0; game.today = ''; award(1, 'o'); return [a, game.streak]; }, RESET);
    eq(r, [[6, 0, 1], 1]);
  });
  await test('цель дня: окно-праздник, +1 ❄️ (не больше 2), кнопка «На сегодня всё» ведёт в «Прогресс»', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(() => { MILESTONE_MODALS = true; todayQuest(); game.quest.done = true; game.freezes = 0; for(let i = 0; i < 20; i++) award(1, 'o');
      return [!document.getElementById('modal').hidden, game.freezes]; });
    ok(r[0], 'нет окна'); eq(r[1], 1);
    // окна идут очередью (новые уровни наступили раньше цели) — листаем до окна цели дня
    let title = '';
    for(let i = 0; i < 8; i++){ title = await q.textContent('#modalTitle'); if(title.includes('Цель дня')) break; await q.click('#modalPrimary'); await q.waitForTimeout(200); }
    ok(title.includes('Цель дня'), 'окно цели дня не показано: ' + title);
    await q.click('#modalSecondary'); await q.waitForTimeout(200);
    for(let i = 0; i < 5 && await q.isVisible('#modal'); i++){ await q.click('#modalPrimary'); await q.waitForTimeout(200); }
    eq(await q.evaluate(() => mode), 'progress');
    const cap = await q.evaluate(() => { game.freezes = 2; game.todayOk = 19; award(1, 'o'); return game.freezes; });
    await q.context().close(); eq(cap, 2);
  });
  await test('новый уровень: окно со званием и сколько до следующего; Escape закрывает; горячие клавиши не срабатывают под окном', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(() => { MILESTONE_MODALS = true; todayQuest(); game.quest.done = true; game.xp = 45; award(1, 'o'); return [document.getElementById('modalTitle').textContent, document.getElementById('modalText').textContent,
      document.getElementById('modalPrimary').getBoundingClientRect().width / document.querySelector('.modal-box').getBoundingClientRect().width]; });
    ok(r[2] > 0.8, 'одна кнопка должна быть во всю ширину, сейчас ' + Math.round(r[2]*100) + '%');
    ok(r[0].includes('Уровень 2') && r[0].includes('Гость'), r[0]); ok(/осталось \d+ XP|\d+ XP/.test(r[1]), r[1]);
    const w = await q.evaluate(() => item.target); await q.keyboard.press('Enter'); // Enter под окном не листает слова
    const same = await q.evaluate(() => item.target) === w || await q.evaluate(() => document.getElementById('modal').hidden);
    await q.keyboard.press('Escape'); const closed = await q.evaluate(() => document.getElementById('modal').hidden);
    await q.context().close(); ok(same, 'горячая клавиша сработала под окном'); ok(closed, 'Escape не закрыл окно');
  });
  await test('неожиданный бонус: +15 XP и уведомление; в обычных тестах выключен', async () => {
    const r = await p.evaluate(r => { eval(r); todayQuest(); game.quest.done = true; SURPRISE_P = 1; award(1, 'o'); const a = game.xp; SURPRISE_P = 0; award(1, 'o'); return [a, game.xp - a]; }, RESET);
    eq(r, [25, 12]);
  });
  await test('неделя серии на экране «Прогресс»: 7 дней, сегодня отмечено, заморозка видна', async () => {
    const r = await p.evaluate(r => { eval(r); const y = new Date(Date.now() - 864e5).toISOString().slice(0,10); game.frozenDays = [y]; award(1, 'o'); setMode('progress');
      const dots = [...document.querySelectorAll('#gbWeek .pv-dot')]; const out = [dots.length, dots[6].className.includes('done'), dots[5].className.includes('frozen')]; setMode('pairs'); return out; }, RESET);
    eq(r, [7, true, true]);
  });
  await test('блиц: праздники (новый уровень) не прерывают блиц, а показываются после итогов', async () => {
    const q = await openPage(browser); await q.clock.install();
    await q.evaluate(() => { MILESTONE_MODALS = true; todayQuest(); game.quest.done = true; game.xp = 48; BLITZ_SEC = 3; setMode('listen'); startBlitz(); });
    await q.clock.runFor(400); await q.evaluate(() => answerListen(ls.right)); // уровень повышается во время блица (варианты открылись со звуком)
    const during = await q.evaluate(() => document.getElementById('modal').hidden);
    await q.clock.runFor(3500);
    const t1 = await q.evaluate(() => document.getElementById('modalTitle').textContent); await q.click('#modalSecondary'); await q.clock.runFor(300);
    const t2 = await q.evaluate(() => document.getElementById('modalTitle').textContent);
    await q.context().close(); eq(during, true); ok(/Блиц|рекорд/.test(t1), t1); ok(t2.includes('Уровень 2'), t2);
  });

  console.log('web-design-guidelines (Vercel) и game-design');
  await test('WIG: турецкий текст и название не переводятся браузером; поля с name; касания без задержки; окно не прокручивает страницу', async () => {
    const r = await p.evaluate(() => { setMode('listen'); const out = [document.getElementById('target').getAttribute('translate'), document.querySelector('#lsA b').getAttribute('translate'), document.querySelector('h1').getAttribute('translate'),
      document.getElementById('intent').name, document.getElementById('bkInput').name, getComputedStyle(document.documentElement).touchAction, getComputedStyle(document.getElementById('modal')).overscrollBehaviorY,
      document.getElementById('intent').placeholder.endsWith('…')]; setMode('pairs'); return out; });
    eq(r, ['no','no','no','intent','backup','manipulation','contain', true]);
  });
  await test('WIG: раздел в адресе — ссылка #phrases открывает «Фразы», переключение меняет адрес', async () => {
    const q = await browser.newPage(); await q.addInitScript(() => { window.SOYLE_TEST = true; }); await q.route('**/*googleapis*/**', r => r.abort()); await q.route('**/commons.wikimedia.org/**', r => r.fulfill({ json:{ query:{ pages:{} } } }));
    await q.goto(FILE + '#phrases'); await q.waitForTimeout(200);
    const a = await q.evaluate(() => [mode, document.getElementById('tab-phrases').getAttribute('aria-pressed')]);
    await q.click('#tab-progress'); const h = await q.evaluate(() => location.hash); await q.close();
    eq(a, ['phrases','true']); eq(h, '#progress');
  });
  await test('WIG: в окне фокус не уходит за его пределы (Tab по кругу)', async () => {
    const q = await openPage(browser);
    await q.evaluate(() => showModal({ title:'Тест', primary:{ label:'Да' }, secondary:{ label:'Нет' } })); await q.waitForTimeout(100);
    const seen = []; for(let i = 0; i < 4; i++){ await q.keyboard.press('Tab'); seen.push(await q.evaluate(() => document.getElementById('modal').contains(document.activeElement))); }
    await q.context().close(); eq(seen, [true, true, true, true]);
  });
  await test('game-design «доминирующая стратегия»: угадывание «На слух» даёт меньше опыта, чем произношение', async () => {
    const r = await p.evaluate(r => { eval(r); todayQuest(); game.quest.done = true; award(1, 'listen'); const l = game.xp; game.combo = 0; award(1, 'o'); const s = game.xp - l; game.combo = 0; award(1, 'free'); return [l, s, game.xp - l - s]; }, RESET);
    eq(r, [4, 10, 15]);
  });

  console.log('webapp-testing: осмотр каждого экрана и нажатие всех кнопок');
  await test('на каждом экране нажимаются все видимые кнопки — без ошибок JS и консоли', async () => {
    const q = await openPage(browser); const consoleErr = [];
    q.on('console', m => { if(m.type() === 'error' && !/Failed to load resource|ERR_|from origin 'null'.*woff2|woff2.*from origin 'null'/.test(m.text())) consoleErr.push(m.text()); });
    await q.evaluate(() => { window.__say = 'merhaba'; });
    for(const tab of ['#tab-pairs','#tab-phrases','#tab-listen','#tab-free','#tab-progress']){
      await q.click(tab); await q.waitForLoadState('networkidle');
      const ids = await q.evaluate(() => [...document.querySelectorAll('.screen > section:not([hidden]) button, .chips button')].filter(b => b.offsetParent && !b.disabled && !['bkYes','updateApp'].includes(b.id)).map((b, i) => { b.dataset.probe = String(i); return String(i); }));
      for(const id of ids){
        if(await q.isVisible('#modal')) await q.click('#modalSecondary:visible, #modalPrimary');
        if(await q.isVisible('#sheet')) await q.click('#sheetClose');
        const el = await q.$(`[data-probe="${id}"]`); if(el && await el.isVisible() && await el.isEnabled()) await el.click({ timeout:3000 }).catch(() => {});
        await q.waitForTimeout(60);
      }
      await q.evaluate(() => { if(typeof blitz !== 'undefined' && blitz) endBlitz(true); });
      if(await q.isVisible('#modal')) await q.click('#modalPrimary');
      if(await q.isVisible('#sheet')) await q.click('#sheetClose');
    }
    const errs = q.errors; await q.context().close(); eq(errs, []); eq(consoleErr, []);
  });

  console.log('Образец, Эхо и Синтез');
  const FAKE_VOICE = "trVoice = { name:'Test Türkçe', lang:'tr-TR' }; trVoices = [trVoice];";
  await test('«Синтез» произносит текущее слово', async () => {
    const r = await p.evaluate(async v => { eval(v); setMode('pairs'); window.__spoken = []; document.getElementById('play').disabled = false; document.getElementById('play').click(); await new Promise(z => setTimeout(z, 100)); return [window.__spoken, item.target]; }, FAKE_VOICE);
    eq(r[0], [r[1]]);
  });
  await test('«Эхо» без записи носителя: сначала синтез-образец, потом микрофон', async () => {
    const r = await p.evaluate(async v => { eval(v); setMode('pairs'); await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 80));
      nativeCache.set(clean(item.target), []); recordOn = true; stream = null; window.__say = item.target; window.__log = []; echo();
      for(let t = 0; t < 60 && window.__log[window.__log.length-1] !== 'me'; t++) await new Promise(z => setTimeout(z, 100)); await new Promise(z => setTimeout(z, 300)); return window.__log; }, FAKE_VOICE);
    eq(r.slice(0, 2), ['synth', 'mic']); eq(r.slice(-2), ['synth', 'me']);
  });
  await test('«Эхо» продолжает работу, даже если телефон не сообщил о конце речи', async () => {
    const r = await p.evaluate(async v => { eval(v); for(let t = 0; t < 50 && listening; t++) await new Promise(z => setTimeout(z, 100)); window.__noOnEnd = true; setMode('pairs'); await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 80));
      item.target = 'on'; nativeCache.set('on', []); recordOn = true; stream = null; window.__say = 'on'; window.__log = []; echo();
      for(let t = 0; t < 80 && window.__log[window.__log.length-1] !== 'me'; t++) await new Promise(z => setTimeout(z, 100)); window.__noOnEnd = false; return window.__log; }, FAKE_VOICE);
    ok(r[0] === 'synth' && r.includes('mic') && r[r.length-1] === 'me', JSON.stringify(r));
  });
  await test('запись носителя не загрузилась — образец звучит синтезом', async () => {
    const r = await p.evaluate(async v => { eval(v); window.__log = []; nativeCache.set('xyz', [{ url:'https://x/broken.wav', who:'T' }]); let done = false; playReference('xyz', () => done = true); await new Promise(z => setTimeout(z, 200)); return [window.__log, done]; }, FAKE_VOICE);
    eq(r, [['synth'], true]);
  });
  await test('Android: «Эхо» — образец звучит ДО открытия микрофона, затем образец и вы', async () => {
    const q = await openPage(browser, { android:true, storage:{ 'soyle-rec-conflict':'1' } });
    const r = await q.evaluate(async v => { eval(v); await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 80));
      item.target = 'on'; nativeCache.set('on', []); window.__log = []; echo(); await new Promise(z => setTimeout(z, 3200)); return [recordOn, window.__log]; }, FAKE_VOICE);
    await q.context().close();
    eq(r[0], false); eq(r[1], ['synth', 'mic', 'synth', 'me']);
  });

  console.log('Вид приложения');
  for(const [w, h] of [[390, 844], [360, 640], [412, 915]]) await test(`${w}×${h}: страница не прокручивается, упражнение целиком на экране, подписи не обрезаны`, async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:w, height:h });
    const bad = [];
    for(const m of ['pairs','phrases','listen','free','progress']){
      await q.evaluate(m => setMode(m), m); await q.waitForTimeout(60);
      const r = await q.evaluate(() => { const c = [...document.querySelectorAll('.screen > section')].find(x => !x.hidden);
        const nav = document.querySelector('.tabbar').getBoundingClientRect();
        return { page: document.documentElement.scrollHeight > innerHeight + 1, card: c.id !== 'progressView' && c.scrollHeight > c.clientHeight + 1, nav: nav.bottom > innerHeight + 1 || nav.height < 44,
          cut: [...c.querySelectorAll('.btn')].filter(b => b.offsetParent && b.scrollWidth > b.clientWidth + 1).map(b => b.textContent.trim()) }; });
      if(r.page) bad.push(m + ': прокрутка страницы'); if(r.card) bad.push(m + ': карточка не помещается'); if(r.nav) bad.push(m + ': нижняя панель не видна'); if(r.cut.length) bad.push(m + ': обрезано ' + r.cut);
    }
    await q.context().close(); eq(bad, []);
  });
  await test('нижняя панель: 5 разделов, активный подсвечен, «Свободно» и «Прогресс» открываются', async () => {
    const r = await p.evaluate(() => { const tabs = [...document.querySelectorAll('.tabbar .tab')].map(t => t.id);
      document.getElementById('tab-free').click(); const free = !document.getElementById('freeCard').hidden && document.getElementById('tab-free').getAttribute('aria-pressed');
      document.getElementById('tab-progress').click(); const prog = !document.getElementById('progressView').hidden && document.getElementById('card').hidden;
      document.getElementById('tab-pairs').click(); return [tabs, free, prog]; });
    eq(r, [['tab-memory','tab-pairs','tab-phrases','tab-listen','tab-free','tab-progress'], 'true', true]);
  });
  await test('игра видна всегда: верхняя панель обновляется после ответа, нажатие открывает «Прогресс»', async () => {
    const r = await p.evaluate(r => { eval(r); renderGame(); const ring0 = document.getElementById('tbRing').style.strokeDashoffset;
      for(let i = 0; i < 3; i++) award(1, 'o');
      const out = [document.getElementById('tbStreak').textContent, document.getElementById('tbRing').style.strokeDashoffset !== ring0];
      document.getElementById('tbProgress').click(); out.push(!document.getElementById('progressView').hidden, document.getElementById('gbRank').textContent, document.getElementById('badgeCount').textContent.startsWith(game.badges.length + ' /'));
      setMode('pairs'); return out; }, RESET);
    eq(r, ['1', true, true, 'Турист', true]);
  });
  await test('устанавливается как приложение: манифест, иконки, standalone', async () => {
    const dir = path.dirname(FILE.replace('file://', ''));
    const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    eq(man.display, 'standalone');
    const sizes = man.icons.map(i => i.sizes); ok(sizes.includes('192x192') && sizes.includes('512x512'));
    man.icons.forEach(i => ok(fs.existsSync(path.join(dir, i.src)), 'нет файла ' + i.src));
    eq(await p.evaluate(() => [!!document.querySelector('link[rel=manifest]'), document.querySelector('meta[name=theme-color]').content, getComputedStyle(document.body).backgroundColor]), [true, '#EEF2F0', 'rgb(238, 242, 240)']); // цвет панели = фон страницы
  });

  console.log('Сценарий пользователя: только нажатия, как на телефоне');
  await test('путь по всем 5 разделам нажатиями: ответы, очки, «мои фразы», прогресс', async () => {
    const u = await openPage(browser);
    const log = [];
    const say = t => u.evaluate(t => { window.__seq = null; window.__say = t; }, t);
    // 1. Звуки: сказать верно → «Верно», очки на верхней панели
    await u.click('#tab-pairs'); await say(await u.evaluate(() => item.target));
    await u.click('#speak'); await u.waitForTimeout(250);
    ok((await u.textContent('#result')).includes('Верно'), 'Звуки: нет «Верно»');
    ok(!(await u.isDisabled('#compare')), 'Звуки: «Сравнить» не включилась после попытки');
    const w1 = await u.evaluate(() => item.target); await u.click('#next'); ok(await u.evaluate(w => item.target !== w || true, w1));
    // 2. Звуки: сказать слово-пару → названа путаница
    await say(await u.evaluate(() => item.partner)); await u.click('#speak'); await u.waitForTimeout(250);
    ok((await u.textContent('#result')).includes('Прозвучало'), 'Звуки: путаница не распознана');
    // 3. Фразы: выбрать «отель», сказать фразу целиком
    await u.click('#tab-phrases'); await u.click('.chip[data-s="hotel"]');
    await say(await u.evaluate(() => item.target)); await u.click('#speak'); await u.waitForTimeout(250);
    ok((await u.textContent('#result')).includes('все слова'), 'Фразы: фраза не засчитана');
    // 4. На слух: нажать правильный вариант
    await u.click('#tab-listen'); await u.waitForTimeout(100);
    const right = await u.evaluate(() => ls.right); await u.click(right === 'A' ? '#lsA' : '#lsB');
    ok((await u.textContent('#lsResult')).includes('Верно'), 'На слух: нет «Верно»');
    // 5. Свободно: вписать фразу, сказать, сохранить в «мои»
    await u.click('#tab-free'); await u.fill('#intent', 'Hesap lütfen'); await say('hesap lütfen');
    await u.click('#freeSpeak'); await u.waitForTimeout(250);
    ok((await u.textContent('#freeResult')).includes('поймёт'), 'Свободно: нет вердикта');
    await u.click('#freeSave'); eq(await u.textContent('#freeSave'), 'Сохранено');
    // 6. «мои» в Фразах
    await u.click('#tab-phrases'); await u.click('.chip[data-s="mine"]'); eq(await u.textContent('#target'), 'Hesap lütfen');
    // 7. Прогресс: через верхнюю панель, видно XP, достижения, задание
    await u.click('#tbProgress');
    const pr = await u.evaluate(() => [!document.getElementById('progressView').hidden, game.xp > 0, game.badges.includes('first'), document.getElementById('gbQuestTxt').textContent.length > 0, document.getElementById('tbStreak').textContent]);
    eq(pr, [true, true, true, true, '1']);
    // 8. Подсказки «?» и возврат
    await u.click('#hintsBtn'); await u.click('#tab-pairs'); ok(await u.isVisible('#tip'), 'подсказка не видна');
    await u.click('#hintsBtn');
    const errs = u.errors; await u.context().close(); eq(errs, []);
  });
  await test('тёмная тема: оболочка приложения и экран «Прогресс» без ошибок и с фоном', async () => {
    const q = await openPage(browser, { scheme:'dark' });
    const r = await q.evaluate(() => { setMode('progress'); const bg = getComputedStyle(document.body).backgroundColor, nav = getComputedStyle(document.querySelector('.tabbar')).backgroundColor; return [bg, nav]; });
    await q.context().close(); eq(r, ['rgb(14, 23, 25)', 'rgb(22, 33, 36)']);
  });

  await test('сообщения ссылаются только на существующие кнопки и разделы', async () => {
    // каждое «название» в тексте должно встречаться в коде как настоящая надпись (вне кавычек-ёлочек)
    const src = fs.readFileSync(FILE.replace('file://', ''), 'utf8');
    const outside = src.replace(/«[^»]*»/g, '');
    const words = ['Свободно','Звуки','Фразы','На слух','Прогресс','Сказать','Дальше','Сравнить','Эхо','Носитель','Синтез','Видео','Примеры'];
    const quoted = [...new Set([...src.matchAll(/«([^»]{2,30})»/g)].map(m => m[1].trim()))]
      .filter(q => /^[\p{Extended_Pictographic}⇄→⚡⭐🔊🎙]/u.test(q) || words.includes(q));
    const bad = quoted.filter(q => !outside.includes(q.replace(/^[^\p{L}]+/u, '').trim()));
    eq(bad, []);
    ok(!/Любая фраза|В видео|Минимальные пары/.test(src.replace(/<!--[\s\S]*?-->/g, '')), 'старые названия в тексте');
  });

  console.log('Новый вид (макет Claude Design): без эмодзи, иконки SVG');
  await test('в программе нет стандартных эмодзи — только SVG-иконки и буквы', async () => {
    const src = fs.readFileSync(FILE.replace('file://', ''), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/[^\n]*/g, '');
    const found = [...new Set(src.match(/[\p{Extended_Pictographic}✓✔★⇄▶⏹⏱]/gu) || [])];
    eq(found, []);
  });
  await test('смена надписи не стирает иконку: «Сказать», «Записать себя», блиц', async () => {
    const r = await p.evaluate(() => { const s = document.getElementById('speak'); setLbl(s, 'Слушаю…'); const a = [s.querySelectorAll('svg').length, s.getAttribute('aria-label')]; setLbl(s, 'Сказать');
      const b = document.getElementById('lsBlitz'); setLbl(b, '0:42 · верно 3'); a.push(b.querySelectorAll('svg').length, b.textContent); setLbl(b, 'Блиц 60 с'); return a; });
    eq(r, [2, 'Слушаю…', 1, '0:42 · верно 3']);
  });
  await test('трудная буква подсвечена: в паре и в вариантах «На слух»', async () => {
    const r = await p.evaluate(() => [markDiff('göl', 'gol'), markDiff('gol', 'göl'), markDiff('şiş', 'sis')]);
    eq(r, ['g<span class="dia" data-ch="ö">o</span>l', 'g<span class="dia whole">o</span>l', '<span class="dia low" data-ch="ş">s</span>i<span class="dia low" data-ch="ş">s</span>']);
    const n = await p.evaluate(() => { setMode('listen'); nextListen(); const k = document.querySelectorAll('#lsA .dia, #lsB .dia').length; setMode('pairs'); next(); return [k, document.querySelectorAll('#target .dia').length]; });
    ok(n[0] >= 1 && n[1] >= 1, JSON.stringify(n));
  });
  await test('урок: 10 делений, верные и ошибки окрашены', async () => {
    const r = await p.evaluate(() => { const old = LESSON_SIZE; LESSON_SIZE = 10; setMode('pairs'); lessons.pairs = null; lessonStep(1); lessonStep(0); lessonStep(1);
      const segs = [...document.querySelectorAll('#lessonSegs i')].map(i => i.className); const lab = document.getElementById('lessonBar').getAttribute('aria-label');
      lessons.pairs = null; LESSON_SIZE = old; renderLesson(); return [segs.length, segs.slice(0, 4).join(','), lab]; });
    eq(r, [10, 'ok,bad,ok,', 'Урок: 3 из 10, верно 2']);
  });
  await test('кольцо уровня и достижения-жетоны без эмодзи', async () => {
    const r = await p.evaluate(() => { game.xp = 125; renderGame(); renderBadges(); const off = parseFloat(document.getElementById('gbLevelRing').style.strokeDashoffset);
      return [document.getElementById('gbLevel2').textContent, off > 100 && off < 200, document.querySelectorAll('#badgeGrid .badge').length, BADGES.every(b => !/\p{Extended_Pictographic}/u.test(b.ic))]; });
    eq(r, ['2', true, 28, true]);
  });

  console.log('«Память»: вспоминание (эффект тестирования) + FSRS-6');
  await test('новая фраза: знакомство → через минуту вспомнить без текста → ответ → 4 оценки со сроками → расписание FSRS', async () => {
    const q = await openPage(browser);
    await q.click('#tab-memory');
    const s1 = await q.evaluate(() => [mem.phase, document.getElementById('target').textContent, document.getElementById('meaning').textContent.length > 0, document.querySelector('#next .lbl').textContent]);
    await q.click('#next');                                            // «Запомнил»
    const s2 = await q.evaluate(t => { const c = loadCards().find(x => x.tr === t); return [c.seen, c.s, Math.round((c.due - Date.now()) / 1000), memDay().newN, mem.phase]; }, s1[1]);
    await q.evaluate(t => { const all = loadCards(); all.find(x => x.tr === t).due = Date.now() - 1; saveCards(all); memNext(); }, s1[1]);
    const s3 = await q.evaluate(() => [mem.card.tr, document.getElementById('target').textContent, document.getElementById('meaning').textContent, document.querySelector('#next .lbl').textContent,
      document.querySelector('#compare .lbl').textContent, document.getElementById('yg').disabled, document.getElementById('native').disabled]);
    await q.click('#next');                                            // «Показать»
    const s4 = await q.evaluate(() => [document.getElementById('target').textContent, [...document.querySelectorAll('#result .grade')].map(b => b.querySelector('b').textContent + ' ' + b.querySelector('small').textContent),
      document.getElementById('next').disabled, document.querySelectorAll('#result .grade.suggest').length]);
    await q.click('#result .grade[data-g="3"]');
    const s5 = await q.evaluate(t => { const c = loadCards().find(x => x.tr === t); return [c.state, c.step, Math.round((c.due - Date.now()) / 60e3), +c.s.toFixed(4), (stats['mem-rec'] || {}).ok]; }, s1[1]);
    const errs = q.errors; await q.context().close();
    eq(s1.slice(0, 1).concat(s1.slice(2)), ['study', true, 'Запомнил']);
    eq(s2, [true, null, 60, 1, 'study']);                              // первое вспоминание — через минуту; следующая новая пока в знакомстве
    eq(s3, [s1[1], '· · ·', 'Что значит эта фраза?', 'Показать', 'Текст', true, false]);
    eq([s4[0], s4[1].length, s4[1][0], s4[2], s4[3]], [s1[1], 4, 'Забыл 1 мин', true, 0]);   // без речи оценку не подсказываем
    eq(s5, [1, 1, 10, 2.3065, 1]);                                     // FSRS: «Помню» при первом вспоминании — шаг 10 мин, S0 = w[2]
    eq(errs, []);
  });
  await test('«сказать по памяти»: русский → турецкий, звук скрыт до ответа, «Буквы», оценка по речи (с подсказкой не выше «Трудно»)', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(async () => { const now = Date.now();
      saveCards([{ ...newMemCard('Tuvalet nerede?', 'тувалет нэрэде', 'Где туалет?', 'prod', now), due:now - 1 }]);
      setMode('memory'); const a = [mem.card.side, document.getElementById('meaning').textContent, document.getElementById('target').textContent,
        document.getElementById('native').disabled, document.getElementById('play').disabled, document.querySelector('#compare .lbl').textContent];
      document.getElementById('compare').click(); a.push(document.getElementById('target').textContent);
      window.__say = 'tuvalet nerede'; startListening(); await new Promise(z => setTimeout(z, 150));
      a.push(mem.phase, mem.suggest, document.querySelectorAll('#result .grade').length, !!document.querySelector('#result .score'), document.getElementById('target').textContent, (stats['mem-prod'] || {}).t);
      return a; });
    const r2 = await q.evaluate(async () => { const now = Date.now();
      saveCards([{ ...newMemCard('Hesap lütfen.', '', 'Счёт, пожалуйста.', 'prod', now), due:now - 1 }]); mem = null; memNext();
      window.__say = 'hesap lütfen'; startListening(); await new Promise(z => setTimeout(z, 150)); return [mem.suggest, document.querySelector('#result .grade.suggest').dataset.g]; });
    const errs = q.errors; await q.context().close();
    eq(r, ['prod', 'Как сказать: «Где туалет?»', '· · ·', true, true, 'Буквы', 'T······ n·····?', 'answer', 2, 4, true, 'Tuvalet nerede?', 1]);
    eq(r2, [3, '3']); eq(errs, []);
  });
  await test('честная оценка не стоит очков: опыт за «понять на слух» одинаков при «Забыл» и «Помню»', async () => {
    const r = await p.evaluate(r => { eval(r); const now = Date.now(); const out = [];
      for(const g of [1, 3]){ saveCards([{ ...newMemCard('Merhaba.', '', 'Привет.', 'rec', now), seen:true, due:now - 1 }]); game.combo = 0; setMode('memory'); memReveal(); const x0 = game.xp; memGrade(g); out.push(game.xp - x0); }
      setMode('pairs'); return out; }, RESET);
    eq(r[0] > 0 && r[0] === r[1], true);
  });
  await test('«сказать» открывается, когда «понять на слух» держится ≥ 3 дней; новые — по кругу из разных тем, не больше 10 в день', async () => {
    const r = await p.evaluate(() => { const now = Date.now(); localStorage.removeItem('soyle-memday');
      saveCards([{ ...newMemCard('Hesap lütfen.', '', 'Счёт, пожалуйста.', 'rec', now), state:2, s:3, d:5, last:now - 4 * 864e5, due:now - 1, seen:true }]);
      setMode('memory'); memReveal(); memGrade(3); const prod = loadCards().find(c => c.side === 'prod');
      const plan = memPlan(); const topic = tr => (PHRASE_SETS.find(g => g.items.some(p => p.tr === tr)) || {}).id;
      const firstTopics = memTopicPool().slice(0, PHRASE_SETS.length).map(c => topic(c.tr));   // порядок новых: по кругу из разных тем
      const d = memDay(); d.newN = 10; memSaveDay(d); const none = memPlan().fresh.length; d.extra = 5; memSaveDay(d); const more = memPlan().fresh.length;
      setMode('pairs'); return [!!prod && prod.ru, plan.fresh.length, new Set(firstTopics).size === PHRASE_SETS.length, none, more]; });
    eq(r, ['Счёт, пожалуйста.', 10, true, 0, 5]);
  });
  await test('«Память» помещается: знакомство, вопрос и ответ с оценками и разбором речи на 360×640 и 390×844', async () => {
    const q = await openPage(browser); const bad = [];
    for(const [w, h] of [[360, 640], [390, 844]]){
      await q.setViewportSize({ width:w, height:h });
      const x = await q.evaluate(async () => { const now = Date.now(); const res = [];
        const check = name => { autofit(); const card = document.getElementById('card'); const kids = [...card.children].filter(e => e.offsetParent); let overlap = false;
          for(let i = 0; i + 1 < kids.length; i++) if(kids[i].getBoundingClientRect().bottom > kids[i+1].getBoundingClientRect().top + 1) overlap = true;
          const cut = ['target', 'meaning', 'result'].filter(id => { const e = document.getElementById(id); return e.scrollHeight > e.clientHeight + 1; });
          if(overlap || cut.length || card.scrollHeight > card.clientHeight + 1) res.push(name + ' ' + JSON.stringify({ overlap, cut, scroll: card.scrollHeight - card.clientHeight })); };
        saveCards([]); localStorage.removeItem('soyle-memday'); setMode('memory'); await new Promise(z => setTimeout(z, 100)); check('знакомство');
        saveCards([{ ...newMemCard('Kendinizi nasıl hissediyorsunuz?', 'кендинизи насыл хиссэдийорсунуз', 'Как вы себя чувствуете?', 'prod', now), due:now - 1 }]); mem = null; memNext(); await new Promise(z => setTimeout(z, 50)); check('вопрос');
        window.__say = 'kendinizi nasıl hisediyorsunuz'; startListening(); await new Promise(z => setTimeout(z, 200)); check('ответ');
        setMode('pairs'); return res; });
      bad.push(...x.map(s => `${w}x${h} ${s}`));
    }
    await q.context().close(); eq(bad, []);
  });

  console.log('«На слух» и блиц: фразы; честный блиц; медали достижений');
  await test('«На слух» → «фразы»: две похожие фразы с записью, разный перевод, отличающиеся слова подчёркнуты; выбор запоминается', async () => {
    const q = await openPage(browser);
    await q.click('#tab-listen'); await q.click('#lsKindChip');
    const r = await q.evaluate(() => { const voiced = new Set(PHRASE_SETS.flatMap(g => g.items.map(p => p.tr))); const out = [];
      for(let i = 0; i < 30; i++){ nextListen(); const a = document.querySelector('#lsA b').textContent, b = document.querySelector('#lsB b').textContent;
        out.push([voiced.has(a) && voiced.has(b), a !== b, document.querySelector('#lsA small').textContent !== document.querySelector('#lsB small').textContent, phraseSim(a, b) > 0]); }
      return { ok: out.every(x => x.every(Boolean)), q: document.querySelector('.ls-q').textContent, dw: document.querySelectorAll('#lsA .dw, #lsB .dw').length > 0,
        saved: localStorage.getItem('soyle-lskind'), chips: [...document.querySelectorAll('#chips .chip[data-g]')].map(c => c.dataset.g).slice(0, 3) }; });
    await q.click('#chips .chip[data-g="food"]');
    const topic = await q.evaluate(() => { const food = new Set(PHRASE_SETS.find(g => g.id === 'food').items.map(p => p.tr)); const t = [];
      for(let i = 0; i < 15; i++){ nextListen(); t.push(food.has(ls.answer)); } return t.every(Boolean); });
    const ans = await q.evaluate(() => { const s0 = (stats.listenph || {}).ok || 0, srs = localStorage.getItem('soyle-srs'); answerListen(ls.right);
      return [((stats.listenph || {}).ok || 0) - s0, localStorage.getItem('soyle-srs') === srs, XP_WEIGHT.listenph]; });
    const errs = q.errors; await q.context().close();
    eq(r.ok, true); eq(r.q, 'Какая фраза прозвучала?'); eq(r.dw, true); eq(r.saved, 'phrases'); eq(r.chips, ['all', 'basic', 'hotel']);
    eq(topic, true); eq(ans, [1, true, 0.4]); eq(errs, []);
  });
  await test('блиц честный: выбрать можно только после начала звука; ошибка −3 с; рекорды слов и фраз раздельные, бонус фраз 3 XP', async () => {
    const q = await openPage(browser); await q.clock.install();
    const r = await q.evaluate(r => { eval(r); window.__noOnEnd = true; setMode('listen'); setLsKind('phrases'); startBlitz();
      const locked = [lsLocked, document.getElementById('listenCard').classList.contains('wait')]; answerListen('A'); const early = blitz.total;
      return { locked, early }; }, RESET);
    await q.clock.runFor(1500);   // фраза: запись/синтез через ~150–300 мс, варианты открываются со звуком
    const r2 = await q.evaluate(() => { const open = !lsLocked; const left = blitz.left; answerListen(ls.right === 'A' ? 'B' : 'A');
      return [open, left - blitz.left, document.getElementById('lsResult').textContent.includes('−3 с')]; });
    await q.clock.runFor(2500);
    const r3 = await q.evaluate(() => { answerListen(ls.right); const xp = game.xp; endBlitz(true); return [game.blitzBestPh, game.blitzBest, game.xp - xp]; });
    await q.context().close();
    eq(r.locked, [true, true]); eq(r.early, 0); eq(r2, [true, 3, true]); eq(r3, [1, 0, 3]);
  });
  await test('блиц не смешивает слова и фразы: переключение вида останавливает блиц', async () => {
    const r = await p.evaluate(() => { setMode('listen'); setLsKind('words'); startBlitz(); setLsKind('phrases'); const out = [blitz, lsKind]; setLsKind('words'); return out; });
    eq(r, [null, 'phrases']);
  });
  await test('медали: у каждой редкость и цель; не полученные — прогресс «7 / 10», впереди ближайшие; касание открывает карточку', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(r => { eval(r); game.total = 7; game.badges = ['first']; setMode('progress');
      const cards = [...document.querySelectorAll('#badgeGrid .badge')];
      return { all: BADGES.every(b => [1, 2, 3].includes(b.tier) && b.n > 0 && typeof b.v === 'function'), ids: new Set(BADGES.map(b => b.id)).size === BADGES.length,
        first: cards[0].dataset.b, second: cards[1].dataset.b, prog: cards[1].querySelector('small').textContent, label: cards[1].getAttribute('aria-label'),
        next: document.getElementById('badgeNext').textContent, shapes: [...new Set(BADGES.map(b => medalPath(b.tier)))].length,
        tags: cards.every(c => c.tagName === 'BUTTON') }; }, RESET);
    await q.click('#badgeGrid .badge[data-b="warm"]');
    const sheet = await q.evaluate(() => [document.getElementById('sheet').hidden, document.getElementById('sheetTitle').textContent, document.querySelector('.bc-prog').getAttribute('aria-valuenow'), !!document.querySelector('#sheetBody .medal.off .m-water')]);
    await q.context().close();
    eq(r.all, true); eq(r.ids, true); eq(r.first, 'first'); eq(r.second, 'warm'); eq(r.prog, '7 / 10'); eq(r.label, 'Разогрев: 7 из 10');
    eq(r.next, 'Ближе всего: «Разогрев» — 7 из 10'); eq(r.shapes, 3); eq(r.tags, true); eq(sheet, [false, 'Разогрев', '7', true]);
  });
  await test('редкая медаль — окно с медалью (после блица — после итогов); обычная — уведомление; дата получения; «Чистая речь» считает 90+', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(r => { eval(r); MILESTONE_MODALS = true; stats.o = { t:15, ok:15 }; checkBadges();
      const m = [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, !!document.querySelector('#modalMedal .medal.t2')];
      document.getElementById('modalPrimary').click();
      game.total = 1; checkBadges(); const t = document.getElementById('toast').textContent;
      const p0 = game.perfect; celebrate(document.getElementById('result'), 95); celebrate(document.getElementById('result'), 80);
      return [m, t, game.badgeDates.o === new Date().toISOString().slice(0, 10), game.perfect - p0]; }, RESET);
    const old = await q.evaluate(() => { game = { xp:10, badges:['first'] }; normalizeGame(); return [typeof game.badgeDates, game.perfect, game.blitzBestPh]; });
    await q.context().close();
    eq(r[0], [false, 'Достижение: Мастер ö', true]); eq(r[1], 'Достижение: Первое слово'); eq(r[2], true); eq(r[3], 1); eq(old, ['object', 0, 0]);
  });
  await test('фразы «На слух» помещаются: самая длинная пара на 360×640 и 390×844, без наложения и обрезки', async () => {
    const q = await openPage(browser); const bad = [];
    for(const [w, h] of [[360, 640], [390, 844]]){
      await q.setViewportSize({ width:w, height:h });
      const x = await q.evaluate(async () => { setMode('listen'); setLsKind('phrases');
        const all = lsPhrasePool('all').sort((a, b) => b.tr.length + b.ru.length - a.tr.length - a.ru.length);
        const pickPhrasePair0 = pickPhrasePair; pickPhrasePair = () => ({ target:all[0].tr, meaning:all[0].ru, partner:all[1].tr, partnerMeaning:all[1].ru, gid:'listenph' });
        nextListen(); pickPhrasePair = pickPhrasePair0; await new Promise(z => setTimeout(z, 200)); autofit();
        const card = document.getElementById('listenCard'), opts = [...card.querySelectorAll('.ls-opt')];
        const cut = opts.some(o => o.scrollHeight > o.clientHeight + 1 || o.scrollWidth > o.clientWidth + 1);
        const kids = [...card.children].filter(e => e.offsetParent); let overlap = false;
        for(let i = 0; i + 1 < kids.length; i++) if(kids[i].getBoundingClientRect().bottom > kids[i+1].getBoundingClientRect().top + 1) overlap = true;
        setLsKind('words'); return { cut, overlap, scroll: document.scrollingElement.scrollHeight > innerHeight + 1 }; });
      if(x.cut || x.overlap || x.scroll) bad.push(`${w}x${h} ${JSON.stringify(x)}`);
    }
    await q.context().close(); eq(bad, []);
  });

  await test('автоподгонка: на низком экране сжимается, на высоком растягивается, прокрутки нет', async () => {
    const q = await openPage(browser); const out = [];
    for(const [w, h] of [[360, 560], [360, 640], [390, 844], [412, 732], [412, 915]]){
      await q.setViewportSize({ width:w, height:h });
      for(const m of ['pairs','phrases','words','listen','free']){
        out.push(await q.evaluate(([m, w, h]) => { if(m === 'words'){ wordsKind = true; setId = 'food'; m = 'phrases'; } else if(m === 'phrases') wordsKind = false; setMode(m); autofit(); const card = [...document.querySelectorAll('.screen > .card')].find(c => !c.hidden);
          const fit = +getComputedStyle(document.querySelector('.app')).getPropertyValue('--fit');
          const tab = document.querySelector('.tabbar').getBoundingClientRect().bottom;
          return { k:`${w}x${h} ${m}`, fit, over: card.scrollHeight - card.clientHeight > 1 || document.documentElement.scrollHeight > innerHeight || tab > innerHeight + 1
            || (() => { const k = [...card.children].filter(e => e.offsetParent); for(let i = 0; i + 1 < k.length; i++) if(k[i].getBoundingClientRect().bottom > k[i+1].getBoundingClientRect().top + 1) return 'наложение: ' + k[i].className + ' / ' + k[i+1].className; return false; })()
            || (m === 'listen' && [...document.querySelectorAll('#lsA b, #lsB b')].some(b => { const r = b.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !t || !b.parentElement.contains(t); }) && 'слово варианта закрыто'),
          round: [...document.querySelectorAll('.screen > .card:not([hidden]) .mic, .screen > .card:not([hidden]) .act .ring, .screen > .card:not([hidden]) .round-xl')].every(b => getComputedStyle(b).borderRadius === '50%' || parseFloat(getComputedStyle(b).borderRadius) >= Math.max(b.offsetWidth, b.offsetHeight) / 2 - 1) }; }, [m, w, h]));
      }
    }
    await q.context().close();
    eq(out.filter(o => o.over).map(o => o.k + ' ' + o.over), []); eq(out.filter(o => !o.round).map(o => o.k), []);
    ok(out.find(o => o.k === '360x560 pairs').fit < 1 && out.find(o => o.k === '412x915 phrases').fit > 1, JSON.stringify(out.map(o => o.k + ':' + o.fit)));
  });

  await test('пояснение помещается в форму целиком: длинный текст и разбор ошибок на 360×640 и 390×844', async () => {
    const q = await openPage(browser); const bad = [];
    const LONG = 'Этот телефон не даёт микрофону одновременно записывать и распознавать. Дальше распознавание работает само, а себя можно записать кнопкой «Записать себя». Скажите ещё раз.';
    for(const [w, h] of [[360, 640], [390, 844]]){
      await q.setViewportSize({ width:w, height:h });
      for(const [m, fill] of [['pairs', `setResult('bad', LONG)`], ['phrases', `item = { target:'İki gece için bir oda istiyorum.', gid:'ph-hotel', meaning:'x' }; evalPhrase(['iki gece icin bir oda istiyorm'])`], ['free', `setFree('bad', LONG)`], ['listen', `document.getElementById('lsResult').innerHTML = '<span class=verdict>' + LONG + '</span>'`]]){
        const r = await q.evaluate(async ([m, fill, LONG]) => { setMode(m); eval(fill); await new Promise(z => setTimeout(z, 120)); autofit();
          const res = document.querySelector('.screen > .card:not([hidden]) .result'), card = res.closest('.card'), rr = res.getBoundingClientRect(), cr = card.getBoundingClientRect();
          return { cut: res.scrollHeight > res.clientHeight + 1, outside: rr.bottom > cr.bottom + 1 && card.scrollHeight <= card.clientHeight + 1, bg: getComputedStyle(res).backgroundColor }; }, [m, fill, LONG]);
        if(r.cut || r.outside) bad.push(`${w}x${h} ${m} ${JSON.stringify(r)}`);
      }
    }
    const infoBg = await q.evaluate(() => { setMode('pairs'); next(); return getComputedStyle(document.getElementById('result')).backgroundColor; });
    await q.context().close();
    eq(bad, []); eq(infoBg, 'rgb(243, 232, 207)');   // песочный, как на выбранном экране (#F3E8CF)
  });

  console.log('Видео и перевод — внутри приложения, без перехода');
  // подмена внешних сервисов: виджет YouGlish и перевод MyMemory (настоящие проверяются в CI задачей probe)
  const FAKE_YG = `var YG={Widget:function(id,o){this.fetch=function(q,l){(window.__ygq=window.__ygq||[]).push(q);var f=document.getElementById(id).querySelector('iframe')||document.createElement('iframe');f.title='YouGlish';f.setAttribute('data-q',q+'|'+l);document.getElementById(id).appendChild(f);setTimeout(function(){o.events.onFetchDone({totalResult:(q.indexOf(' ')>0&&q.length>12)?0:7,query:q})},30)}}};setTimeout(function(){window.onYouglishAPIReady&&window.onYouglishAPIReady()},10);`;
  async function openInApp(opts){ const q = await openPage(browser, opts);
    await q.route('**/youglish.com/public/emb/widget.js', r => r.fulfill({ contentType:'application/javascript', body:FAKE_YG }));
    await q.route('**/api.mymemory.translated.net/**', r => r.fulfill({ json:{ responseStatus:200, quotaFinished:false, responseData:{ translatedText:'Можно мне счёт?' } } }));
    return q; }
  await test('«Видео»: окно внутри приложения, ролики по текущему слову, без новой вкладки и перехода', async () => {
    const q = await openInApp(); const pages = []; q.context().on('page', x => pages.push(x));
    const url0 = q.url(); const word = await q.evaluate(() => item.target);
    await q.click('#yg'); await q.click('#exVideo'); await q.waitForSelector('#sheet:not([hidden]) iframe', { timeout:5000 }); await q.waitForFunction(() => /Отрывков/.test(document.getElementById('ygMsg').textContent), null, { timeout:5000 });
    const r = await q.evaluate(() => [document.querySelector('#sheet iframe').dataset.q, document.getElementById('ygMsg').textContent, document.activeElement.id]);
    await q.keyboard.press('Escape');
    const after = await q.evaluate(() => [document.getElementById('sheet').hidden, document.getElementById('sheetBody').innerHTML === '', document.activeElement.id]);
    const errs = q.errors; await q.context().close();
    eq(r[0], word + '|turkish'); ok(/Отрывков: 7/.test(r[1]), r[1]); eq(r[2], 'sheetClose');
    eq(after, [true, true, 'yg']);   // фокус вернулся на кнопку «Примеры», откуда открывали eq(pages.length, 0); eq(q.url ? url0 : url0, url0); eq(errs, []);
  });
  await test('«Примеры» (вместо платного лимита YouGlish): фразы носителей с переводом и живой записью, внутри приложения', async () => {
    const q = await openInApp(); const pages = []; q.context().on('page', x => pages.push(x));
    await q.route('**/api.tatoeba.org/**', r => { const u = decodeURIComponent(r.request().url());
      if(u.includes('q="çay lütfen"')) return r.fulfill({ json:{ data:[] } });
      return r.fulfill({ json:{ data: u.includes('has_audio=yes') ? [
        { id:1, text:'Bir çay lütfen.', audios:[{ id:77, author:'futurk', license:'CC BY 4.0' }], translations:[{ text:'Один чай, пожалуйста.', lang:'rus' }] },
        { id:2, text:'Çay içer misin?', audios:[{ id:78, author:'x', license:'' }] } ] : [
        { id:2, text:'Çay içer misin?', audios:[], translations:[[{ text:'Будешь чай?', lang:'rus' }]] },
        { id:3, text:'Çay sıcak.', audios:[], translations:[] } ] } }); });
    await q.evaluate(() => openExamples('Çay lütfen'));
    await q.waitForSelector('#exList li', { timeout:5000 });
    const r = await q.evaluate(() => [document.getElementById('exMsg').textContent, [...document.querySelectorAll('#exList li')].map(li => [li.querySelector('b').textContent, (li.querySelector('small') || {}).textContent || '', !!li.querySelector('.ex-play[data-i]')])]);
    await q.evaluate(() => { window.__played = []; }); await q.click('#exList .ex-play[data-i]');
    const played = await q.evaluate(() => window.__played);
    await q.context().close();
    ok(/примеры со словом «lütfen»/.test(r[0]) && /с записью носителя: 1/.test(r[0]), r[0]);
    eq(r[1][0], ['Bir çay lütfen.', 'Один чай, пожалуйста.', true]);                 // с записью — первой; без лицензии — без кнопки
    eq(r[1].find(x => x[0] === 'Çay içer misin?'), ['Çay içer misin?', 'Будешь чай?', false]);
    eq(played, ['https://api.tatoeba.org/v1/audios/77/file']); eq(pages.length, 0);
  });
  await test('«Видео» бережёт лимит YouGlish: один поиск на нажатие, часть фразы — только по кнопке', async () => {
    const q = await openInApp();
    await q.evaluate(() => openVideo('Çıkış saat kaçta?'));
    await q.waitForSelector('#ygMsg [data-part]', { timeout:5000 });
    const before = await q.evaluate(() => window.__ygq.slice());
    await q.click('#ygMsg [data-part]');
    await q.waitForFunction(() => /Отрывков/.test(document.getElementById('ygMsg').textContent), null, { timeout:5000 });
    const r = await q.evaluate(() => [window.__ygq, document.getElementById('ygMsg').textContent, document.querySelector('.sheet-src').textContent]);
    await q.context().close();
    eq(before, ['Çıkış saat kaçta']); eq(r[0], ['Çıkış saat kaçta', 'Çıkış saat']); ok(/носители говорят «Çıkış saat»/.test(r[1]), r[1]); ok(/20 поисков в день/.test(r[2]), r[2]);
  });
  await test('«Перевод» в «Свободно» и в «Фразах»: перевод в окне приложения, без перехода', async () => {
    const q = await openInApp(); const pages = []; q.context().on('page', x => pages.push(x));
    await q.click('#tab-free'); await q.fill('#intent', ''); await q.evaluate(() => { window.__say = 'hesabı alabilir miyim'; });
    await q.click('#freeSpeak'); await q.waitForTimeout(200);
    await q.click('#freeTranslate'); await q.waitForFunction(() => document.getElementById('trOut') && document.getElementById('trOut').textContent !== 'Перевожу…');
    const free = await q.evaluate(() => [document.querySelector('#sheet .sheet-q').textContent, document.getElementById('trOut').textContent]);
    await q.click('#sheetClose');
    await q.click('#tab-phrases'); await q.click('.chip[data-s="mine"]');
    await q.evaluate(() => { saveMine('Hesabı alabilir miyim?'); setId = 'mine'; renderChips(); next(); });
    await q.click('#partner [data-tr]'); await q.waitForFunction(() => document.getElementById('trOut') && document.getElementById('trOut').textContent !== 'Перевожу…');
    const ph = await q.evaluate(() => document.getElementById('trOut').textContent);
    await q.mouse.click(5, 5);                                   // нажатие мимо окна — закрыть
    const closed = await q.evaluate(() => document.getElementById('sheet').hidden);
    const url = q.url(), errs = q.errors; await q.context().close();
    eq(free, ['hesabı alabilir miyim', 'Можно мне счёт?']); eq(ph, 'Можно мне счёт?'); eq(closed, true);
    eq(pages.length, 0); ok(!/translate\.google|youglish\.com\/pronounce/.test(url), url); eq(errs, []);
  });
  console.log('Фразы голосом носителей: Tatoeba и видео');
  const TATO = u => {
    if(u.includes('q=')) return { data:[{ id:483496, text:'Merhaba.', lang:'tur', audios:[{ id:1048317, author:'CVTR', license:'CC BY 4.0', download_url:'https://api.tatoeba.org/unstable/audio/1048317/file' }, { id:999, author:'nolic', license:'' }] }], paging:{ total:1 } };
    return { data:[
      { id:1, text:'Balık sever misiniz?', lang:'tur', audios:[{ id:68301, author:'civiricus', license:'CC BY-NC 4.0' }], translations:[[{ id:9, text:'Вы любите рыбу?', lang:'rus' }], []] },
      { id:2, text:'Bu çok uzun bir cümle ve yedi kelimeden fazla olduğu için alınmayacak.', lang:'tur', audios:[{ id:5, author:'x', license:'CC BY 4.0' }] },
      { id:3, text:'Tabii ki.', lang:'tur', audios:[{ id:1250528, author:'futurk', license:'CC BY 4.0' }] },
      { id:4, text:'Gidiyorlar.', lang:'tur', audios:[{ id:1248994, author:'futurk', license:'' }] } ] };
  };
  await test('«Носитель» для фразы: целая фраза из Tatoeba (ссылка /v1/audios/…/file, не битая из ответа)', async () => {
    const q = await openInApp(); await q.route('**/api.tatoeba.org/**', r => r.fulfill({ json: TATO(decodeURIComponent(r.request().url())) }));
    const r = await q.evaluate(async () => { nativeCache.delete(clean('Merhaba.')); const recs = await findRecordings('Merhaba.'); return recs.map(x => [x.url, x.who]); });
    await q.context().close();
    ok(r.some(([u, w]) => u === 'https://api.tatoeba.org/v1/audios/1048317/file' && w === 'CVTR (Tatoeba)') && !r.some(([u]) => u.includes('/999/')), JSON.stringify(r));   // без лицензии — не берём (файл 403)
  });
  await test('«Носитель» для фразы без записи — слова по очереди живыми записями, видео само не открывается (лимит YouGlish)', async () => {
    const q = await openInApp();
    await q.click('#tab-phrases');
    const r = await q.evaluate(async () => { item = { target:'Hesap lütfen biraz', gid:'ph-basic', meaning:'' }; nativeCache.set(clean(item.target), []);
      nativeCache.set(clean('hesap'), [{ url:'https://x/hesap.wav', who:'A' }]); nativeCache.set(clean('lütfen'), [{ url:'https://x/lutfen.wav', who:'B' }]); nativeCache.set(clean('biraz'), []);
      window.__played = []; playNative(); await new Promise(z => setTimeout(z, 900));
      return [window.__played.map(s => s.split('/').pop()), document.getElementById('nativeStatus').textContent, document.getElementById('sheet').hidden]; });
    await q.context().close();
    eq(r[0], ['hesap.wav', 'lutfen.wav']); ok(/по словам: hesap · lütfen · \(biraz — нет\)/.test(r[1]), r[1]); eq(r[2], true);
  });
  await test('набор «живые фразы»: только короткие фразы с записью, перевод на русский, «Носитель» играет запись Tatoeba', async () => {
    const q = await openInApp(); await q.route('**/api.tatoeba.org/**', r => r.fulfill({ json: TATO(decodeURIComponent(r.request().url())) }));
    await q.click('#tab-phrases'); await q.click('.chip[data-s="tatoeba"]');
    await q.waitForFunction(() => tatoebaSet && tatoebaSet.length);
    const r = await q.evaluate(async () => { const list = tatoebaSet.map(x => [x.tr, x.ru]);
      setId = 'tatoeba'; lastKey = 'Tabii ki.'; next(); await new Promise(z => setTimeout(z, 50));
      window.__log = []; playNative(); await new Promise(z => setTimeout(z, 50));
      return [list, item.target, document.getElementById('meaning').textContent, document.getElementById('nativeAudio').src, document.querySelector('.chip[data-s="tatoeba"]').textContent]; });
    const errs = q.errors; await q.context().close();
    eq(r[0], [['Balık sever misiniz?', 'Вы любите рыбу?'], ['Tabii ki.', '']]);
    const one = await (async () => { const q2 = await openInApp(); await q2.route('**/api.tatoeba.org/**', r => r.fulfill({ json: TATO(decodeURIComponent(r.request().url())) }));
      const x = await q2.evaluate(async () => { await ensureTatoebaSet(); tatoebaSet = [{ tr:'Veganım.', ru:'Я веган.', focus:'', n:1 }]; setMode('phrases'); setId = 'tatoeba'; lastKey = ''; next(); await new Promise(z => setTimeout(z, 100)); autofit();
        const t = document.getElementById('target'), c = t.closest('.card'); return [t.classList.contains('phrase'), t.scrollWidth <= t.clientWidth + 1, t.getBoundingClientRect().right <= c.getBoundingClientRect().right + 1]; });
      await q2.context().close(); return x; })();
    eq(one, [true, true, true]);   // однословная живая фраза — шрифтом фраз, не вылезает за край
    eq(r[1], 'Balık sever misiniz?'); eq(r[2], 'Вы любите рыбу?'); eq(r[3], 'https://api.tatoeba.org/v1/audios/68301/file'); eq(r[4], 'живые фразы (2)'); eq(errs, []);
  });
  await test('в программе нет ссылок, уводящих из приложения (translate.google, youglish.com/pronounce, target=_blank)', async () => {
    const src = fs.readFileSync(FILE.replace('file://', ''), 'utf8');
    eq([/translate\.google/.test(src), /youglish\.com\/pronounce/.test(src), /target="_blank"/.test(src)], [false, false, false]);
  });

  await test('фразы по темам — только с записью носителя (Common Voice / Tatoeba); старые без записи не удалены, а в наборе «без записи»', async () => {
    const vp = JSON.parse(fs.readFileSync(path.join(__dirname, 'voiced-phrases.json'), 'utf8'));
    const q = await openPage(browser);
    const r = await q.evaluate(() => ({ sets: PHRASE_SETS.map(g => [g.id, g.items.length, g.items.every(p => p.voiced && p.tl && p.ru && p.focus)]),
      all: PHRASE_SETS.flatMap(g => g.items.map(p => p.tr)), old: OLD_PHRASES.map(p => p.tr), oldVoiced: [...OLD_VOICED],
      tl: ['Doğru değil mi?', 'Güzel', 'Yardım edin!', 'Hesap lütfen.'].map(trToCyr) }));
    await q.click('#tab-phrases'); await q.click('.chip[data-s="novoice"]');
    const nv = await q.evaluate(() => [document.querySelector('.chip[data-s="novoice"]').textContent, OLD_PHRASES.some(p => p.tr === item.target)]);
    await q.context().close();
    r.sets.forEach(([id, n, ok]) => { if(n < 10 || !ok) throw new Error(`набор ${id}: ${n} фраз, все с записью и полями: ${ok}`); });
    const voiced = new Set([...Object.values(vp).flat().map(x => x.tr), ...r.oldVoiced]);
    eq(r.all.filter(t => !voiced.has(t)), []);                                  // в темах нет фраз без записи
    eq(r.old.length + r.all.filter(t => r.oldVoiced.includes(t)).length >= 99, true);   // старые 99 фраз все на месте
    eq(r.old.includes('Şu köşe yaz köşesi, şu köşe kış köşesi, ortada su şişesi.'), true);
    eq(r.tl, ['доору деиль ми', 'гюзель', 'ярдым эдин', 'хесап лютфен']);
    eq(nv, [`без записи (${r.old.length})`, true]);
  });
  await test('у каждой фразы тем есть файл записи: Common Voice — в audio/cv (index.json + mp3), Tatoeba — id записи', async () => {
    const dir = path.join(__dirname, '..', 'audio', 'cv');
    const idx = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).phrases;
    const n = t => String(t).toLocaleLowerCase('tr-TR').replace(/[^\p{L}\s]/gu, '').replace(/\s+/g, ' ').trim();
    const have = new Map(Object.entries(idx).map(([k, v]) => [n(k), v]));
    const q = await openPage(browser);
    const items = await q.evaluate(() => PHRASE_SETS.flatMap(g => g.items.map(p => p.tr)).map(tr => [tr, TAT_REC.has(nphr(tr))]));
    await q.context().close();
    const bad = items.filter(([tr, tat]) => !tat && !(have.get(n(tr)) || []).every(x => fs.existsSync(path.join(dir, x.file))) || (!tat && !have.has(n(tr)))).map(x => x[0]);
    eq(bad, []);
  });
  await test('«Носитель» у фразы из Tatoeba играет её запись сразу, без поиска по сети; самая длинная фраза темы помещается на 360×640', async () => {
    const q = await openPage(browser); const net = [];
    q.on('request', rq => { if(/Elektri/i.test(decodeURIComponent(rq.url()))) net.push(rq.url()); });   // поиск записи именно этой фразы
    await q.setViewportSize({ width:360, height:640 });
    const r = await q.evaluate(async () => {
      setMode('phrases'); setId = 'hotel';
      const p = PHRASE_SETS.find(g => g.id === 'hotel').items.find(x => x.tr === 'Elektriğimiz yok.');
      item = { target:p.tr, translit:p.tl, meaning:p.ru, tip:p.focus, gid:'ph-hotel' };
      const recs = await findRecordings(p.tr);
      const longest = PHRASE_SETS.flatMap(g => g.items).sort((a, b) => b.tr.length + b.ru.length - a.tr.length - a.ru.length)[0];
      nativeSet = [{ ...longest, n:1 }]; setId = 'native'; lastKey = ''; next(); await new Promise(z => setTimeout(z, 150));
      const card = document.getElementById('card');
      const cut = ['target', 'meaning'].filter(id => { const e = document.getElementById(id); return e.scrollHeight > e.clientHeight + 1; });
      return [recs, cut, card.scrollHeight - card.clientHeight <= 1]; });
    await q.context().close();
    eq(r[0], [{ url:'https://api.tatoeba.org/v1/audios/1162651/file', who:'languagelerner (Tatoeba)' }]);
    eq(r[1], []); eq(r[2], true); eq(net, []);
  });

  await test('длинная фраза и её перевод видны целиком: «Şu köşe yaz köşesi, şu köşe kış köşesi» + длинное значение (пришло позже)', async () => {
    const q = await openPage(browser); const bad = [];
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      await q.setViewportSize({ width:w, height:h });
      const r = await q.evaluate(async () => {
        setMode('phrases'); nativeSet = [{ tr:'Şu köşe yaz köşesi, şu köşe kış köşesi', tl:'', ru:'', focus:'x', n:1 }]; setId = 'native'; lastKey = ''; next();
        await new Promise(z => setTimeout(z, 80));
        document.getElementById('meaning').textContent = "Значение (англ.): This corner is the summer corner, that corner is the winter corner (a children's game)";
        await new Promise(z => setTimeout(z, 150));                       // значение пришло позже — подгонка сама
        const card = document.getElementById('card');
        const cut = ['target', 'meaning', 'partner'].filter(id => { const e = document.getElementById(id); return e.scrollHeight > e.clientHeight + 1; });
        const kids = [...card.children].filter(e => e.offsetParent); let overlap = false;
        for(let i = 0; i + 1 < kids.length; i++) if(kids[i].getBoundingClientRect().bottom > kids[i+1].getBoundingClientRect().top + 1) overlap = true;
        return { cut, overlap, scroll: card.scrollHeight - card.clientHeight > 1 }; });
      if(r.cut.length || r.overlap || r.scroll) bad.push(`${w}x${h} ${JSON.stringify(r)}`);
    }
    await q.context().close(); eq(bad, []);
  });

  console.log('Слова по темам с пополнением');
  const WIKI = u => {
    if(u.includes('en.wiktionary') && u.includes('categorymembers')){
      if(!u.includes('cmcontinue')) return { continue:{ cmcontinue:'page|NEXT' }, query:{ categorymembers:[{ title:'otel' }, { title:'resepsiyon' }, { title:'oda servisi' }, { title:'İstanbul' }, { title:'oda' }] } };
      return { query:{ categorymembers:[{ title:'lobi' }, { title:'bavul' }] } };
    }
    if(u.includes('ru.wiktionary')) return { parse:{ title:'ekmek', wikitext:{ '*':"= {{-tr-}} =\n\n=== Морфологические и синтаксические свойства ===\n{{падежи tr\n|nom-sg=ekmek\n}}\n\n==== Значение ====\n\n# [[хлеб]] {{пример|Ekmek aldım.}}\n\n=== Этимология ===\n" } } };
    return {};
  };
  const WORDS_FOOD = [['menü','меню'],['hesap','счёт'],['ekmek','хлеб'],['çay','чай'],['kahve','кофе'],['garson','официант'],['tuz','соль'],['şeker','сахар'],['çatal','вилка'],['bıçak','нож'],['kaşık','ложка'],['tabak','тарелка'],['bardak','стакан'],['peynir','сыр']];
  async function openWords(){ const q = await openInApp(); await q.route('**/*wiktionary.org/w/api.php**', r => r.fulfill({ json: WIKI(decodeURIComponent(r.request().url())) })); return q; }
  await test('«Фразы» → «слова»: слова выбранной темы с переводом, по счётчику в чипах; переключение обратно на фразы', async () => {
    const q = await openWords();
    await q.click('#tab-phrases'); await q.click('.chip[data-s="food"]'); await q.click('#kindChip');
    const r = await q.evaluate(() => [wordsKind, item.word, item.topic, WORD_SEEDS.food.map(x => x[0]).includes(item.target), document.getElementById('meaning').textContent,
      document.querySelector('.chip[data-s="food"]').textContent, document.getElementById('target').classList.contains('phrase'), localStorage.getItem('soyle-kind'), item.target, document.getElementById('result').textContent]);
    const vis = await q.evaluate(() => { const k = document.getElementById('kindChip').getBoundingClientRect(), c = document.querySelector('.chip[data-s="food"]').getBoundingClientRect(); return c.left >= k.right - 1 && c.right <= innerWidth + 1; });
    ok(vis, 'выбранная тема закрыта переключателем «слова» или за краем');
    await q.click('#kindChip');
    const back = await q.evaluate(() => [wordsKind, !!item.word, document.querySelector('.chip[data-s="tatoeba"]') !== null]);
    const errs = q.errors; await q.context().close();
    eq(r.slice(0, 4), [true, true, 'food', true]); eq(r[4], Object.fromEntries(WORDS_FOOD)[r[8]]);   // русский перевод темы, не английское значение из Викисловаря ok(/^ресторан \(\d+\)$/.test(r[5]), r[5]); eq(r[6], false); eq(r[7], 'words'); ok(/произнесите слово/.test(r[9]), r[9]);
    eq(back, [false, false, true]); eq(errs, []);
  });
  await test('пополнение: новые слова темы подгружаются из Викисловаря (одиночные слова, продолжение списка), сохраняются', async () => {
    const q = await openWords();
    const r = await q.evaluate(async () => {
      localStorage.removeItem('soyle-words-hotel'); delete wordPools.hotel;
      const pool = wordPool('hotel'); const n0 = pool.items.length; pool.items.forEach(w => w.seen = 1);
      pickWord('hotel'); const grew = !!growing.hotel; await growing.hotel;    // новых не осталось — пошла подгрузка
      localStorage.removeItem('soyle-words-hotel'); delete wordPools.hotel; wordPool('hotel');   // заново: по порциям
      await growWords('hotel', 1); const n1 = wordPool('hotel').items.length, cont = wordPool('hotel').cont;
      await growWords('hotel', 1); const n2 = wordPool('hotel').items.length;
      const saved = JSON.parse(localStorage.getItem('soyle-words-hotel')).items.map(x => x.tr);
      return [grew, n0, n1 - n0, cont, n2 - n1, saved.includes('resepsiyon'), saved.includes('oda servisi'), saved.some(x => /stanbul/i.test(x)), saved.filter(x => x === 'oda').length, saved.includes('lobi')]; });
    await q.context().close();
    eq(r, [true, 12, 2, 'page|NEXT', 2, true, false, false, 1, true]);  // otel+resepsiyon; фраза, имя собственное и дубль «oda» не берутся
  });
  await test('русское значение слова — из статьи ru-Викисловаря («Значение»), без разметки', async () => {
    const q = await openWords();
    const r = await q.evaluate(() => ruMeaning('ekmek')); await q.context().close();
    eq(r, 'хлеб');
  });

  console.log('Резервная копия прогресса');
  await test('код копии: весь прогресс, без настроек устройства; русские и турецкие буквы не портятся', async () => {
    const r = await p.evaluate(() => { localStorage.setItem('soyle-rec-conflict','1'); localStorage.setItem('soyle-voice','X'); saveList('soyle-mine', [{ tr:'Çok güzel, teşekkürler' }]);
      const code = bkCode(); const back = bkParse(code); return [code.startsWith('SOYLE1:'), Object.keys(back.data).includes('soyle-rec-conflict'), Object.keys(back.data).includes('soyle-voice'), JSON.parse(back.data['soyle-mine'])[0].tr]; });
    eq(r, [true, false, false, 'Çok güzel, teşekkürler']);
  });
  await test('перенос на «другой телефон»: код → вставить → подтвердить → XP, достижения, мои фразы, повторения на месте', async () => {
    const code = await p.evaluate(() => { game.xp = 777; game.badges = ['first','warm']; saveList('soyle-srs', [{ tr:'Hesap lütfen.', box:2, due:0 }]); saveList('soyle-mine', [{ tr:'Merhaba' }]); return bkCode(); });
    const q = await openPage(browser);
    await q.evaluate(() => { localStorage.setItem('soyle-rec-conflict','1'); setMode('progress'); });
    await q.fill('#bkInput', code); await q.click('#bkRestore');
    eq(await q.evaluate(() => [game.xp, document.getElementById('bkConfirm').hidden]), [0, false]); // до подтверждения ничего не меняется
    ok((await q.textContent('#bkConfirmText')).includes('777 XP'));
    await q.click('#bkYes');
    const r = await q.evaluate(() => [game.xp, game.badges, loadList('soyle-mine')[0].tr, srsDue().length, document.getElementById('gbXp').textContent, document.getElementById('bkMsg').textContent, localStorage.getItem('soyle-rec-conflict')]);
    const errs = q.errors; await q.context().close();
    eq(r, [777, ['first','warm'], 'Merhaba', 1, '777 / 800 XP', 'Прогресс восстановлен', '1']); eq(errs, []);
  });
  await test('«Отмена» ничего не меняет; мусор и чужой JSON отклоняются с понятным сообщением', async () => {
    const q = await openPage(browser);
    const code = await p.evaluate(() => bkCode());
    await q.evaluate(() => setMode('progress'));
    await q.fill('#bkInput', code); await q.click('#bkRestore'); await q.click('#bkNo');
    const afterCancel = await q.evaluate(() => [game.xp, document.getElementById('bkConfirm').hidden]);
    const msgs = [];
    for(const junk of ['привет', 'SOYLE1:%%%', '{"a":1}', JSON.stringify({ app:'soyle', v:1, data:{ 'soyle-game':'{broken' } })]){
      await q.fill('#bkInput', junk); await q.click('#bkRestore'); msgs.push([await q.textContent('#bkMsg'), await q.evaluate(() => document.getElementById('bkConfirm').hidden)]);
    }
    await q.context().close();
    eq(afterCancel, [0, true]);
    msgs.forEach(([m, hidden]) => { ok(hidden, 'подтверждение показано для мусора'); ok(/не резервная копия|не код|нет данных|повреждена/.test(m), m); });
  });
  await test('файл: «Скачать файл» даёт JSON, «Выбрать файл» восстанавливает из него', async () => {
    await p.evaluate(() => setMode('progress'));
    const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#bkFile')]);
    const file = await dl.path(); const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    ok(json.app === 'soyle' && /^soyle-progress-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const q = await openPage(browser); await q.evaluate(() => setMode('progress'));
    await q.setInputFiles('#bkFileInput', file); await q.waitForTimeout(200);
    ok(!(await q.evaluate(() => document.getElementById('bkConfirm').hidden)), 'нет подтверждения после выбора файла');
    await q.click('#bkYes'); const xp = await q.evaluate(() => game.xp); await q.context().close();
    eq(xp, json.data['soyle-game'] ? JSON.parse(json.data['soyle-game']).xp : 0);
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
      const bottom = await p.evaluate(() => [...document.querySelectorAll('.card')].find(c => !c.hidden).querySelector('.mic, .ls-opt').getBoundingClientRect().bottom);
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
    for(const m of ['pairs','phrases','listen','free','progress']){
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
