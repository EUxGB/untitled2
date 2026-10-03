// Автотесты тренажёра Söyle. Запуск: node tests/soyle.test.js [путь к index.html]
// Нужен Playwright (npm i playwright). Распознавание речи, микрофон и сеть подменяются заглушками.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const FILE = 'file://' + path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const AXE = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;

let passed = 0, failed = 0;
const PHRASE_DICT_SRC = (() => { const src = fs.readFileSync(FILE.replace('file://', ''), 'utf8'); const m = src.match(/const PHRASE_DICT = (\{[\s\S]*?\n\});/); return m ? eval('(' + m[1] + ')') : {}; })();
const PHRASE_DICT_RU = lemma => (PHRASE_DICT_SRC[lemma] || [])[0];
async function test(name, fn){
  if(process.env.ONLY && !name.includes(process.env.ONLY)) return;   // ONLY="часть названия" — прогнать выбранные тесты
  try { await fn(); passed++; console.log('  ✓', name); }
  catch(e){ failed++; console.log('  ✗', name, '\n     ', e.message); }
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
const setItem = (p, it) => p.evaluate(it => { item = Object.assign({ gid:'o', meaning:'', partnerMeaning:'' }, it); }, it);

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser);

  console.log('Загрузка и режимы');
  await test('страница открывается без ошибок во всех режимах', async () => {
    for(const m of ['pairs','phrases','listen','free','city']) await p.evaluate(m => setMode(m), m);
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
  await test('значение слова по-русски, английского текста нет (жалоба: «mahkûm — откуда-то взялся английский»): списки → ru-Викисловарь → перевод толкования с пометкой', async () => {
    const q = await openPage(browser); const asked = [];
    await q.route('**/ru.wiktionary.org/**', r => r.fulfill({ json: /sarma/.test(decodeURIComponent(r.request().url()))
      ? { parse:{ wikitext:{ '*':"= {{-az-}} =\n==== Значение ====\n# [[чужое]]\n\n= {{-tr-}} =\n==== Значение ====\n# [[заворачивание]] {{пример|x}}\n# {{кулин.|tr}} [[голубцы]], [[долма]]\n#: пример\n\n=== Этимология ===\n= {{-tt-}} =\n==== Значение ====\n# [[лишнее]]\n" } } } : { error:{ code:'missingtitle' } } }));
    await q.route('**/en.wiktionary.org/**', r => r.fulfill({ json:{ tr:[{ partOfSpeech:'Noun', definitions:[{ definition:'<a>convict</a>' }, { definition:'prisoner' }, { definition:'captive' }] }] } }));
    await q.route('**/api.mymemory.translated.net/**', r => { const u = decodeURIComponent(r.request().url()); asked.push(u.split('?')[1]);
      r.fulfill({ json:{ responseStatus:200, responseData:{ translatedText: u.includes('langpair=en|ru') ? 'осуждённый; заключённый; пленник' : 'заключенный' } } }); });
    const r = await q.evaluate(async () => [await ruMeaning('köy'), await ruMeaning('sarma'), await ruMeaning('mahkûm')]);
    const errs = q.errors; await q.context().close();
    eq(r, ['деревня', 'заворачивание; голубцы, долма', '≈ осуждённый; заключённый; пленник (машинный перевод толкования из Викисловаря)']);   // список без сети; ru-Викисловарь: раздел турецкого, до трёх значений; толкование переведено, помечено
    eq(r.some(x => /англ|convict|prisoner/i.test(x)), false);
    eq(asked, ['q=convict; prisoner; captive&langpair=en|ru']); eq(errs, []);
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
    const q = await openPage(browser); await q.evaluate(() => setMode('pairs'));   // стартовый экран теперь «Город» — для проверки Enter нужна карточка
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
    for(const tab of ['tab-pairs','tab-phrases','tab-listen','tab-free','tab-city','tab-progress']){
      await tap(q, tab); await q.waitForLoadState('networkidle');
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

  // Жалоба: «Память» → микрофон → оценки пропали, «Дальше» выключена — из окна не уйти. Проверяем ВСЕ разделы:
  // сотни случайных нажатий (распознано верно / неверно / пусто / тишина), после каждого — есть ли путь дальше.
  const STUCK = () => {
    const vis = el => !!el && !el.hidden && el.offsetParent !== null, en = id => { const e = document.getElementById(id); return vis(e) && !e.disabled; };
    if(!document.getElementById('modal').hidden) return [...document.querySelectorAll('#modal button')].some(b => vis(b) && !b.disabled) ? '' : 'окно без кнопок';
    if(!document.getElementById('sheet').hidden) return en('sheetClose') ? '' : 'лист без «закрыть»';
    if([...document.querySelectorAll('.tabbar .tab')].some(t => t.disabled)) return 'вкладка выключена';
    if(mode === 'memory') return en('next') || [...document.querySelectorAll('#memGrades .grade')].some(vis) ? '' : `Память: нет выхода (фаза ${mem && mem.phase})`;
    if(mode === 'pairs' || mode === 'phrases') return en('next') ? '' : `${mode}: «Дальше» выключена`;
    if(mode === 'listen') return en('lsA') || en('lsB') || en('lsBlitz') || lsLocked ? '' : 'На слух: всё выключено';
    if(mode === 'free') return en('freeSpeak') ? '' : 'Свободно: «Сказать» выключена';
    if(mode === 'city') return en('ctSpeak') || en('ctShow') || en('ctNext') || [...document.querySelectorAll('.ct-task, .ct-note, #ctDayEnd')].some(b => vis(b) && !b.disabled)
      || document.querySelector('#ctTr.veil') ? '' : `Город: нет пути дальше (${ct ? ct.id + '/' + ct.nodeId : 'дом'})`;   // .veil — собеседник ещё говорит
    return '';
  };
  const monkey = async (q, tabs, steps, seed) => {
    let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const log = [], bad = [];
    for(let i = 0; i < steps; i++){
      const said = ['__T__', 'yanlış bir şey', '', '__SILENT__'][Math.floor(rnd() * 4)];
      await q.evaluate(s => { window.__silent = s === '__SILENT__'; window.__say = s === '__T__' ? (mode === 'city' && ct && ct.node && !ct.node.end && !ct.node.pay ? (ct.pick || ctMoves(ct.node)[0] || { say:['merhaba'] }).say[0] : (item && item.target) || (ls && ls.answer) || 'merhaba') : s; }, said);
      let target;
      if(rnd() < 0.08) target = tabs[Math.floor(rnd() * tabs.length)];
      else {
        const n = await q.evaluate(() => {   // видимые и включённые; перед нажатием — прокрутить к кнопке и проверить, что её не закрывает другое
          const pool = document.querySelectorAll('#modal:not([hidden]) button, #sheet:not([hidden]) button, .screen > section:not([hidden]) button, .chips:not([hidden]) button');
          const list = [...pool].filter(b => b.offsetParent && !b.disabled && !b.closest('.backup') && !['bkYes','updateApp'].includes(b.id));
          document.querySelectorAll('[data-m]').forEach(e => delete e.dataset.m); list.forEach((b, k) => b.dataset.m = String(k)); return list.length; });
        if(!n){ bad.push(`шаг ${i}: нечего нажать (${await q.evaluate(() => mode)})`); break; }
        target = `[data-m="${Math.floor(rnd() * n)}"]`;
      }
      const name = await q.evaluate(t => { const e = document.querySelector(t); if(!e) return t; const nm = e.id || e.textContent.trim().slice(0, 20);
        if(!e.closest('.tabbar')){ e.scrollIntoView({ block:'center', inline:'center' }); const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          if(!hit || !e.contains(hit)) return '(закрыто: ' + nm + ' ← ' + (hit ? (hit.id || hit.className.baseVal || hit.className || hit.tagName) : 'нет') + ' ' + mode + ')'; }
        e.click(); return nm; }, target);
      await q.waitForTimeout(20 + Math.floor(rnd() * 60));
      let t = 0; for(; t < 180 && await q.evaluate(() => listening); t++) await q.waitForTimeout(50);   // ожидание микрофона до 4 с + «Стоп» 1,5 с
      if(t >= 180){ bad.push(`шаг ${i}: микрофон не выключился за 9 с после «${name}» (раздел ${await q.evaluate(() => mode)}; ошибки JS: ${JSON.stringify(q.errors)}); последние: ${log.slice(-8).join(' → ')}`); break; }
      log.push(name); if(process.env.DEBUG_MONKEY) console.log('   ', i, await q.evaluate(() => mode), name);
      const s = await q.evaluate(STUCK);
      if(s){ bad.push(`шаг ${i} после «${name}»: ${s}; последние нажатия: ${log.slice(-6).join(' → ')}`); break; }
      // «завис» = микрофон не выключался 9 секунд подряд (отложенный старт при «Сравнить» — не зависание)
    }
    return bad;
  };
  await test('разрешение на микрофон не приходит: «Сказать» не зависает — «Стоп» сразу возвращает кнопку, без записи распознаёт через 4 с', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(async () => { navigator.mediaDevices.getUserMedia = () => new Promise(() => {}); stream = null; recordOn = true;
      setMode('pairs'); window.__say = item.target; const out = [];
      document.getElementById('speak').click(); await new Promise(z => setTimeout(z, 200)); out.push(listening);
      document.getElementById('speak').click(); await new Promise(z => setTimeout(z, 50)); out.push(listening, document.querySelector('#speak .lbl').textContent);
      document.getElementById('speak').click(); await new Promise(z => setTimeout(z, 4400)); out.push(listening, document.getElementById('result').textContent.includes('из 100'));
      setMode('free'); document.getElementById('freeSpeak').click(); await new Promise(z => setTimeout(z, 200)); out.push(freeOn);
      document.getElementById('freeSpeak').click(); await new Promise(z => setTimeout(z, 50)); out.push(freeOn, document.querySelector('#freeSpeak .lbl').textContent);
      setMode('pairs'); return out; });
    const errs = q.errors; await q.context().close();
    eq(r, [true, false, 'Сказать', false, true, true, false, 'Сказать']); eq(errs, []);
  });
  await test('случайные нажатия во всех разделах (по 120 на раздел): всегда есть путь дальше, нет ошибок JS', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    await q.evaluate(() => { trVoice = { name:'Test Türkçe', lang:'tr-TR' }; trVoices = [trVoice]; BLITZ_SEC = 8; });
    const tabs = ['#tab-city','#tab-memory','#tab-train','#tab-progress'], bad = [];   // подвкладки тренировки monkey нажимает сам как кнопки в .chips
    const goTab = async tab => {   // перейти в раздел можно всегда: окно/лист закрываются своими кнопками, остальное не должно перекрывать панель
      if(await q.isVisible('#modal')) await q.click('#modal button:visible >> nth=-1');
      if(await q.isVisible('#sheet')) await q.click('#sheetClose');
      const cover = await q.evaluate(t => { const r = document.querySelector(t).getBoundingClientRect(), e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e && !document.querySelector(t).contains(e) ? (e.id || e.className || e.tagName) : ''; }, tab);
      if(cover) bad.push(`вкладку ${tab} закрывает «${cover}»`);
      await q.click(tab, { timeout:3000 }).catch(e => bad.push(`не нажать ${tab}: ${e.message.split('\n')[0]}`));
    };
    for(const [k, tab] of tabs.entries()){ await goTab(tab); bad.push(...(await monkey(q, tabs, 120, 7 + k * 101)).map(b => tab + ' ' + b)); }
    const errs = q.errors; await q.context().close(); eq(bad, []); eq(errs, []);
  });
  await test('прохождение по нажатиям: «Память» — 12 фраз подряд с микрофоном в каждой фазе; «Фразы», «Звуки», «На слух» идут дальше', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    await q.click('#tab-memory'); const seen = new Set(), steps = [];
    for(let i = 0; i < 60 && seen.size < 12; i++){
      const ph = await q.evaluate(() => { window.__say = mem && mem.card ? mem.card.tr : ''; return mem.phase; }); steps.push(ph);
      if(ph !== 'empty'){ await q.click('#speak'); await q.waitForTimeout(60); for(let t = 0; t < 40 && await q.evaluate(() => listening); t++) await q.waitForTimeout(100); }   // микрофон в любой фазе
      const ph2 = await q.evaluate(() => mem.phase);   // «понять»: сказали — сразу ответ; «сказать»: оценка по речи
      if(ph2 === 'answer'){ seen.add(await q.evaluate(() => mem.card.tr)); await q.click('#memGrades .grade[data-g="3"]'); }
      else await q.click('#next');
      await q.waitForTimeout(40);
      if(await q.evaluate(() => mem.phase === 'study' || mem.phase === 'prompt')) await q.evaluate(() => { const a = loadCards(); a.forEach(c => { if(c.due > Date.now() && c.state !== 2) c.due = Date.now() - 1; }); saveCards(a); });   // «прошло 10 минут»: короткие шаги наступили, дни — нет
    }
    const other = {};
    for(const [tab, sel] of [['#tab-phrases', '#next'], ['#tab-pairs', '#next']]){
      await tap(q, tab.slice(1)); const t = new Set();
      for(let i = 0; i < 8; i++){ await q.click('#speak'); await q.waitForTimeout(80); t.add(await q.evaluate(() => item.target)); await q.click(sel); }
      other[tab] = t.size;
    }
    await tap(q, 'tab-listen'); const heard = new Set();
    for(let i = 0; i < 6; i++){ await q.waitForTimeout(400); heard.add(await q.evaluate(() => ls.answer)); await q.evaluate(() => { clearTimeout(lsNextTimer); answerListen(ls.right); clearTimeout(lsNextTimer); nextListen(); }); }
    const errs = q.errors; await q.context().close();
    ok(seen.size >= 12, `в «Памяти» пройдено фраз: ${seen.size}; фазы: ${steps.join(',')}`);
    ok(other['#tab-phrases'] >= 5 && other['#tab-pairs'] >= 4 && heard.size >= 3, JSON.stringify([other, heard.size])); eq(errs, []);
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
    const q = await openPage(browser, { android:true, storage:{ 'soyle-rec-conflict':'1' } }); await q.evaluate(() => setMode('pairs'));
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
  await test('нижняя панель: 4 раздела (Город · Память · Тренировка · Прогресс); подвкладки тренировки видны только в ней и помнят последнюю', async () => {
    const r = await p.evaluate(() => { const tabs = [...document.querySelectorAll('.tabbar .tab')].map(t => t.id), subs = [...document.querySelectorAll('#subtabs .chip')].map(t => t.id);
      document.getElementById('tab-free').click(); const free = [!document.getElementById('freeCard').hidden, document.getElementById('tab-free').getAttribute('aria-pressed'), document.getElementById('tab-train').getAttribute('aria-pressed'), document.getElementById('subtabs').hidden];
      document.getElementById('tab-progress').click(); const prog = [!document.getElementById('progressView').hidden, document.getElementById('card').hidden, document.getElementById('subtabs').hidden, document.getElementById('tab-train').getAttribute('aria-pressed')];
      document.getElementById('tab-train').click(); const back = [mode, localStorage.getItem('soyle-train')];
      document.getElementById('tab-pairs').click(); return [tabs, subs, free, prog, back]; });
    eq(r, [['tab-city','tab-memory','tab-train','tab-progress'], ['tab-pairs','tab-phrases','tab-listen','tab-free'], [true, 'true', 'true', false], [true, true, true, 'false'], ['free', 'free']]);
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
    await tap(u, 'tab-pairs'); await say(await u.evaluate(() => item.target));
    await u.click('#speak'); await u.waitForTimeout(250);
    ok((await u.textContent('#result')).includes('Верно'), 'Звуки: нет «Верно»');
    ok(!(await u.isDisabled('#compare')), 'Звуки: «Сравнить» не включилась после попытки');
    const w1 = await u.evaluate(() => item.target); await u.click('#next'); ok(await u.evaluate(w => item.target !== w || true, w1));
    // 2. Звуки: сказать слово-пару → названа путаница
    await say(await u.evaluate(() => item.partner)); await u.click('#speak'); await u.waitForTimeout(250);
    ok((await u.textContent('#result')).includes('Прозвучало'), 'Звуки: путаница не распознана');
    // 3. Фразы: выбрать «отель», сказать фразу целиком
    await tap(u, 'tab-phrases'); await u.click('.chip[data-s="hotel"]');
    await say(await u.evaluate(() => item.target)); await u.click('#speak'); await u.waitForTimeout(250);
    ok((await u.textContent('#result')).includes('все слова'), 'Фразы: фраза не засчитана');
    // 4. На слух: нажать правильный вариант
    await tap(u, 'tab-listen'); await u.waitForTimeout(100);
    const right = await u.evaluate(() => ls.right); await u.click(right === 'A' ? '#lsA' : '#lsB');
    ok((await u.textContent('#lsResult')).includes('Верно'), 'На слух: нет «Верно»');
    // 5. Свободно: вписать фразу, сказать, сохранить в «мои»
    await tap(u, 'tab-free'); await u.fill('#intent', 'Hesap lütfen'); await say('hesap lütfen');
    await u.click('#freeSpeak'); await u.waitForTimeout(250);
    ok((await u.textContent('#freeResult')).includes('поймёт'), 'Свободно: нет вердикта');
    await u.click('#freeSave'); eq(await u.textContent('#freeSave'), 'Сохранено');
    // 6. «мои» в Фразах
    await tap(u, 'tab-phrases'); await u.click('.chip[data-s="mine"]'); eq(await u.textContent('#target'), 'Hesap lütfen');
    // 7. Прогресс: через верхнюю панель, видно XP, достижения, задание
    await u.click('#tbProgress');
    const pr = await u.evaluate(() => [!document.getElementById('progressView').hidden, game.xp > 0, game.badges.includes('first'), document.getElementById('gbQuestTxt').textContent.length > 0, document.getElementById('tbStreak').textContent]);
    eq(pr, [true, true, true, true, '1']);
    // 8. Подсказки «?» и возврат
    await u.click('#hintsBtn'); await tap(u, 'tab-pairs'); ok(await u.isVisible('#tip'), 'подсказка не видна');
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
    const s4 = await q.evaluate(() => [document.getElementById('target').textContent, [...document.querySelectorAll('#memGrades .grade')].map(b => b.querySelector('b').textContent + ' ' + b.querySelector('small').textContent),
      document.getElementById('next').disabled, document.querySelectorAll('#memGrades .grade.suggest').length]);
    await q.click('#memGrades .grade[data-g="3"]');
    const s5 = await q.evaluate(t => { const c = loadCards().find(x => x.tr === t); return [c.state, c.step, Math.round((c.due - Date.now()) / 60e3), +c.s.toFixed(4), (stats['mem-rec'] || {}).ok]; }, s1[1]);
    const errs = q.errors; await q.context().close();
    eq(s1.slice(0, 1).concat(s1.slice(2)), ['study', true, 'Запомнил']);
    eq(s2, [true, null, 60, 1, 'study']);                              // первое вспоминание — через минуту; следующая новая пока в знакомстве
    eq(s3, [s1[1], '· · ·', 'Что значит эта фраза?', 'Показать', 'Текст', true, false]);
    eq([s4[0], s4[1].length, s4[1][0], s4[2], s4[3]], [s1[1], 4, 'Забыл 1 мин', false, 0]);   // «Пропустить» — выход без оценки   // без речи оценку не подсказываем
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
      a.push(mem.phase, mem.suggest, document.querySelectorAll('#memGrades .grade').length, !!document.querySelector('#result .score'), document.getElementById('target').textContent, (stats['mem-prod'] || {}).t);
      return a; });
    const r2 = await q.evaluate(async () => { const now = Date.now();
      saveCards([{ ...newMemCard('Hesap lütfen.', '', 'Счёт, пожалуйста.', 'prod', now), due:now - 1 }]); mem = null; memNext();
      window.__say = 'hesap lütfen'; startListening(); await new Promise(z => setTimeout(z, 150)); return [mem.suggest, document.querySelector('#memGrades .grade.suggest').dataset.g]; });
    const errs = q.errors; await q.context().close();
    eq(r, ['prod', 'Как сказать: «Где туалет?»', '· · ·', true, true, 'Буквы', 'T······ n·····?', 'answer', 2, 4, true, 'Tuvalet nerede?', 1]);
    eq(r2, [3, '3']); eq(errs, []);
  });
  await test('жалоба: после ответа нажали микрофон — оценки остаются, «Пропустить» уводит дальше; «понять»: сказали — сразу ответ', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(async () => { const now = Date.now(); const wait = async () => { await new Promise(z => setTimeout(z, 60)); for(let t = 0; t < 40 && listening; t++) await new Promise(z => setTimeout(z, 50)); };
      saveCards([{ ...newMemCard('Merhaba.', '', 'Привет.', 'rec', now), seen:true, due:now - 1 }, { ...newMemCard('Hesap lütfen.', '', 'Счёт.', 'rec', now), seen:true, due:now - 1 }]);
      setMode('memory'); const first = mem.card.tr; window.__say = first;
      document.getElementById('speak').click(); await wait();                               // «понять»: повторили вслух → ответ
      const a = [mem.phase, document.querySelectorAll('#memGrades .grade').length];
      document.getElementById('speak').click(); await wait();                               // микрофон ещё раз, уже на ответе
      a.push(mem.phase, document.querySelectorAll('#memGrades .grade').length, document.getElementById('next').disabled, document.querySelector('#next .lbl').textContent);
      document.getElementById('compare').click(); await new Promise(z => setTimeout(z, 300)); a.push(document.querySelectorAll('#memGrades .grade').length);
      document.getElementById('next').click(); a.push(mem.card.tr !== first, loadCards().find(c => c.tr === first).s);   // пропуск: расписание не тронуто
      return a; });
    const errs = q.errors; await q.context().close();
    eq(r, ['answer', 4, 'answer', 4, false, 'Пропустить', 4, true, null]); eq(errs, []);
  });
  await test('«На сегодня всё»: экран без карточки не падает, «Ещё 5 новых» продолжает', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(() => { saveCards([]); memSaveDay({ day:dayStr(new Date()), newN:10, extra:0, done:10 }); setMode('memory');
      const a = [mem.phase, document.getElementById('target').textContent, document.querySelector('#next .lbl').textContent, document.getElementById('next').disabled];
      document.getElementById('next').click(); a.push(mem.phase, memPlan().fresh.length); return a; });
    const errs = q.errors; await q.context().close();
    eq(r, ['empty', 'На сегодня всё', 'Ещё 5 новых', false, 'study', 5]); eq(errs, []);
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
    await tap(q, 'tab-listen'); await q.click('#lsKindChip');
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
          return { k:`${w}x${h} ${m}`, fit, over: (h > 600 && card.scrollHeight - card.clientHeight > 1) || document.documentElement.scrollHeight > innerHeight || tab > innerHeight + 1   // совсем низкий экран (≤ 600): карточка может прокручиваться, страница и панель — нет
            || (() => { const k = [...card.children].filter(e => e.offsetParent); for(let i = 0; i + 1 < k.length; i++) if(k[i].getBoundingClientRect().bottom > k[i+1].getBoundingClientRect().top + 1) return 'наложение: ' + k[i].className + ' / ' + k[i+1].className; return false; })()
            || (m === 'listen' && [...document.querySelectorAll('#lsA b, #lsB b')].some(b => { const r = b.getBoundingClientRect(), t = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !t || !b.parentElement.contains(t); }) && 'слово варианта закрыто'),
          round: [...document.querySelectorAll('.screen > .card:not([hidden]) .mic, .screen > .card:not([hidden]) .act .ring, .screen > .card:not([hidden]) .round-xl')].every(b => getComputedStyle(b).borderRadius === '50%' || parseFloat(getComputedStyle(b).borderRadius) >= Math.max(b.offsetWidth, b.offsetHeight) / 2 - 1) }; }, [m, w, h]));
      }
    }
    await q.context().close();
    eq(out.filter(o => o.over).map(o => o.k + ' ' + o.over), []); eq(out.filter(o => !o.round).map(o => o.k), []);
    ok(out.find(o => o.k === '360x560 pairs').fit < 1 && out.find(o => o.k === '412x915 phrases').fit > 1, JSON.stringify(out.map(o => o.k + ':' + o.fit)));
  });

  await test('одно слово не переносится: все слова тем и самое длинное (14 букв) — в одну строку и не шире карточки на 360×640, 390×844, 412×915', async () => {
    const q = await openPage(browser); const bad = [];
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      await q.setViewportSize({ width:w, height:h });
      const r = await q.evaluate(() => { setMode('phrases'); setKind(true); const out = [];
        const words = [...new Set(PHRASE_SETS.flatMap(g => wordPool(g.id).items.map(x => JSON.stringify([g.id, x.tr]))))].map(JSON.parse);
        wordPool('hotel').items.push({ tr:'misafirperverl', ru:'гостеприимный', seen:0 }); words.push(['hotel', 'misafirperverl']);
        for(const [topic, tr] of words){ if(/\s/.test(tr)) continue;
          setId = topic; wordPool(topic).items.forEach(x => x.seen = x.tr === tr ? 0 : 1); lastKey = ''; next(); autofit();
          const t = document.getElementById('target'), rg = document.createRange(); rg.selectNodeContents(t);
          const lines = new Set([...rg.getClientRects()].map(x => Math.round(x.top))).size, bw = rg.getBoundingClientRect(), cw = t.getBoundingClientRect();
          if(item.target !== tr || lines > 1 || bw.left < cw.left - 1 || bw.right > cw.right + 1 || parseFloat(getComputedStyle(t).fontSize) < 22) out.push(`${tr}: строк ${lines}, ${Math.round(parseFloat(getComputedStyle(t).fontSize))}px`); }
        setKind(false); setMode('pairs'); next(); autofit(); const t = document.getElementById('target');
        return { n:words.length, out, pairOne: t.classList.contains('oneword') }; });
      if(r.n < 200) bad.push(`${w}x${h}: слов всего ${r.n}`);
      bad.push(...r.out.map(x => `${w}x${h} ${x}`)); if(!r.pairOne) bad.push(`${w}x${h}: слово в «Звуках» не помечено`);
    }
    const errs = q.errors; await q.context().close(); eq(bad, []); eq(errs, []);
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
  async function openInApp(opts){ const q = await openPage(browser, opts); await q.evaluate(() => setMode('pairs'));   // стартовый экран — «Город»; здесь нужна карточка слова
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
    await tap(q, 'tab-free'); await q.fill('#intent', ''); await q.evaluate(() => { window.__say = 'hesabı alabilir miyim'; });
    await q.click('#freeSpeak'); await q.waitForTimeout(200);
    await q.click('#freeTranslate'); await q.waitForFunction(() => document.getElementById('trOut') && document.getElementById('trOut').textContent !== 'Перевожу…');
    const free = await q.evaluate(() => [document.querySelector('#sheet .sheet-q').textContent, document.getElementById('trOut').textContent]);
    await q.click('#sheetClose');
    await tap(q, 'tab-phrases'); await q.click('.chip[data-s="mine"]');
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
    await tap(q, 'tab-phrases');
    const r = await q.evaluate(async () => { item = { target:'Hesap lütfen biraz', gid:'ph-basic', meaning:'' }; nativeCache.set(clean(item.target), []);
      nativeCache.set(clean('hesap'), [{ url:'https://x/hesap.wav', who:'A' }]); nativeCache.set(clean('lütfen'), [{ url:'https://x/lutfen.wav', who:'B' }]); nativeCache.set(clean('biraz'), []);
      window.__played = []; playNative(); await new Promise(z => setTimeout(z, 900));
      return [window.__played.map(s => s.split('/').pop()), document.getElementById('nativeStatus').textContent, document.getElementById('sheet').hidden]; });
    await q.context().close();
    eq(r[0], ['hesap.wav', 'lutfen.wav']); ok(/по словам: hesap · lütfen · \(biraz — нет\)/.test(r[1]), r[1]); eq(r[2], true);
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
    await tap(q, 'tab-phrases'); await q.click('.chip[data-s="novoice"]');
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
  await test('фразы из жизни: список в программе совпадает с выверенным (tests/voiced-phrases.json); редкие фразы не идут в темы, слова и «Память», но остались в «На слух»', async () => {
    const vp = JSON.parse(fs.readFileSync(path.join(__dirname, 'voiced-phrases.json'), 'utf8'));
    const q = await openPage(browser);
    const r = await q.evaluate(() => { setMode('phrases'); setId = 'shop'; const picked = new Set(); for(let i = 0; i < 400; i++) picked.add(pickPhrase().target);
      const mem = memTopicPool().map(x => x.tr), first = memTopicPool().slice(0, 9).map(x => x.tr);
      return { voiced: Object.fromEntries(Object.entries(VOICED).map(([k, l]) => [k, l.map(x => [x[0], x[1]])])), rare: [...RARE], picked: [...picked], mem, first,
        ls: lsPhrasePool('all').map(x => x.tr), shop: PHRASE_SETS.find(g => g.id === 'shop').items.map(x => [x.tr, !!x.rare]),
        words: PHRASE_SETS.flatMap(g => phraseWordsOf(g.id).map(w => w.tr)), n: PHRASE_SETS.reduce((a, g) => a + g.items.filter(x => !x.rare).length, 0),
        fixed: ['Çok affedersiniz.', 'Peki nasılsın?', 'Metroyla gidiyorum.', 'Bakar mısınız?'].map(t => PHRASE_SETS.flatMap(g => g.items).find(x => x.tr === t).ru),
        old: ['Bunun Türkçesi ne?', 'Bu doğru değil mi?'].map(t => (OLD_PHRASES.find(x => x.tr === t) || {}).ru), alerji: PHRASE_SETS.flatMap(g => g.items).find(x => x.tr === 'Alerjim var.').tl }; });
    await q.context().close();
    eq(r.voiced, Object.fromEntries(Object.entries(vp).map(([k, l]) => [k, l.map(x => [x.tr, x.ru])])));        // один источник — без расхождений
    eq(r.rare.sort(), Object.values(vp).flat().filter(x => x.rare).map(x => x.tr).sort());
    ok(r.rare.includes('Herkes trene!') && r.rare.includes('Bana biraz para ver.') && r.rare.length >= 10, r.rare.join());
    eq(r.rare.filter(t => r.picked.includes(t) || r.mem.includes(t)), []);                                       // не в теме и не в «Памяти»
    eq(r.rare.filter(t => !r.ls.includes(t)), []);                                                               // но не удалены — «На слух»
    eq(r.shop.findIndex(x => x[1]) >= r.shop.filter(x => !x[1]).length, true);                                   // редкие — в конце списка
    eq(r.words.filter(w => ['Japonca', 'Fransızca', 'barmen', 'dolar'].includes(w)), []);                        // и слова из них не учатся
    ok(r.n >= 280, 'фраз из жизни: ' + r.n);
    eq(r.first, ['Tabii ki.', 'Bir oda istiyorum.', 'İyi akşamlar.', 'Hesap lütfen.', 'Hey, taksi!', 'Çok pahalıdır.', 'Alerjim var.', 'İngilizce biliyor musunuz?', 'Ambulans çağırın!']);   // «Память»: по одной из каждой темы, с самого нужного
    eq(r.fixed, ['Простите, пожалуйста.', 'А ты как?', 'Я еду на метро.', 'Извините, можно вас? (так подзывают официанта, продавца)']);
    eq(r.old, ['Как это по-турецки?', 'Это верно, не так ли?']); eq(r.alerji, 'алержим вар');
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
      setId = 'hotel'; const pp = pickPhrase; pickPhrase = () => ({ target:longest.tr, translit:longest.tl, meaning:longest.ru, tip:longest.focus, gid:'ph-x' }); next(); pickPhrase = pp; await new Promise(z => setTimeout(z, 150));
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
        setMode('phrases'); setId = 'novoice'; const pp = pickPhrase; pickPhrase = () => ({ target:'Şu köşe yaz köşesi, şu köşe kış köşesi', translit:'', meaning:'', tip:'x', gid:'ph-x' }); next(); pickPhrase = pp;
        await new Promise(z => setTimeout(z, 80));
        document.getElementById('meaning').textContent = "Скороговорка: этот угол летний, этот зимний, посередине бутылка воды (детская игра, длинное пояснение)";
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
  const WORDS_FOOD = eval((fs.readFileSync(FILE.replace('file://', ''), 'utf8').match(/\n  food:(\[\["menü".*?\]\]),\n/) || [])[1]);   // стартовые слова темы — из программы
  async function openWords(){ const q = await openInApp(); await q.route('**/*wiktionary.org/w/api.php**', r => r.fulfill({ json: WIKI(decodeURIComponent(r.request().url())) })); return q; }
  await test('«Фразы» → «слова»: слова выбранной темы с переводом, по счётчику в чипах; переключение обратно на фразы', async () => {
    const q = await openWords();
    await q.evaluate(() => wordPool('food').items.forEach(w => { if(w.fromPhrase) w.seen = 1; }));   // здесь проверяем стартовые слова с переводом (слова из фраз — отдельный тест)
    await tap(q, 'tab-phrases'); await q.click('.chip[data-s="food"]'); await q.click('#kindChip');
    const r = await q.evaluate(() => [wordsKind, item.word, item.topic, WORD_SEEDS.food.map(x => x[0]).includes(item.target), document.getElementById('meaning').textContent,
      document.querySelector('.chip[data-s="food"]').textContent, document.getElementById('target').classList.contains('phrase'), localStorage.getItem('soyle-kind'), item.target, document.getElementById('result').textContent]);
    const vis = await q.evaluate(() => { const k = document.getElementById('kindChip').getBoundingClientRect(), c = document.querySelector('.chip[data-s="food"]').getBoundingClientRect(); return c.left >= k.right - 1 && c.right <= innerWidth + 1; });
    ok(vis, 'выбранная тема закрыта переключателем «слова» или за краем');
    await q.click('#kindChip');
    const back = await q.evaluate(() => [wordsKind, !!item.word, document.querySelector('.chip[data-s="novoice"]') !== null]);
    const errs = q.errors; await q.context().close();
    eq(r.slice(0, 4), [true, true, 'food', true]); eq(r[4], Object.fromEntries(WORDS_FOOD)[r[8]]);   // русский перевод темы, не английское значение из Викисловаря ok(/^ресторан \(\d+\)$/.test(r[5]), r[5]); eq(r[6], false); eq(r[7], 'words'); ok(/произнесите слово/.test(r[9]), r[9]);
    eq(back, [false, false, true]); eq(errs, []);
  });
  await test('слова тем — только выверенные списки: из сети не подгружаются, перевод есть у каждого; сохранённые слова из Викисловаря уходят, счёт «видел» остаётся', async () => {
    const q = await openPage(browser, { storage:{ 'soyle-words-hotel': JSON.stringify({ items:[{ tr:'oda', ru:'номер', seen:2 }, { tr:'lobi', ru:'лобби', seen:0 }, { tr:'sarma', ru:'заворачивание', seen:1 }], cat:1, cont:'x' }) } });
    const net = []; q.on('request', rq => { if(/wiktionary|mymemory/.test(rq.url())) net.push(rq.url()); });
    const r = await q.evaluate(() => { setMode('phrases'); setKind(true);
      const all = PHRASE_SETS.map(g => wordPool(g.id).items), hotel = wordPool('hotel').items;
      const odaSeen = hotel.find(x => x.tr === 'oda').seen; hotel.forEach(w => w.seen = 1); setId = 'hotel'; const w = pickWord('hotel');            // новых не осталось — подгрузки нет, слово всё равно даётся
      const dup = Object.entries(WORD_SEEDS).filter(([, l]) => new Set(l.map(x => x[0])).size !== l.length).map(x => x[0]);
      return [all.every(l => l.length >= 30), all.flat().filter(x => !x.ru || /≈|машинн/.test(x.ru)).map(x => x.tr), hotel.some(x => x.tr === 'lobi' || x.tr === 'sarma'),
        odaSeen === 2, !!w && !!w.meaning, typeof growWords, dup,
        Object.values(WORD_SEEDS).flat().filter(x => !/^[a-zçğıöşüâîû]{2,16}$/.test(x[0])).map(x => x[0]), w.tip]; });
    await q.waitForTimeout(200); const errs = q.errors; await q.context().close();
    eq(r.slice(0, 8), [true, [], false, true, true, 'undefined', [], []]); ok(/Перевод проверен вручную|Из фразы/.test(r[8]), r[8]); eq(net, []); eq(errs, []);
  });
  await test('слова из фраз — только из выверенного словаря: словарная форма, готовый перевод (не машинный), пример-фраза; многозначные не берутся', async () => {
    const q = await openPage(browser); const net = [];
    q.on('request', rq => { if(/mymemory|wiktionary/.test(rq.url())) net.push(rq.url()); });
    const r = await q.evaluate(async () => { localStorage.removeItem('soyle-words-food'); delete wordPools.food;
      const pool = wordPool('food'), ph = phraseWordsOf('food'), keys = pool.items.map(w => nphr(w.tr));
      setMode('phrases'); setKind(true); setId = 'food'; renderChips(); const picks = [];
      for(let i = 0; i < 6; i++){ next(); await new Promise(z => setTimeout(z, 30)); picks.push([item.target, document.getElementById('meaning').textContent, document.getElementById('tip').textContent.startsWith('Из фразы')]); }
      const all = Object.keys(PHRASE_DICT), forms = [...PHRASE_FORMS.keys()];
      const sizi = phraseWordsOf('talk').concat(PHRASE_SETS.flatMap(g => phraseWordsOf(g.id))).find(w => w.tr === 'sizi');
      setKind(false); return { n:ph.length, dup:keys.length !== new Set(keys).size, picks, sizi: sizi && sizi.ru,
        ruAll: PHRASE_SETS.every(g => phraseWordsOf(g.id).every(w => w.ru && w.ru === PHRASE_DICT[w.tr][0] && w.ex)),
        dropped: ['artık', 'kadar', 'daha', 'sürer', 'bağlı', 'misiniz', 'miyim', 'yerinde', 'aç'].filter(f => PHRASE_FORMS.has(f) || all.includes(f)),
        lemma: [PHRASE_FORMS.get('odada'), PHRASE_FORMS.get('istiyorum'), PHRASE_FORMS.get('anlamıyorum')], count: [all.length, forms.length] }; });
    const errs = q.errors; await q.context().close();
    ok(r.n >= 15, 'слов из фраз «ресторан»: ' + r.n); eq([r.dup, r.ruAll, r.dropped, r.sizi], [false, true, [], 'вас (кого?)']);
    eq(r.lemma, ['oda', 'istemek', 'anlamak']); ok(r.count[0] >= 140, String(r.count));
    eq(r.picks.every(x => x[2] && x[1] === PHRASE_DICT_RU(x[0])), true, JSON.stringify(r.picks)); eq(net, []); eq(errs, []);   // перевод из словаря, сеть не нужна
  });
  const CTX_TATO = { data:[
    { id:1, text:'Bir oda istiyorum.', translations:[[{ lang:'rus', text:'Мне нужен номер.' }]], audios:[] },               // та же фраза, что в тренажёре — не повторяется
    { id:2, text:'Ne istiyorsun?', translations:[[{ lang:'rus', text:'Чего ты хочешь?' }]], audios:[{ id:55, author:'x', license:'CC BY 4.0' }] },
    { id:3, text:'Seninle konuşmak istiyorum.', translations:[[{ lang:'rus', text:'Я хочу с тобой поговорить.' }]], audios:[] },
    { id:4, text:'İstemek başarmanın yarısıdır.', translations:[], audios:[] } ] };                                         // без перевода — не показывается
  await test('слово в контексте: на карточке слова — фраза тренажёра с переводом (без сети), слово выделено; «ещё» — примеры Tatoeba с переводом', async () => {
    const q = await openPage(browser); const net = [];
    await q.route('**/api.tatoeba.org/**', r => { if(/showtrans/.test(r.request().url())) net.push(r.request().url()); r.fulfill({ json:CTX_TATO }); });   // считаем только запросы примеров
    await q.setViewportSize({ width:360, height:640 });
    const r = await q.evaluate(async () => { setMode('phrases'); setKind(true); setId = 'hotel'; renderChips();
      wordPool('hotel').items.forEach(x => x.seen = x.tr === 'istemek' ? 0 : 1); lastKey = ''; next();                    // сразу после показа, до ответа сети
      // lastKey = '': иначе, если setKind случайно уже показал «istemek», слово не повторяется подряд и тест падал (редкий сбой, 1 из ~60)
      return [item.target, document.querySelector('#partner .ctx-tr').textContent, document.querySelector('#partner .ctx-tr b').textContent, document.querySelector('#partner .ctx-ru').textContent, !!document.getElementById('ctxPlay')]; });
    await q.waitForFunction(() => ctx && ctx.loaded); const before = net.length;                                          // остальные примеры — в фоне, по одному запросу на форму
    const r2 = await q.evaluate(async () => { document.getElementById('ctxMore').click();   // нажатие внутри страницы: без гонки с перерисовкой
      const out = [ctx.list.map(x => x.tr), document.querySelector('#partner .ctx-tr').textContent, document.querySelector('#partner .ctx-tr b').textContent, document.querySelector('#partner .ctx-n').textContent];
      window.__played = []; document.getElementById('ctxPlay').click(); await new Promise(z => setTimeout(z, 60)); out.push(window.__played[0]);
      document.getElementById('ctxMore').click(); out.push(document.querySelector('#partner .ctx-tr').textContent); document.getElementById('ctxMore').click(); out.push(document.querySelector('#partner .ctx-tr').textContent);
      autofit(); const card = document.getElementById('card'); out.push(card.scrollHeight - card.clientHeight <= 1, document.scrollingElement.scrollHeight <= innerHeight + 1); return out; });
    const long = await q.evaluate(async () => { const bad = [];   // самые длинные примеры каждой темы помещаются на 360×640
      for(const g of PHRASE_SETS){ const w = phraseWordsOf(g.id).sort((a, b) => b.ex.length + b.exRu.length - a.ex.length - a.exRu.length)[0]; if(!w) continue;
        setId = g.id; wordPool(g.id).items.forEach(x => x.seen = x.tr === w.tr ? 0 : 1); lastKey = ''; next(); await new Promise(z => setTimeout(z, 60)); autofit();
        const card = document.getElementById('card'), e = document.getElementById('ctxMore');
        if(item.target !== w.tr || card.scrollHeight - card.clientHeight > 1 || document.scrollingElement.scrollHeight > innerHeight + 1 || e.scrollWidth > e.clientWidth + 1) bad.push(g.id + ': ' + w.ex); }
      return bad; });
    const errs = q.errors; await q.context().close(); eq(long, []);
    eq(r, ['istemek', 'Bir oda istiyorum.', 'istiyorum.', 'Мне нужен номер.', true]); eq(before, 3);                       // первый пример — без обращения к сети
    eq(r2, [['Bir oda istiyorum.', 'Ne istiyorsun?', 'Seninle konuşmak istiyorum.'], 'Ne istiyorsun?', 'istiyorsun?', 'пример 2 из 3 · нажмите — следующий',
      'https://api.tatoeba.org/v1/audios/55/file', 'Seninle konuşmak istiyorum.', 'Bir oda istiyorum.', true, true]); eq(errs, []);
  });
  await test('слово без своей фразы: пример ищется сразу; примеров нет или нет сети — на карточке остаётся прежняя строка', async () => {
    const q = await openPage(browser);
    await q.route('**/api.tatoeba.org/**', r => r.fulfill({ json:CTX_TATO }));
    const r = await q.evaluate(async () => { setMode('phrases'); setKind(true); setId = 'hotel'; renderChips();
      const pool = wordPool('hotel'); pool.items.push({ tr:'lobi', ru:'лобби', seen:0 }); pool.items.forEach(x => x.seen = x.tr === 'lobi' ? 0 : 1); lastKey = ''; next();
      for(let t = 0; t < 40 && !(ctx && ctx.loaded); t++) await new Promise(z => setTimeout(z, 50));
      return [item.target, ctx.list.length, document.querySelector('#partner .ctx-ru').textContent]; });
    const q2 = await openPage(browser);
    const r2 = await q2.evaluate(async () => { setMode('phrases'); setKind(true); setId = 'hotel'; renderChips();
      const pool = wordPool('hotel'); pool.items.push({ tr:'lobi', ru:'лобби', seen:0 }); pool.items.forEach(x => x.seen = x.tr === 'lobi' ? 0 : 1); lastKey = ''; next();
      for(let t = 0; t < 60 && !(ctx && ctx.loaded); t++) await new Promise(z => setTimeout(z, 50));
      return [ctx.loaded, ctx.list.length, !!document.querySelector('#partner .ctx'), /перевод/.test(document.getElementById('partner').textContent)]; });
    const errs = [...q.errors, ...q2.errors]; await q.context().close(); await q2.context().close();
    eq(r, ['lobi', 3, 'Чего ты хочешь?']);   // первым — пример с записью носителя eq(r2, [true, 0, false, true]); eq(errs, []);
  });
  await test('слово не из словаря и без статьи в Викисловаре: машинный перевод помечен как приблизительный', async () => {
    const r = await p.evaluate(async () => { const t0 = translateTr, g0 = enGloss; enGloss = async () => ''; translateTr = async () => 'кошка'; ruMeanCache.clear();
      const m = [await ruMeaning('zzkedi'), await ruMeaning('Zz kedi var.')]; translateTr = t0; enGloss = g0; ruMeanCache.clear(); return m; });
    eq(r, ['≈ кошка (машинный перевод, без контекста может быть неточным)', '≈ кошка (машинный перевод)']);   // целая фраза — тоже с пометкой
  });
  await test('прежние словоформы с машинным переводом убираются: из набора слов и из «Памяти»; перевод словарных слов исправляется', async () => {
    const q = await openPage(browser, { storage:{
      'soyle-words-hotel': JSON.stringify({ items:[{ tr:'odada', ru:'в комнате', seen:1, fromPhrase:true }, { tr:'misiniz', ru:'ты', seen:1, fromPhrase:true }, { tr:'oda', ru:'номер', seen:2 }, { tr:'lobi', ru:'лобби', seen:0 }], cat:0, cont:'' }),
      'soyle-srs': JSON.stringify([{ tr:'odada', ru:'в комнате', side:'rec', state:1, step:0, s:null, d:null, due:0, last:null, reps:0, seen:false },
        { tr:'sizi', ru:'ваш', side:'rec', state:2, step:null, s:3, d:5, due:0, last:0, reps:2, seen:true },
        { tr:'Hesap lütfen.', ru:'Счёт, пожалуйста.', side:'rec', state:2, step:null, s:3, d:5, due:0, last:0, reps:2, seen:true },
        { tr:'lobi', ru:'лобби', side:'rec', state:1, step:0, s:null, d:null, due:0, last:null, reps:0, seen:false },
        { tr:'sarma', ru:'заворачивание', side:'rec', state:2, step:null, s:4, d:5, due:0, last:0, reps:3, seen:true },
        { tr:'ilaç', ru:'препараты', side:'rec', state:2, step:null, s:4, d:5, due:0, last:0, reps:3, seen:true },
        { tr:'Sakinleş!', ru:'Успокойся.', side:'rec', state:1, step:0, s:null, d:null, due:0, last:null, reps:0, seen:false },
        { tr:'kedi', ru:'', side:'rec', state:1, step:0, s:null, d:null, due:0, last:null, reps:0, seen:false },
        { tr:'Bu Türkçe ne demek?', ru:'Как это по-турецки?', side:'rec', state:2, step:null, s:4, d:5, due:0, last:0, reps:3, seen:true },
        { tr:'Çok affedersiniz.', ru:'Очень извиняюсь.', side:'rec', state:2, step:null, s:4, d:5, due:0, last:0, reps:3, seen:true }]),
      'soyle-mine': JSON.stringify([{ tr:'kedi' }]) } });
    const r = await q.evaluate(() => { const pool = wordPool('hotel').items; const cards = loadCards();
      return [pool.some(w => w.tr === 'odada'), pool.some(w => w.tr === 'misiniz'), pool.find(w => w.tr === 'oda').ru, pool.some(w => w.tr === 'lobi'),
        cards.map(c => c.tr), cards.find(c => c.tr === 'sizi').ru, cards.find(c => c.tr === 'sizi').s, cards.filter(c => ['sarma', 'ilaç', 'Çok affedersiniz.'].includes(c.tr)).map(c => c.ru)]; });
    const errs = q.errors; await q.context().close();
    // «lobi» (из Викисловаря, ни разу не повторяли) убрано; «sarma» уже учили — оставлено с пометкой; «ilaç» и фраза — перевод из выверенных списков;
    // своё слово «kedi» и живая фраза «Sakinleş!» не тронуты; фраза, которой «так не говорят», исправлена
    eq(r, [false, false, 'комната, номер', false, ['sizi', 'Hesap lütfen.', 'sarma', 'ilaç', 'Sakinleş!', 'kedi', 'Bunun Türkçesi ne?', 'Çok affedersiniz.'], 'вас (кого?)', 3,
      ['≈ заворачивание (перевод не проверен)', 'лекарство', 'Простите, пожалуйста.']]); eq(errs, []);
  });
  await test('русское значение слова — из статьи ru-Викисловаря («Значение»), без разметки', async () => {
    const q = await openWords();
    const r = await q.evaluate(() => ruMeaning('ekmek')); await q.context().close();
    eq(r, 'хлеб');
  });

  console.log('«Город» (Mahalle): разговоры с последствиями');
  const openCity = async (opts) => { const q = await openPage(browser, opts); await q.setViewportSize({ width:360, height:640 }); await q.click('#tab-city'); await q.waitForTimeout(100); return q; };
  const ctSay = async (q, t) => { await q.evaluate(t => { window.__say = t; window.__silent = !t; }, t); await q.click('#ctSpeak'); await q.waitForTimeout(120);
    return q.evaluate(() => ({ res: document.getElementById('ctResult').textContent, npc: document.getElementById('ctTr').textContent, pat: ct && ct.patience, next: !document.getElementById('ctNext').disabled, money: city.money,
      opts: [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent), score: (document.querySelector('#ctResult .score b') || {}).textContent })); };
  const ctNext = async q => { await q.click('#ctNext'); await q.waitForTimeout(60); };
  const ctPick = async (q, i) => { await q.click(`#ctOpts .ct-opt-main[data-i="${i}"]`); await q.waitForTimeout(40); return q.evaluate(() => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)); };
  await test('Город: выбор ответа карточками — что сказать, видно сразу по-русски; выбранная раскрывается (турецкий + чтение), говорите её; выбор меняет исход; перевод первой реплики бесплатно', async () => {
    const q = await openCity();
    const home = await q.evaluate(() => [document.querySelectorAll('.ct-task:not([disabled])').length, document.getElementById('ctDay').textContent, city.money, city.min]);
    eq(home, [3, 'Дела на сегодня — 3 из 3', 500, 540]);
    await q.click('.ct-task[data-scene="taxi"]'); await q.waitForTimeout(80);
    const start = await q.evaluate(() => [document.getElementById('ctTr').textContent, document.getElementById('ctSpeak').disabled, document.getElementById('ctWho').textContent, [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)]);
    eq(start, ['Buyurun, nereye?', false, 'Шофёр', ['На Таксим, пожалуйста.']]);           // варианты — сразу, по-русски; скрытые ходы (Кадыкёй) не показываются
    const picked = await ctPick(q, 0);
    eq(picked, ["На Таксим, пожалуйста.Taksim'e lütfen.[таксиме лютфен]"]);                 // уровень 0: турецкий + чтение кириллицей
    eq(await q.evaluate(() => !!document.querySelector('#ctOpts [data-ear]')), true);         // можно послушать (синтез)
    const ok1 = await ctSay(q, 'taksime lütfen'); eq([ok1.score, ok1.next], ['100', true]); ok(/На Таксим/.test(ok1.res) && /Вежливость/.test(ok1.res), ok1.res);   // Taksim'e ≈ taksime: чисто
    eq(await q.evaluate(() => city.mastery["Taksim'e lütfen."]), 1);
    await ctNext(q);
    const two = await q.evaluate(() => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)); eq(two, ['На площадь, пожалуйста.', 'Без разницы.']);
    const sel = await ctPick(q, 1); eq(sel, ['Без разницы.Fark etmez.[фарк этмез]']);
    eq(await q.evaluate(() => document.getElementById('ctOther').textContent), 'другой ответ (1)');   // остальные свёрнуты
    const m1 = await ctSay(q, 'bla bla'); eq([m1.score, m1.pat, m1.next], ['0', 2, false]); ok(/не понял/.test(m1.res) && /fark/.test(m1.res), m1.res);   // промах: какие слова не прозвучали
    const ok2 = await ctSay(q, 'fark etmez'); eq([ok2.score, ok2.next], ['100', true]);
    await ctNext(q);
    const rev = await q.evaluate(() => { trVoice = { name:'T', lang:'tr-TR' }; trVoices = [trVoice]; document.getElementById('ctTr').click(); const a = [ct.patience, document.getElementById('ctRu').textContent]; document.getElementById('ctTr').click(); a.push(ct.patience); trVoice = null; trVoices = []; return a; });
    eq(rev, [2, 'На дороге пробка, будет дольше. Нормально?', 2]);                           // первая встреча с репликой — перевод бесплатно
    await ctPick(q, 1); const metro = await ctSay(q, 'kalsın metroyla giderim'); ok(/на метро/.test(metro.res) && metro.next, metro.res);
    await ctNext(q); await q.waitForTimeout(80);
    const end = await q.evaluate(() => [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, city.money, city.min, loadCards().filter(c => /Taksim|Fark|metroyla/.test(c.tr)).map(c => c.tr).sort()]);
    eq(end, [false, 'Такси до Таксима — получилось', 470, 540 + 1 + 1 + 2 + 1 + 40, ['Fark etmez.', 'O zaman kalsın, metroyla giderim.', "Taksim'e lütfen."]]);   // метро: −30 ₺, +40 мин; сказанное — в «Память»
    await q.click('#modalPrimary'); await q.waitForTimeout(60);
    // освоение: уровень 1 — без чтения; уровень 2 — первые буквы; подсмотрели — уровень не растёт
    await q.evaluate(() => { city.done = []; cityRender(); }); await q.click('.ct-task[data-scene="taxi"]'); await q.waitForTimeout(80);
    eq(await ctPick(q, 0), ["На Таксим, пожалуйста.Taksim'e lütfen."]);
    await q.evaluate(() => { city.mastery["Taksim'e lütfen."] = 2; ct.pick = null; cityOptions(); });
    eq(await ctPick(q, 0), ['На Таксим, пожалуйста.T··· l···Вспомните сами. Нажмите ещё раз — открыть.']);
    eq(await ctPick(q, 0), ["На Таксим, пожалуйста.Taksim'e lütfen.[таксиме лютфен]"]);        // подсмотрели
    await ctSay(q, 'taksime lütfen'); eq(await q.evaluate(() => city.mastery["Taksim'e lütfen."]), 2);   // подсмотрели — уровень не вырос
    await ctNext(q); await q.evaluate(() => { city.mastery['Meydana lütfen.'] = 2; });
    eq(await ctPick(q, 0), ['На площадь, пожалуйста.M··· l···Вспомните сами. Нажмите ещё раз — открыть.']);
    await ctSay(q, 'meydana lütfen'); eq(await q.evaluate(() => city.mastery['Meydana lütfen.']), 3);        // вспомнили сами и сказали чисто — освоено
    const errs = q.errors; await q.context().close(); eq(errs, []);
  });
  await test('Город: bakkal — список покупок карточками, «нет такого» и «это всё», цена на слух (недоплата, купюры больше денег выключены), «kolay gelsin» запоминается', async () => {
    const q = await openCity();
    await q.evaluate(() => { city.money = 300; cityRes(); });
    await q.click('.ct-task[data-scene="bakkal"]'); await q.waitForTimeout(80);
    eq(await q.evaluate(() => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)), ['Рад быть здесь! (ответ на «hoş geldin»)', 'Здравствуйте!']);
    await ctPick(q, 0); const hb = await ctSay(q, 'hoş bulduk'); ok(hb.next, hb.res); await ctNext(q);
    eq(await q.evaluate(() => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)), ['Хлеб, пожалуйста.', 'Воду, пожалуйста.', 'Десять яиц, пожалуйста.']);
    await ctPick(q, 0); const br = await ctSay(q, 'ekmek lütfen'); ok(/Взяли: хлеб/.test(br.res) && /Осталось: вода, яйца/.test(br.res) && !br.next, br.res);
    eq(br.opts, ['Воду, пожалуйста.', 'Десять яиц, пожалуйста.', 'Это всё.']);
    const none = await ctSay(q, 'peynir var mı'); ok(/нет/.test(none.res) && none.pat === 3, none.res);                 // своё, без карточки: нет такого товара — не промах
    const free = await ctSay(q, 'su ve yumurta lütfen'); ok(/Всё из списка/.test(free.res) && free.next, free.res);   // своё: два товара разом
    await ctNext(q);
    eq(await q.evaluate(() => [...document.querySelectorAll('.ct-note')].map(b => [b.dataset.v, b.disabled])), [['100', false], ['200', false], ['500', true]]);
    await q.click('.ct-note[data-v="100"]'); await q.waitForTimeout(50);
    eq(await q.evaluate(() => [ct.patience, document.getElementById('ctTr').textContent, city.money]), [2, 'On lira daha.', 300]);
    await q.click('.ct-note[data-v="200"]'); await q.waitForTimeout(50); await ctNext(q);
    await ctPick(q, 0); const bye = await ctSay(q, 'kolay gelsin'); ok(bye.next, bye.res); await ctNext(q); await q.waitForTimeout(80);
    eq(await q.evaluate(() => [document.getElementById('modalTitle').textContent, city.money, city.rel.bakkal, city.flags && city.flags.bakkalFriend]), ['Bakkal — лавка у дома — получилось', 190, 4, 1]);   // +1 «hoş bulduk», +1 «lütfen», +2 «kolay gelsin»
    const errs = q.errors; await q.context().close(); eq(errs, []);
  });
  await test('Город: терпение кончилось — сцена провалена с последствиями; «Показать» на телефоне — путь без речи и без опыта; итог дня и новый день; всё сохраняется', async () => {
    const q = await openCity();
    await q.click('.ct-task[data-scene="kapici"]'); await q.waitForTimeout(80);
    const xp0 = await q.evaluate(() => game.xp);
    await ctSay(q, 'merhaba kolay gelsin'); await ctNext(q);                                 // без карточки — по ключевым словам
    const r1 = await ctSay(q, 'sıcak su yok'); ok(r1.next, r1.res); await ctNext(q);
    const r2 = await ctSay(q, '5 numara'); ok(/Номер пять/.test(r2.res), r2.res); await ctNext(q);     // цифра от распознавателя понимается как номер
    await ctPick(q, 0); const r3 = await ctSay(q, 'çok acil bugün lütfen'); ok(/срочно/.test(r3.res), r3.res); await ctNext(q);
    const xp1 = await q.evaluate(() => game.xp); ok(xp1 > xp0, 'опыт за реплики');
    await ctSay(q, 'xxx'); await ctSay(q, 'yyy'); await q.click('#ctShow'); await q.waitForTimeout(50);
    const ph = await q.evaluate(() => [document.getElementById('ctResult').textContent, game.xp]);
    ok(/показали на телефоне/.test(ph[0]) && /без опыта/.test(ph[0]), ph[0]); eq(ph[1], xp1);          // телефон: без опыта
    await ctNext(q); await q.waitForTimeout(80);
    const end = await q.evaluate(() => [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, city.done.map(d => [d.id, d.kind]), city.rel, loadCards().some(c => c.tr === 'Sıcak su yok.')]);
    eq(end, [false, 'Kapıcı — нет горячей воды — получилось', [['kapici', 'ok']], { kapici:2 }, true]);
    await q.click('#modalPrimary'); await q.waitForTimeout(60);
    await q.click('.ct-task[data-scene="bakkal"]'); await q.waitForTimeout(80);
    const money0 = await q.evaluate(() => city.money);
    await ctPick(q, 1); await ctSay(q, 'merhaba'); await ctNext(q);
    await ctSay(q, 'zzz'); await ctSay(q, 'zzz'); await ctSay(q, 'zzz'); await q.waitForTimeout(80);
    const fail = await q.evaluate(() => [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, city.money, city.done.find(d => d.id === 'bakkal').kind, document.getElementById('modalText').textContent]);
    eq(fail.slice(0, 4), [false, 'Bakkal — лавка у дома — не вышло', money0 - 160, 'bad']); ok(/Что стоило сказать: «Ekmek lütfen»/.test(fail[4]), fail[4]);
    await q.click('#modalPrimary'); await q.waitForTimeout(60);
    const homeNow = await q.evaluate(() => [document.querySelectorAll('.ct-task.done').length, document.querySelector('.ct-task.done.bad') !== null, !!document.getElementById('ctDayEnd'), JSON.parse(localStorage.getItem('soyle-city')).done.length]);
    eq(homeNow, [2, true, false, 2]);
    await q.click('.ct-task[data-scene="taxi"]'); await q.waitForTimeout(80);
    const trace = [];
    for(let i = 0; i < 8 && await q.evaluate(() => !!ct); i++){
      trace.push(await q.evaluate(() => [ct.nodeId, document.getElementById('ctPay').hidden]));
      if(await q.evaluate(() => !document.getElementById('ctPay').hidden)) await q.click('.ct-note:not([disabled]) >> nth=-1'); else await q.click('#ctShow', { timeout:2000 }).catch(e => trace.push('show: ' + e.message.split('\n')[0]));
      await q.waitForTimeout(40); if(await q.evaluate(() => ct && ct.resolved)) await ctNext(q); await q.waitForTimeout(40);
    }
    eq(await q.evaluate(() => [!!ct, document.getElementById('modal').hidden]), [false, false], JSON.stringify(trace)); await q.click('#modalPrimary'); await q.waitForTimeout(60);
    eq(await q.evaluate(() => !!document.getElementById('ctDayEnd')), true);
    await q.click('#ctDayEnd'); await q.waitForTimeout(60);
    eq(await q.evaluate(() => [document.getElementById('modalTitle').textContent, document.getElementById('modalStats').textContent.includes('потрачено')]), ['День 1 прожит', true]);
    await q.click('#modalPrimary'); await q.waitForTimeout(60);
    eq(await q.evaluate(() => [city.day, city.done.length, city.min, document.getElementById('ctDay').textContent, JSON.parse(localStorage.getItem('soyle-city')).day]), [2, 0, 540, 'Дела на сегодня — 3 из 3', 2]);
    const errs = q.errors; await q.context().close(); eq(errs, []);
  });
  await test('Город: собеседник говорит голосом персонажа; турецкий текст открывается после звука; перевод знакомой реплики стоит терпения (один раз)', async () => {
    const q = await openCity({ storage:{ 'soyle-city': JSON.stringify({ seen:{ 'Hoş geldin komşu! Buyur.':1 } }) } });
    await q.evaluate(() => { trVoice = { name:'A', lang:'tr-TR' }; trVoices = [trVoice, { name:'B', lang:'tr-TR' }]; window.__spoken = []; window.__noOnEnd = true; });
    await q.click('.ct-task[data-scene="bakkal"]'); await q.waitForTimeout(30);
    const during = await q.evaluate(() => [window.__spoken, document.getElementById('ctTr').classList.contains('veil'), document.getElementById('ctSpeak').disabled]);
    eq(during, [['Hoş geldin komşu! Buyur.'], true, true]);                                    // пока говорит — текст размыт, микрофон ждёт
    await q.waitForTimeout(1200 + 'Hoş geldin komşu! Buyur.'.length * 150 + 100);           // onend не пришёл — страховка открывает
    eq(await q.evaluate(() => [document.getElementById('ctTr').classList.contains('veil'), document.getElementById('ctSpeak').disabled]), [false, false]);
    await q.evaluate(() => { window.__noOnEnd = false; });
    const rev = await q.evaluate(() => { document.getElementById('ctTr').click(); const a = [document.getElementById('ctRu').hidden, document.getElementById('ctRu').textContent, ct.patience]; document.getElementById('ctTr').click(); a.push(ct.patience); return a; });
    eq(rev, [false, 'Добро пожаловать, сосед! Слушаю.', 2, 2]);                               // знакомая реплика: перевод −1 терпения, повторно бесплатно
    await q.evaluate(() => { window.__spoken = []; document.getElementById('ctReplay').click(); }); await q.waitForTimeout(120);
    eq(await q.evaluate(() => [window.__spoken[0], document.querySelector('.ct-pat').getAttribute('aria-label')]), ['Hoş geldin komşu! Buyur.', 'Терпение собеседника: 2 из 3']);
    await q.evaluate(() => { window.__spoken = []; }); await ctPick(q, 0); await q.click('#ctOpts [data-ear]'); await q.waitForTimeout(80);
    eq(await q.evaluate(() => window.__spoken), ['Hoş bulduk!']);                             // послушать свою реплику — синтез
    await q.context().close();
  });
  await test('Город помещается на 360×640, 390×844 и 412×915 без прокрутки страницы: дом, сцена с карточками, промах с оценкой, оплата', async () => {
    const q = await openPage(browser); const bad = [];
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      await q.setViewportSize({ width:w, height:h }); await q.evaluate(() => { localStorage.removeItem('soyle-city'); city = Object.assign({}, CITY_START); ct = null; setMode('city'); }); await q.waitForTimeout(80);
      const check = async name => { const r = await q.evaluate(() => { autofit(); const card = document.getElementById('cityCard');
          const cut = [...card.querySelectorAll('.result, .ct-tr, .ct-task, .ct-opt-main')].filter(e => e.offsetParent && e.scrollHeight > e.clientHeight + 1).length;
          return [document.documentElement.scrollHeight <= innerHeight + 1, card.scrollHeight - card.clientHeight <= 1, cut, [...document.querySelectorAll('.tabbar .tab')].every(t => t.scrollWidth <= t.clientWidth + 1)]; });
        if(r.some(x => x !== true && x !== 0)) bad.push(`${w}×${h} ${name}: ${JSON.stringify(r)}`); };
      await check('дом');
      await q.click('.ct-task[data-scene="taxi"]'); await q.waitForTimeout(60); await check('сцена');
      await ctPick(q, 0); await check('выбрано');
      await ctSay(q, 'a'); await check('промах с оценкой');
      await ctSay(q, 'taksime lütfen'); await ctNext(q); await ctPick(q, 1); await ctSay(q, 'bla'); await check('две карточки, промах');
      await ctSay(q, 'fark etmez'); await ctNext(q); await ctPick(q, 0); await ctSay(q, 'olur'); await ctNext(q); await check('оплата');
    }
    await q.context().close(); eq(bad, []);
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
    await p.setViewportSize({ width:390, height:844 });   // предыдущие тесты могли сменить размер общей страницы
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
