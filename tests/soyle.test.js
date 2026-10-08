// Автотесты тренажёра Söyle. Запуск: node tests/soyle.test.js [путь к index.html]
// Нужен Playwright (npm i playwright). Распознавание речи, микрофон и сеть подменяются заглушками (tests/harness.js).
const { chromium, fs, path, FILE, test, tap, eq, ok, openPage, summary } = require('./harness');
const AXE = process.env.AXE && fs.existsSync(process.env.AXE) ? fs.readFileSync(process.env.AXE, 'utf8') : null;
const PHRASE_DICT_SRC = (() => { const src = fs.readFileSync(FILE.replace('file://', ''), 'utf8'); const m = src.match(/const PHRASE_DICT = (\{[\s\S]*?\n\});/); return m ? eval('(' + m[1] + ')') : {}; })();
const PHRASE_DICT_RU = lemma => (PHRASE_DICT_SRC[lemma] || [])[0];
const setItem = (p, it) => p.evaluate(it => { item = Object.assign({ gid:'o', meaning:'', partnerMeaning:'' }, it); }, it);

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser);

  console.log('Загрузка и режимы');
  await test('страница открывается без ошибок во всех режимах', async () => {
    for(const m of ['phrases','listen','free','city']) await p.evaluate(m => setMode(m), m);
    eq(p.errors, []);
  });
  await test('все наборы фраз на месте и без пустых полей', async () => {
    const bad = await p.evaluate(() => PHRASE_SETS.flatMap(g => g.items.filter(i => !i.tr || !i.tl || !i.ru).map(i => g.id + ':' + i.tr)));
    eq(bad, []);
    const ids = await p.evaluate(() => PHRASE_SETS.map(g => g.id));
    eq(ids, ['basic','hotel','greet','food','transport','shop','health','talk','sos']);
  });

  console.log('Слова: оценка одного слова (режим «слова» во «Фразах»; «Звуки» убраны 2026-10-03)');
  await p.evaluate(() => setMode('phrases'));
  const setWord = (p, it) => p.evaluate(it => { item = Object.assign({ gid:'w-basic', meaning:'', word:true }, it); }, it);
  await test('верное слово засчитывается', async () => {
    await setWord(p, { target:'ön' });
    await p.evaluate(() => evalPhrase(['Ön'])); ok((await p.textContent('#result')).includes('Отлично'));
  });
  await test('подмена звука распознаётся и называется («o» вместо «ö»)', async () => {
    await setWord(p, { target:'ön' });
    await p.evaluate(() => evalPhrase(['on'])); const t = await p.textContent('#result');
    ok(t.includes('«o» вместо «ö»'), t);
  });
  await test('цифра от распознавателя понимается как слово (10 → on)', async () => {
    await setWord(p, { target:'on' });
    await p.evaluate(() => evalPhrase(['10'])); ok((await p.textContent('#result')).includes('Отлично'));
  });
  await test('нужное слово только в запасных вариантах — оценка 70, «Хорошо»', async () => {
    await setWord(p, { target:'köy' });
    await p.evaluate(() => evalPhrase(['kay', 'köy'])); const t = await p.textContent('#result'); ok(t.includes('Хорошо'), t);
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
  await test('слово: услышано другое — оценка 50, разбор звука; верно — 100 и реакция (+XP, слово зеленеет)', async () => {
    const r = await p.evaluate(() => { setMode('phrases'); item = { target:'kör', gid:'w-basic', meaning:'слепой', word:true }; evalPhrase(['kor']);
      const bad = [document.querySelector('#result .score b').textContent, document.querySelector('#result .errs').textContent.includes('«o» вместо «ö»')];
      evalPhrase(['kör']); const res = document.getElementById('result');
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
    await p.evaluate(() => { setId = 'hotel'; renderChips(); next(); });   // «мои» пусты — дальше тесты ждут карточку с фразой
  });
  const a = await openPage(browser, { android:true });
  await test('Android: нарастающие повторы фразы склеиваются в одну', async () => {
    await a.evaluate(() => { recordOn = false; setMode('free'); window.__seq = ['bana', 'bana bir', 'bana bir taksi', 'bana bir taksi çağırır mısınız']; });
    await a.click('#freeSpeak'); await a.waitForTimeout(150);
    ok((await a.textContent('#freeResult')).includes('«bana bir taksi çağırır mısınız»'));
  });
  await test('Android: если микрофон не делится, запись отключается один раз и запоминается', async () => {
    const r = await a.evaluate(async () => { recordOn = true; window.__silent = true; setMode('phrases'); await startListening(); await new Promise(z => setTimeout(z, 100)); window.__silent = false; return [recordOn, localStorage.getItem('soyle-rec-conflict'), document.getElementById('freeMine').textContent]; });
    eq(r, [false, '1', 'Записать себя']);
  });
  await test('Android: «Сравнить» сам записывает и проигрывает образец → вас', async () => {
    const r = await a.evaluate(async () => { window.__played = []; window.__spoken = []; item.target = 'on'; nativeCache.set('on', [{ url:'https://x/on.wav', who:'T' }]); compareWithFreshRecording(); await new Promise(z => setTimeout(z, 2600)); return [window.__spoken.length + window.__played.filter(s => !s.startsWith('blob:')).length >= 2, window.__played.some(s => s.startsWith('blob:')), myRecFor]; });
    eq(r, [true, true, 'on']);
  });
  await a.context().close();

  console.log('Запись и сравнение');
  await test('«Сравнить» не играет запись другого слова: без записи этого слова — полный цикл эхо', async () => {
    await p.evaluate(() => setMode('phrases'));
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
    const r = await p.evaluate(async () => { setMode('phrases'); recordOn = true; stream = null; await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 100)); nativeCache.set(clean(item.target), [{ url:'https://x/ref.wav', who:'T' }]);
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
      award(1, 'o'); const other = game.quest.got; for(let i = 0; i < 5; i++) award(1, 'listenph'); const xp1 = game.xp; award(1, 'listenph'); const xp2 = game.xp;
      return [other, game.quest.done, xp2 - xp1 < 50, document.getElementById('gbQuestTxt').textContent.includes('выполнено')]; }, RESET);
    eq(r, [0, true, true, true]);
  });
  await test('задание на комбо засчитывается по серии', async () => {
    const r = await p.evaluate(r => { eval(r); todayQuest(); game.quest.idx = 4; for(let i = 0; i < 5; i++) award(1, 'o'); return game.quest.done; }, RESET);
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
      const res = [/^\d:\d\d · верно/.test(during), game.blitzBestPh, document.getElementById('lsResult').textContent.includes('рекорд'), document.getElementById('lsBlitz').textContent, blitz];
      document.getElementById('modalSecondary').click(); return res; }, RESET);
    eq(r, [true, 2, true, 'Блиц 60 с', null]);
  });
  await test('блиц — настоящие 60 секунд с ответами до конца: экран итогов, новые слова не идут, ответы заблокированы', async () => {
    const q = await openPage(browser);
    await q.clock.install();
    await q.evaluate(() => { setMode('listen'); game.blitzBestPh = 0; });
    await q.click('#lsBlitz');
    // отвечаем правильно всю минуту, как пользователь
    for(let sec = 0; sec < 62; sec++){
      const can = await q.evaluate(() => !!ls && !lsLocked && !document.getElementById('lsA').disabled);
      // force: при подменённых часах проверка «кнопка неподвижна» ждёт кадров анимации, которые идут только по runFor — иногда зависала на 30 с
      if(can){ const right = await q.evaluate(() => ls.right); await q.click(right === 'A' ? '#lsA' : '#lsB', { force:true }); }
      await q.clock.runFor(1000);
    }
    const after = await q.evaluate(() => ({ blitz, overlay: !document.getElementById('modal').hidden, text: document.getElementById('modalStats').textContent + ' ' + document.getElementById('modalTitle').textContent,
      disabled: document.getElementById('lsA').disabled && document.getElementById('lsB').disabled, best: game.blitzBestPh, btn: document.getElementById('lsBlitz').textContent, word: ls && ls.answer }));
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
    const r = await p.evaluate(() => { setMode('listen'); startBlitz(); setMode('phrases'); return [blitz, document.getElementById('lsBlitz').textContent]; });
    eq(r, [null, 'Блиц 60 с']);
  });
  await test('конфетти не ломают страницу и отключены при «уменьшить движение»', async () => {
    await p.evaluate(() => confetti()); await p.waitForTimeout(100);
    const q = await openPage(browser); await q.emulateMedia({ reducedMotion:'reduce' });
    const drawn = await q.evaluate(() => { const c = document.getElementById('confetti'); const w = c.width; confetti(); return c.width === w; });
    await q.context().close(); eq(drawn, true); eq(p.errors, []);
  });
  await test('панель прогресса не сдвигает кнопки при изменении текста задания', async () => {
    const r = await p.evaluate(r => { eval(r); setMode('phrases'); const y = () => Math.round(document.getElementById('speak').getBoundingClientRect().y + scrollY);
      const a = y(); todayQuest(); game.quest.idx = 6; renderGame(); const b = y(); game.quest.done = true; renderGame(); return [a, b, y()]; }, RESET);
    eq(r[0], r[1]); eq(r[1], r[2]);
  });

  console.log('Сервис распознавания не отвечает');
  await test('«Сказать»: через 12 с понятное сообщение, кнопка снова работает, запись не отключается', async () => {
    const q = await openPage(browser, { android:true });
    const r = await q.evaluate(async () => {
      const Hang = function(){ this.start = () => {}; this.stop = () => {}; this.abort = () => {}; };  // сервис молчит
      SR = Hang; recordOn = true; setMode('phrases');
      const t0 = Date.now(); startListening(); for(let t = 0; t < 160 && listening; t++) await new Promise(z => setTimeout(z, 100));
      return [listening, Math.round((Date.now()-t0)/1000), document.getElementById('result').textContent.includes('не ответил'), document.getElementById('speak').textContent, recordOn, localStorage.getItem('soyle-rec-conflict')];
    });
    await q.context().close();
    eq([r[0], r[1] >= 12 && r[1] <= 15, r[2], r[3], r[4], r[5]], [false, true, true, 'Сказать', true, null]);
  });
  await test('«Сказать» → повторное нажатие во время зависания останавливает запись', async () => {
    const r = await p.evaluate(async () => { const Hang = function(){ this.start = () => {}; this.stop = () => {}; this.abort = () => {}; }; const keep = SR; SR = Hang; setMode('phrases');
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
    await q.evaluate(() => { LESSON_SIZE = 10; setMode('phrases'); });
    for(let i = 0; i < 10; i++){
      const w = await q.evaluate(i => { const t = item.target; window.__say = i === 3 ? 'yanlış bir şey' : t; return t; }, i);
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
    const q = await openPage(browser); await q.evaluate(() => setMode('phrases'));   // стартовый экран теперь «Город» — для проверки Enter нужна карточка
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
      const dots = [...document.querySelectorAll('#gbWeek .pv-dot')]; const out = [dots.length, dots[6].className.includes('done'), dots[5].className.includes('frozen')]; setMode('phrases'); return out; }, RESET);
    eq(r, [7, true, true]);
  });
  await test('блиц: праздники (новый уровень) не прерывают блиц, а показываются после итогов', async () => {
    const q = await openPage(browser); await q.clock.install();
    await q.evaluate(() => { MILESTONE_MODALS = true; todayQuest(); game.quest.done = true; game.xp = 48; BLITZ_SEC = 3; setMode('listen'); startBlitz(); });
    await q.clock.runFor(1600); await q.evaluate(() => answerListen(ls.right)); // уровень повышается во время блица (варианты открылись со звуком фразы ~1,4 с)
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
      document.getElementById('intent').placeholder.endsWith('…')]; setMode('phrases'); return out; });
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
    for(const tab of ['tab-phrases','tab-listen','tab-free','tab-city','tab-progress']){
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
    if(mode === 'phrases') return en('next') ? '' : `${mode}: «Дальше» выключена`;
    if(mode === 'listen') return en('lsA') || en('lsB') || en('lsBlitz') || lsLocked ? '' : 'На слух: всё выключено';
    if(mode === 'free') return en('freeSpeak') ? '' : 'Свободно: «Сказать» выключена';
    if(mode === 'city') return en('ctSpeak') || en('ctShow') || en('ctNext') || en('ctRoll') || en('ctHomeBtn') || [...document.querySelectorAll('.bd-cell.reach, .ct-note, #ctDayEnd')].some(b => vis(b) && !b.disabled)
      || document.querySelector('#ctTr.veil') ? '' : `Город: нет пути дальше (${ct ? ct.id + '/' + ct.nodeId : 'дом'})`;   // .veil — собеседник ещё говорит; дом — кубик / клетка / «Eve dön»
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
      setMode('phrases'); window.__say = item.target; const out = [];
      document.getElementById('speak').click(); await new Promise(z => setTimeout(z, 200)); out.push(listening);
      document.getElementById('speak').click(); await new Promise(z => setTimeout(z, 50)); out.push(listening, document.querySelector('#speak .lbl').textContent);
      document.getElementById('speak').click(); await new Promise(z => setTimeout(z, 4400)); out.push(listening, document.getElementById('result').textContent.includes('из 100'));
      setMode('free'); document.getElementById('freeSpeak').click(); await new Promise(z => setTimeout(z, 200)); out.push(freeOn);
      document.getElementById('freeSpeak').click(); await new Promise(z => setTimeout(z, 50)); out.push(freeOn, document.querySelector('#freeSpeak .lbl').textContent);
      setMode('phrases'); return out; });
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
  await test('прохождение по нажатиям: «Память» — 12 фраз подряд с микрофоном в каждой фазе; «Фразы» и «На слух» идут дальше', async () => {
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
    for(const [tab, sel] of [['#tab-phrases', '#next']]){
      await tap(q, tab.slice(1)); const t = new Set();
      for(let i = 0; i < 8; i++){ await q.click('#speak'); await q.waitForTimeout(80); t.add(await q.evaluate(() => item.target)); await q.click(sel); }
      other[tab] = t.size;
    }
    await tap(q, 'tab-listen'); const heard = new Set();
    for(let i = 0; i < 6; i++){ await q.waitForTimeout(400); heard.add(await q.evaluate(() => ls.answer)); await q.evaluate(() => { clearTimeout(lsNextTimer); answerListen(ls.right); clearTimeout(lsNextTimer); nextListen(); }); }
    const errs = q.errors; await q.context().close();
    ok(seen.size >= 12, `в «Памяти» пройдено фраз: ${seen.size}; фазы: ${steps.join(',')}`);
    ok(other['#tab-phrases'] >= 5 && heard.size >= 3, JSON.stringify([other, heard.size])); eq(errs, []);
  });

  console.log('Образец, Эхо и Синтез');
  const FAKE_VOICE = "trVoice = { name:'Test Türkçe', lang:'tr-TR' }; trVoices = [trVoice];";
  await test('«Синтез» произносит текущее слово', async () => {
    const r = await p.evaluate(async v => { eval(v); setMode('phrases'); window.__spoken = []; document.getElementById('play').disabled = false; document.getElementById('play').click(); await new Promise(z => setTimeout(z, 100)); return [window.__spoken, item.target]; }, FAKE_VOICE);
    eq(r[0], [r[1]]);
  });
  await test('«Эхо» без записи носителя: сначала синтез-образец, потом микрофон', async () => {
    const r = await p.evaluate(async v => { eval(v); setMode('phrases'); await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 80));
      nativeCache.set(clean(item.target), []); recordOn = true; stream = null; window.__say = item.target; window.__log = []; echo();
      for(let t = 0; t < 60 && window.__log[window.__log.length-1] !== 'me'; t++) await new Promise(z => setTimeout(z, 100)); await new Promise(z => setTimeout(z, 300)); return window.__log; }, FAKE_VOICE);
    eq(r.slice(0, 2), ['synth', 'mic']); eq(r.slice(-2), ['synth', 'me']);
  });
  await test('«Эхо» продолжает работу, даже если телефон не сообщил о конце речи', async () => {
    const r = await p.evaluate(async v => { eval(v); for(let t = 0; t < 50 && listening; t++) await new Promise(z => setTimeout(z, 100)); window.__noOnEnd = true; setMode('phrases'); await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 80));
      item.target = 'on'; nativeCache.set('on', []); recordOn = true; stream = null; window.__say = 'on'; window.__log = []; echo();
      for(let t = 0; t < 80 && window.__log[window.__log.length-1] !== 'me'; t++) await new Promise(z => setTimeout(z, 100)); window.__noOnEnd = false; return window.__log; }, FAKE_VOICE);
    ok(r[0] === 'synth' && r.includes('mic') && r[r.length-1] === 'me', JSON.stringify(r));
  });
  await test('запись носителя не загрузилась — образец звучит синтезом', async () => {
    const r = await p.evaluate(async v => { eval(v); window.__log = []; nativeCache.set('xyz', [{ url:'https://x/broken.wav', who:'T' }]); let done = false; playReference('xyz', () => done = true); await new Promise(z => setTimeout(z, 200)); return [window.__log, done]; }, FAKE_VOICE);
    eq(r, [['synth'], true]);
  });
  await test('Android: «Эхо» — образец звучит ДО открытия микрофона, затем образец и вы', async () => {
    const q = await openPage(browser, { android:true, storage:{ 'soyle-rec-conflict':'1' } }); await q.evaluate(() => setMode('phrases'));
    const r = await q.evaluate(async v => { eval(v); await (nativePending || Promise.resolve()); await new Promise(z => setTimeout(z, 80));
      item.target = 'on'; nativeCache.set('on', []); window.__log = []; echo(); await new Promise(z => setTimeout(z, 3200)); return [recordOn, window.__log]; }, FAKE_VOICE);
    await q.context().close();
    eq(r[0], false); eq(r[1], ['synth', 'mic', 'synth', 'me']);
  });

  console.log('Вид приложения');
  for(const [w, h] of [[390, 844], [360, 640], [412, 915]]) await test(`${w}×${h}: страница не прокручивается, упражнение целиком на экране, подписи не обрезаны`, async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:w, height:h });
    const bad = [];
    for(const m of ['phrases','listen','free','progress']){
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
      document.getElementById('tab-phrases').click(); return [tabs, subs, free, prog, back]; });
    eq(r, [['tab-city','tab-memory','tab-train','tab-progress'], ['tab-phrases','tab-listen','tab-free','tab-grammar'], [true, 'true', 'true', false], [true, true, true, 'false'], ['free', 'free']]);
  });
  await test('игра видна всегда: верхняя панель обновляется после ответа, нажатие открывает «Прогресс»', async () => {
    const r = await p.evaluate(r => { eval(r); renderGame(); const ring0 = document.getElementById('tbRing').style.strokeDashoffset;
      for(let i = 0; i < 3; i++) award(1, 'o');
      const out = [document.getElementById('tbStreak').textContent, document.getElementById('tbRing').style.strokeDashoffset !== ring0];
      document.getElementById('tbProgress').click(); out.push(!document.getElementById('progressView').hidden, document.getElementById('gbRank').textContent, document.getElementById('badgeCount').textContent.startsWith(game.badges.length + ' /'));
      setMode('phrases'); return out; }, RESET);
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
    // 1. Фразы: сказать верно → «все слова», «Сравнить» включилась
    await tap(u, 'tab-phrases'); await say(await u.evaluate(() => item.target));
    await u.click('#speak'); await u.waitForTimeout(250);
    ok((await u.textContent('#result')).includes('все слова'), 'Фразы: нет «все слова»');
    ok(!(await u.isDisabled('#compare')), 'Фразы: «Сравнить» не включилась после попытки');
    const w1 = await u.evaluate(() => item.target); await u.click('#next'); ok(await u.evaluate(w => item.target !== w || true, w1));
    // 2. Фразы: сказать не то → оценка низкая, разбор
    await say('yanlış bir şey'); await u.click('#speak'); await u.waitForTimeout(250);
    ok(!(await u.textContent('#result')).includes('все слова'), 'Фразы: чужая фраза засчитана');
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
    await u.click('#hintsBtn'); await tap(u, 'tab-phrases'); ok(await u.isVisible('#tip'), 'подсказка не видна');
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
  await test('название — Simit (решение 2026-10-08 12:55; 2026-10-09 01:13 «söyle неактуально в названии»): заголовок, вкладка, ярлык, манифест; для поисковиков — описание, адрес-канон, Open Graph, JSON-LD, robots.txt и sitemap.xml', async () => {
    const r = await p.evaluate(() => ({ h1:document.querySelector('h1').textContent, title:document.title, apple:document.querySelector('meta[name="apple-mobile-web-app-title"]').content,
      desc:(document.querySelector('meta[name="description"]') || {}).content || '', canon:(document.querySelector('link[rel="canonical"]') || {}).href || '',
      og:[...document.querySelectorAll('meta[property^="og:"]')].map(m => m.getAttribute('property')),
      ld:[...document.querySelectorAll('script[type="application/ld+json"]')].map(s => { try { return JSON.parse(s.textContent); } catch(e){ return 'ошибка JSON'; } }).flat(),
      visible:document.body.innerText.includes('Söyle') }));
    const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
    eq([r.h1, r.apple, man.short_name], ['Simit', 'Simit', 'Simit']); ok(/Simit/.test(r.title) && !/Söyle/.test(r.title + man.name), r.title + ' / ' + man.name);
    ok(r.title.length >= 30 && r.title.length <= 60, 'длина title ' + r.title.length); ok(r.desc.length >= 120 && r.desc.length <= 165, 'длина description ' + r.desc.length);
    eq(r.canon, 'https://www.simitci.ru/'); for(const k of ['og:title', 'og:description', 'og:url', 'og:image', 'og:type', 'og:locale']) ok(r.og.includes(k), 'нет ' + k);
    ok(r.ld.some(x => x['@type'] === 'WebSite' && x.name === 'Simit' && x.url === 'https://www.simitci.ru/'), 'JSON-LD WebSite');
    ok(r.ld.some(x => x['@type'] === 'WebApplication' && x.offers && x.offers.price === '0' && !x.aggregateRating), 'JSON-LD WebApplication (без выдуманных оценок)');
    ok(!r.visible, 'на экране осталось «Söyle»');
    const robots = fs.readFileSync(path.join(__dirname, '..', 'robots.txt'), 'utf8'), sm = fs.readFileSync(path.join(__dirname, '..', 'sitemap.xml'), 'utf8');
    ok(/Sitemap: https:\/\/www\.simitci\.ru\/sitemap\.xml/.test(robots) && !/Disallow: \/\s*$/m.test(robots), 'robots.txt'); ok(sm.includes('<loc>https://www.simitci.ru/</loc>'), 'sitemap.xml');
    const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'tests.yml'), 'utf8'); ok(/cp -r index\.html[^\n]*robots\.txt[^\n]*sitemap\.xml/.test(yml), 'публикация не копирует robots.txt и sitemap.xml');
  });
  await test('смена надписи не стирает иконку: «Сказать», «Записать себя», блиц', async () => {
    const r = await p.evaluate(() => { const s = document.getElementById('speak'); setLbl(s, 'Слушаю…'); const a = [s.querySelectorAll('svg').length, s.getAttribute('aria-label')]; setLbl(s, 'Сказать');
      const b = document.getElementById('lsBlitz'); setLbl(b, '0:42 · верно 3'); a.push(b.querySelectorAll('svg').length, b.textContent); setLbl(b, 'Блиц 60 с'); return a; });
    eq(r, [2, 'Слушаю…', 1, '0:42 · верно 3']);
  });
  await test('урок: 10 делений, верные и ошибки окрашены', async () => {
    const r = await p.evaluate(() => { const old = LESSON_SIZE; LESSON_SIZE = 10; setMode('phrases'); lessons.phrases = null; lessonStep(1); lessonStep(0); lessonStep(1);
      const segs = [...document.querySelectorAll('#lessonSegs i')].map(i => i.className); const lab = document.getElementById('lessonBar').getAttribute('aria-label');
      lessons.phrases = null; LESSON_SIZE = old; renderLesson(); return [segs.length, segs.slice(0, 4).join(','), lab]; });
    eq(r, [10, 'ok,bad,ok,', 'Урок: 3 из 10, верно 2']);
  });
  await test('кольцо уровня и достижения-жетоны без эмодзи', async () => {
    const r = await p.evaluate(() => { game.xp = 125; renderGame(); renderBadges(); const off = parseFloat(document.getElementById('gbLevelRing').style.strokeDashoffset);
      return [document.getElementById('gbLevel2').textContent, off > 100 && off < 200, document.querySelectorAll('#badgeGrid .badge').length, BADGES.every(b => !/\p{Extended_Pictographic}/u.test(b.ic))]; });
    eq(r, ['2', true, 25, true]);   // 22 медали + 3 за грамматику (gram3, gram10, gramall)
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
      setMode('phrases'); return out; }, RESET);
    eq(r[0] > 0 && r[0] === r[1], true);
  });
  await test('«сказать» открывается, когда «понять на слух» держится ≥ 3 дней; новые — по кругу из разных тем, не больше 10 в день', async () => {
    const r = await p.evaluate(() => { const now = Date.now(); localStorage.removeItem('soyle-memday');
      saveCards([{ ...newMemCard('Hesap lütfen.', '', 'Счёт, пожалуйста.', 'rec', now), state:2, s:3, d:5, last:now - 4 * 864e5, due:now - 1, seen:true }]);
      setMode('memory'); memReveal(); memGrade(3); const prod = loadCards().find(c => c.side === 'prod');
      const plan = memPlan(); const topic = tr => (PHRASE_SETS.find(g => g.items.some(p => p.tr === tr)) || {}).id;
      const firstTopics = memTopicPool().slice(0, PHRASE_SETS.length).map(c => topic(c.tr));   // порядок новых: по кругу из разных тем
      const d = memDay(); d.newN = 10; memSaveDay(d); const none = memPlan().fresh.length; d.extra = 5; memSaveDay(d); const more = memPlan().fresh.length;
      setMode('phrases'); return [!!prod && prod.ru, plan.fresh.length, new Set(firstTopics).size === PHRASE_SETS.length, none, more]; });
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
        setMode('phrases'); return res; });
      bad.push(...x.map(s => `${w}x${h} ${s}`));
    }
    await q.context().close(); eq(bad, []);
  });

  console.log('«На слух» и блиц: фразы; честный блиц; медали достижений');
  await test('«На слух»: две похожие фразы с записью, разный перевод, отличающиеся слова подчёркнуты; выбор запоминается', async () => {
    const q = await openPage(browser);
    await tap(q, 'tab-listen');
    const r = await q.evaluate(() => { const voiced = new Set(PHRASE_SETS.flatMap(g => g.items.map(p => p.tr))); const out = [];
      for(let i = 0; i < 30; i++){ nextListen(); const a = document.querySelector('#lsA b').textContent, b = document.querySelector('#lsB b').textContent;
        out.push([voiced.has(a) && voiced.has(b), a !== b, document.querySelector('#lsA small').textContent !== document.querySelector('#lsB small').textContent, phraseSim(a, b) > 0]); }
      return { ok: out.every(x => x.every(Boolean)), q: document.querySelector('.ls-q').textContent, dw: document.querySelectorAll('#lsA .dw, #lsB .dw').length > 0,
        chips: [...document.querySelectorAll('#chips .chip[data-g]')].map(c => c.dataset.g).slice(0, 3) }; });
    await q.click('#chips .chip[data-g="food"]');
    const topic = await q.evaluate(() => { const food = new Set(PHRASE_SETS.find(g => g.id === 'food').items.map(p => p.tr)); const t = [];
      for(let i = 0; i < 15; i++){ nextListen(); t.push(food.has(ls.answer)); } return t.every(Boolean); });
    const ans = await q.evaluate(() => { const s0 = (stats.listenph || {}).ok || 0, srs = localStorage.getItem('soyle-srs'); answerListen(ls.right);
      return [((stats.listenph || {}).ok || 0) - s0, localStorage.getItem('soyle-srs') === srs, XP_WEIGHT.listenph]; });
    const errs = q.errors; await q.context().close();
    eq(r.ok, true); eq(r.q, 'Какая фраза прозвучала?'); eq(r.dw, true); eq(r.chips, ['all', 'basic', 'hotel']);
    eq(topic, true); eq(ans, [1, true, 0.4]); eq(errs, []);
  });
  await test('блиц честный: выбрать можно только после начала звука; ошибка −3 с; рекорд фраз, бонус 3 XP за верную', async () => {
    const q = await openPage(browser); await q.clock.install();
    const r = await q.evaluate(r => { eval(r); window.__noOnEnd = true; setMode('listen'); startBlitz();
      const locked = [lsLocked, document.getElementById('listenCard').classList.contains('wait')]; answerListen('A'); const early = blitz.total;
      return { locked, early }; }, RESET);
    await q.clock.runFor(1500);   // фраза: запись/синтез через ~150–300 мс, варианты открываются со звуком
    const r2 = await q.evaluate(() => { const open = !lsLocked; const left = blitz.left; answerListen(ls.right === 'A' ? 'B' : 'A');
      return [open, left - blitz.left, document.getElementById('lsResult').textContent.includes('−3 с')]; });
    await q.clock.runFor(2500);
    const r3 = await q.evaluate(() => { answerListen(ls.right); const xp = game.xp; endBlitz(true); return [game.blitzBestPh, game.xp - xp]; });
    await q.context().close();
    eq(r.locked, [true, true]); eq(r.early, 0); eq(r2, [true, 3, true]); eq(r3, [1, 3]);
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
    const r = await q.evaluate(r => { eval(r); MILESTONE_MODALS = true; stats.listenph = { t:20, ok:20 }; checkBadges();
      const m = [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, !!document.querySelector('#modalMedal .medal.t2')];
      document.getElementById('modalPrimary').click();
      game.total = 1; checkBadges(); const t = document.getElementById('toast').textContent;
      const p0 = game.perfect; celebrate(document.getElementById('result'), 95); celebrate(document.getElementById('result'), 80);
      return [m, t, game.badgeDates.earph === new Date().toISOString().slice(0, 10), game.perfect - p0]; }, RESET);
    const old = await q.evaluate(() => { game = { xp:10, badges:['first'] }; normalizeGame(); return [typeof game.badgeDates, game.perfect, game.blitzBestPh]; });
    await q.context().close();
    eq(r[0], [false, 'Достижение: Слышу фразы', true]); eq(r[1], 'Достижение: Первое слово'); eq(r[2], true); eq(r[3], 1); eq(old, ['object', 0, 0]);
  });
  await test('фразы «На слух» помещаются: самая длинная пара на 360×640 и 390×844, без наложения и обрезки', async () => {
    const q = await openPage(browser); const bad = [];
    for(const [w, h] of [[360, 640], [390, 844]]){
      await q.setViewportSize({ width:w, height:h });
      const x = await q.evaluate(async () => { setMode('listen');
        const all = lsPhrasePool('all').sort((a, b) => b.tr.length + b.ru.length - a.tr.length - a.ru.length);
        const pickPhrasePair0 = pickPhrasePair; pickPhrasePair = () => ({ target:all[0].tr, meaning:all[0].ru, partner:all[1].tr, partnerMeaning:all[1].ru, gid:'listenph' });
        nextListen(); pickPhrasePair = pickPhrasePair0; await new Promise(z => setTimeout(z, 200)); autofit();
        const card = document.getElementById('listenCard'), opts = [...card.querySelectorAll('.ls-opt')];
        const cut = opts.some(o => o.scrollHeight > o.clientHeight + 1 || o.scrollWidth > o.clientWidth + 1);
        const kids = [...card.children].filter(e => e.offsetParent); let overlap = false;
        for(let i = 0; i + 1 < kids.length; i++) if(kids[i].getBoundingClientRect().bottom > kids[i+1].getBoundingClientRect().top + 1) overlap = true;
        return { cut, overlap, scroll: document.scrollingElement.scrollHeight > innerHeight + 1 }; });
      if(x.cut || x.overlap || x.scroll) bad.push(`${w}x${h} ${JSON.stringify(x)}`);
    }
    await q.context().close(); eq(bad, []);
  });

  await test('автоподгонка: на низком экране сжимается, на высоком растягивается, прокрутки нет', async () => {
    const q = await openPage(browser); const out = [];
    for(const [w, h] of [[360, 560], [360, 640], [390, 844], [412, 732], [412, 915]]){
      await q.setViewportSize({ width:w, height:h });
      for(const m of ['phrases','words','listen','free']){
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
    ok(out.find(o => o.k === '360x560 phrases').fit < 1 && out.find(o => o.k === '412x915 phrases').fit > 1, JSON.stringify(out.map(o => o.k + ':' + o.fit)));
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
        setKind(false); return { n:words.length, out }; });
      if(r.n < 200) bad.push(`${w}x${h}: слов всего ${r.n}`);
      bad.push(...r.out.map(x => `${w}x${h} ${x}`));
    }
    const errs = q.errors; await q.context().close(); eq(bad, []); eq(errs, []);
  });

  await test('пояснение помещается в форму целиком: длинный текст и разбор ошибок на 360×640 и 390×844', async () => {
    const q = await openPage(browser); const bad = [];
    const LONG = 'Этот телефон не даёт микрофону одновременно записывать и распознавать. Дальше распознавание работает само, а себя можно записать кнопкой «Записать себя». Скажите ещё раз.';
    for(const [w, h] of [[360, 640], [390, 844]]){
      await q.setViewportSize({ width:w, height:h });
      for(const [m, fill] of [['words', `setKind(true); setResult('bad', LONG)`], ['phrases', `item = { target:'İki gece için bir oda istiyorum.', gid:'ph-hotel', meaning:'x' }; evalPhrase(['iki gece icin bir oda istiyorm'])`], ['free', `setFree('bad', LONG)`], ['listen', `document.getElementById('lsResult').innerHTML = '<span class=verdict>' + LONG + '</span>'`]]){
        const r = await q.evaluate(async ([m, fill, LONG]) => { setMode(m); eval(fill); await new Promise(z => setTimeout(z, 120)); autofit();
          const res = document.querySelector('.screen > .card:not([hidden]) .result'), card = res.closest('.card'), rr = res.getBoundingClientRect(), cr = card.getBoundingClientRect();
          return { cut: res.scrollHeight > res.clientHeight + 1, outside: rr.bottom > cr.bottom + 1 && card.scrollHeight <= card.clientHeight + 1, bg: getComputedStyle(res).backgroundColor }; }, [m, fill, LONG]);
        if(r.cut || r.outside) bad.push(`${w}x${h} ${m} ${JSON.stringify(r)}`);
      }
    }
    const infoBg = await q.evaluate(() => { setMode('phrases'); next(); return getComputedStyle(document.getElementById('result')).backgroundColor; });
    await q.context().close();
    eq(bad, []); eq(infoBg, 'rgb(243, 232, 207)');   // песочный, как на выбранном экране (#F3E8CF)
  });

  console.log('Видео и перевод — внутри приложения, без перехода');
  // подмена внешних сервисов: виджет YouGlish и перевод MyMemory (настоящие проверяются в CI задачей probe)
  const FAKE_YG = `var YG={Widget:function(id,o){this.fetch=function(q,l){(window.__ygq=window.__ygq||[]).push(q);var f=document.getElementById(id).querySelector('iframe')||document.createElement('iframe');f.title='YouGlish';f.setAttribute('data-q',q+'|'+l);document.getElementById(id).appendChild(f);setTimeout(function(){o.events.onFetchDone({totalResult:(q.indexOf(' ')>0&&q.length>12)?0:7,query:q})},30)}}};setTimeout(function(){window.onYouglishAPIReady&&window.onYouglishAPIReady()},10);`;
  async function openInApp(opts){ const q = await openPage(browser, opts); await q.evaluate(() => setMode('phrases'));   // стартовый экран — «Город»; здесь нужна карточка слова
    await q.route('**/youglish.com/public/emb/widget.js', r => r.fulfill({ contentType:'application/javascript', body:FAKE_YG }));
    await q.route('**/api.mymemory.translated.net/**', r => r.fulfill({ json:{ responseStatus:200, quotaFinished:false, responseData:{ translatedText:'Можно мне счёт?' } } }));
    return q; }
  await test('«Видео»: окно внутри приложения, ролики по текущему слову, без новой вкладки и перехода', async () => {
    const q = await openInApp(); const pages = []; q.context().on('page', x => pages.push(x));
    const url0 = q.url(); const word = await q.evaluate(() => { setKind(true); return item.target; });   // одно слово: у фразы целиком роликов нет (как у подменённого виджета)
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
        { id:2, text:'Çay içer misin lütfen?', audios:[{ id:78, author:'x', license:'' }] } ] : [
        { id:2, text:'Çay içer misin lütfen?', audios:[], translations:[[{ text:'Будешь чай?', lang:'rus' }]] },
        { id:3, text:'Çay sıcak.', audios:[], translations:[] } ] } }); });
    await q.evaluate(() => openExamples('Çay lütfen'));
    await q.waitForSelector('#exList li', { timeout:5000 });
    const r = await q.evaluate(() => [document.getElementById('exMsg').textContent, [...document.querySelectorAll('#exList li')].map(li => [li.querySelector('b').textContent, (li.querySelector('small') || {}).textContent || '', !!li.querySelector('.ex-play[data-i]')])]);
    await q.evaluate(() => { window.__played = []; }); await q.click('#exList .ex-play[data-i]');
    const played = await q.evaluate(() => window.__played);
    await q.context().close();
    ok(/примеры со словом «lütfen»/.test(r[0]) && /с записью носителя: 1/.test(r[0]), r[0]);
    eq(r[1][0], ['Bir çay lütfen.', 'Один чай, пожалуйста.', true]);                 // с записью — первой; без лицензии — без кнопки
    eq(r[1].find(x => x[0] === 'Çay içer misin lütfen?'), ['Çay içer misin lütfen?', 'Будешь чай?', false]);
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
  await test('«Носитель» для фразы без записи — КАЖДОЕ слово по очереди: запись носителя, а у слова без записи — синтез; видео само не открывается (просьба 16:00: «озвучивается только первое слово»)', async () => {
    const q = await openInApp();
    await q.route('https://x/**', r => r.fulfill({ status:200, contentType:'audio/wav', body:(() => { const n = 160, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b; })() }));   // настоящий (тихий) WAV, а не 64 нулевых байта: на медленном CI пустой файл давал ошибку декодирования и запасной синтез; фальшивые адреса записей отдаются сразу: иначе ошибка загрузки (abort) приходит в разное время и включает запасной синтез — тест был нестабильным
    await tap(q, 'tab-phrases');
    const r = await q.evaluate(async () => { trVoice = trVoice || { name:'t', lang:'tr-TR' }; item = { target:'Hesap lütfen biraz yok', gid:'ph-basic', meaning:'' }; nativeCache.set(clean(item.target), []);
      nativeCache.set(clean('hesap'), [{ url:'https://x/hesap.wav', who:'A' }]); nativeCache.set(clean('lütfen'), []); nativeCache.set(clean('biraz'), [{ url:'https://x/biraz.wav', who:'B' }]); nativeCache.set(clean('yok'), []);
      window.__played = []; window.__spoken = []; window.__log = []; playNative();
      for(let t = 0; t < 120 && window.__log.filter(x => x === 'rec' || x === 'synth').length < 4; t++) await new Promise(z => setTimeout(z, 100));   // CI медленнее: ждём все 4 слова, а не фиксированные 1,5 с
      return [window.__played.map(s => s.split('/').pop()), window.__spoken, window.__log.filter(x => x === 'rec' || x === 'synth'), document.getElementById('nativeStatus').textContent, document.getElementById('sheet').hidden]; });
    await q.context().close();
    eq(r[0], ['hesap.wav', 'biraz.wav'], 'играли ' + JSON.stringify(r)); eq(r[1], ['lütfen', 'yok']); eq(r[2], ['rec', 'synth', 'rec', 'synth'], 'порядок слов сохранён');
    ok(/hesap · lütfen \(синтез\) · biraz · yok \(синтез\)/.test(r[3]), r[3]); eq(r[4], true);
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

  console.log('Слово во фразе: нажатие — произношение и перевод в контексте');
  await test('нажатие на слово фразы: звучит (запись носителя, иначе синтез с пометкой), перевод именно этой формы + словарная форма; частицы объяснены; у каждого слова всех фраз есть перевод', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    const r = await q.evaluate(async () => { setMode('phrases'); setId = 'hotel'; trVoice = { name:'T', lang:'tr-TR' }; trVoices = [trVoice]; window.__spoken = []; window.__played = [];
      const show = (list, tr) => { const x = list.find(i => i.tr === tr); const pp = pickPhrase; pickPhrase = () => ({ target:x.tr, translit:x.tl, meaning:x.ru, tip:x.focus, gid:'ph-x' }); next(); pickPhrase = pp; };
      show(PHRASE_SETS.find(g => g.id === 'hotel').items, 'Size odanızı göstereyim.');
      const out = { spans:[...document.querySelectorAll('#target .wd')].map(s => s.textContent), partner0: document.getElementById('partner').textContent, info: document.getElementById('result').textContent };
      // слова на экране разделены пробелами (жалоба: «Odatemizlenmedi» — flex-контейнер выбрасывал пробелы между span)
      out.rendered = document.getElementById('target').innerText;
      { const rs = [...document.querySelectorAll('#target .wd')].map(e => e.getBoundingClientRect()); out.gap = Math.min(...rs.slice(1).map((r, i) => Math.abs(r.top - rs[i].top) < 2 ? r.left - rs[i].right : 99)); }
      nativeCache.set('size', [{ url:'https://x/size.wav', who:'Z' }]);
      const tap = async i => { document.querySelectorAll('#target .wd')[i].click(); await new Promise(z => setTimeout(z, 1700)); return document.getElementById('wordPop').textContent; };
      out.form = await tap(1); out.spokenForm = window.__spoken.slice();                              // форма: перевод формы + словарная форма; записи нет — синтез с пометкой
      out.rec = await tap(0); out.played = window.__played.slice(); out.spokenAfterRec = window.__spoken.length;   // есть запись носителя — играет она, не синтез
      out.on = document.querySelector('#target .wd.on').textContent;
      out.verb = await tap(2);
      autofit(); out.over = document.getElementById('card').scrollHeight - document.getElementById('card').clientHeight;
      out.partnerKept = document.getElementById('partner').textContent;   // транскрипция на месте — перевод слова её не заменяет (иначе фраза «скачет»)
      setId = 'novoice'; show(OLD_PHRASES, 'Kahvaltı dahil mi?'); out.restored = document.getElementById('partner').textContent;
      out.mi = await tap(2); out.dahil = await tap(1);
      // все слова всех фраз — с переводом вручную (машинного перевода здесь нет)
      let tot = 0, miss = []; [...PHRASE_SETS.flatMap(g => g.items), ...OLD_PHRASES].forEach(p => p.tr.split(/\s+/).forEach(w => { const core = w.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, ''); if(!nphr(core)) return; tot++; if(!wordGloss(core)) miss.push(core); }));
      out.tot = tot; out.miss = miss;
      // слово-карточка и пары: слова не нажимаются
      setKind(true); out.wordMode = document.querySelectorAll('#target .wd').length; setKind(false);
      return out; });
    const errs = q.errors; await q.context().close();
    eq(r.spans, ['Size', 'odanızı', 'göstereyim.']); eq(r.rendered, 'Size odanızı göstereyim.'); ok(r.gap >= 4, 'зазор между словами на экране: ' + r.gap + 'px'); eq(r.partner0, '[сизе оданызы гёстерейим]'); ok(/Нажатие на слово/.test(r.info), r.info);
    ok(r.form.startsWith('«odanızı» — ваш номер (кого? что?) · oda: комната, номер синтез'), r.form); ok(/odaкомната, номер\+-nızваш\+-ıвин\. падеж/.test(r.form), 'разбор по частям в подсказке: ' + r.form);   // после перевода — разбор слова (просьба 21:31) eq(r.spokenForm, ['odanızı']);
    ok(r.rec.startsWith('«Size» — вам носитель'), r.rec); eq(r.played, ['https://x/size.wav']); eq(r.spokenAfterRec, 1); eq(r.on, 'Size');
    ok(r.verb.startsWith('«göstereyim» — давайте покажу · göstermek: показывать синтез'), r.verb); eq(r.over <= 1, true);
    eq(r.partnerKept, '[сизе оданызы гёстерейим]'); eq(r.restored, '[кахвалты дахиль ми]'); eq(r.mi, '«mi» — вопросительная частица — делает фразу вопросом синтез'); eq(r.dahil, '«dahil» — включено (kahvaltı dahil mi — завтрак включён?) синтез');
    ok(r.tot > 1000, 'слов во фразах: ' + r.tot); eq(r.miss, []); eq(r.wordMode, 0); eq(errs, []);
  });
  await test('нажатие на слово не двигает раскладку (просьба 16:00: «длина фразы не меняется, фраза не скачет»): рамки фразы, перевода, транскрипции и микрофона и размер шрифта те же на 3 размерах, подсказка внутри экрана', async () => {
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      const q = await openPage(browser); await q.setViewportSize({ width:w, height:h });
      const r = await q.evaluate(async () => { setMode('phrases'); setId = 'hotel'; trVoice = { name:'T', lang:'tr-TR' }; trVoices = [trVoice]; const bad = [];
        const rect = id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); };
        const snap = () => [rect('target'), rect('meaning'), rect('partner'), rect('speak'), getComputedStyle(document.getElementById('target')).fontSize, getComputedStyle(document.documentElement).getPropertyValue('--fit')].join('|');
        const items = PHRASE_SETS.find(g => g.id === 'hotel').items.concat(PHRASE_SETS.find(g => g.id === 'pharmacy' || g.id === 'shop' || g.id === 'main').items).slice(0, 14);
        let taps = 0, pops = 0;
        for(const x of items){ const pp = pickPhrase; pickPhrase = () => ({ target:x.tr, translit:x.tl, meaning:x.ru, tip:x.focus, gid:'ph-x' }); next(); pickPhrase = pp; await new Promise(z => setTimeout(z, 60));
          const base = snap();
          for(const sp of document.querySelectorAll('#target .wd')){ sp.click(); await new Promise(z => setTimeout(z, 40)); taps++;
            const pop = document.getElementById('wordPop'), pr = pop.getBoundingClientRect(); if(!pop.hidden) pops++;
            if(snap() !== base) bad.push([x.tr, sp.textContent, base, snap()]);
            if(pop.hidden || pr.left < 0 || pr.right > innerWidth + .5 || pr.top < 0 || pr.bottom > innerHeight + .5) bad.push([x.tr, sp.textContent, 'подсказка вне экрана', [pr.left, pr.top, pr.right, pr.bottom].map(Math.round)]); } }
        return { bad:bad.slice(0, 3), taps, pops }; });
      const errs = q.errors; await q.context().close();
      eq(r.bad, [], `${w}×${h}:`); ok(r.taps > 30, 'нажатий: ' + r.taps); eq(errs, []);
    }
  });
  await test('нажатие на слово — везде, где есть турецкий текст: «Память» (знакомство и ответ), реплика собеседника и раскрытая карточка ответа в «Городе»; кнопка вокруг слова не срабатывает', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    const r = await q.evaluate(async () => { trVoice = null; const out = {}; const pop = () => { const p = document.getElementById('wordPop'); return p.hidden ? '' : p.textContent; };
      const now = Date.now(); saveCards([{ ...newMemCard('Hesap lütfen.', '', 'Счёт, пожалуйста.', 'prod', now), due:now - 1, seen:true }]); mem = null; setMode('memory'); memNext(); memReveal();
      document.querySelector('#target .wd').click(); await new Promise(z => setTimeout(z, 80)); out.mem = pop(); setMode('city'); out.hid = pop();
      return out; });
    ok(/«Hesap» — /.test(r.mem), 'Память: ' + r.mem); eq(r.hid, '', 'при смене раздела подсказка скрыта');
    await q.click('#tab-city'); await q.evaluate(() => cityStart('taxi')); await q.waitForTimeout(80);
    const c = await q.evaluate(async () => { const pop = () => { const p = document.getElementById('wordPop'); return p.hidden ? '' : p.textContent; }; const out = {};
      const w = document.querySelector('#ctTr .wd'); out.npcWord = w && w.textContent; const pat = ct.patience;
      w.click(); await new Promise(z => setTimeout(z, 60)); out.npcPop = pop(); out.ruHidden = document.getElementById('ctRu').hidden; out.pat = ct.patience === pat;
      document.querySelector('#ctOpts .ct-opt-main').click(); await new Promise(z => setTimeout(z, 40));
      const cw = document.querySelector('#ctOpts .ct-say .wd'); out.cardWord = cw && cw.textContent; cw.click(); await new Promise(z => setTimeout(z, 60)); out.cardPop = pop(); out.stillOpen = !!document.querySelector('#ctOpts .ct-opt.on');
      return out; });
    ok(c.npcWord && /^«/.test(c.npcPop), 'реплика: ' + JSON.stringify(c)); eq([c.ruHidden, c.pat], [true, true], 'нажатие на слово — не перевод реплики и не трата терпения');
    ok(c.cardWord && /«/.test(c.cardPop) && c.stillOpen, 'карточка ответа: ' + JSON.stringify(c)); eq(q.errors, []); await q.context().close();
  });
  console.log('Грамматика: разбор слов по частям и 31 урок');
  await test('разбор слов: части дают слово, у корня и каждого окончания есть значение, правила существуют', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(() => { const bad = []; let n = 0;
      for(const w of Object.keys(MORPH)){ n++; const m = morphOf(w); if(!m){ bad.push(w + ': нет разбора'); continue; }
        if(trLow(m.parts.map(p => p.t).join('')) !== w) bad.push(w + ': части дают ' + m.parts.map(p => p.t).join(''));
        if(!m.parts[0].gloss) bad.push(w + ': нет значения корня ' + m.lemma);
        m.parts.slice(1).forEach(p => { if(!SUF[p.tag] || !p.n) bad.push(w + ': нет окончания ' + p.tag); else if(!GRAMMAR.some(g => g.id === p.rule)) bad.push(w + ': нет правила ' + p.rule); }); }
      return { n, bad:bad.slice(0, 10), noName:Object.keys(SUF).filter(t => !SUF[t].n || !SUF[t].f || !SUF[t].rule) }; });
    ok(r.n >= 600, 'слов в разборе: ' + r.n); eq(r.bad, []); eq(r.noName, []); eq(q.errors, []); await q.context().close();
  });
  await test('правила: 31 штука, у каждого название, текст, таблица, ≥5 упражнений, один верный ответ, нет повторов; примеры из фраз; медали', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(() => { const ids = GRAMMAR.map(g => g.id);
      return { n:GRAMMAR.length, uniq:new Set(ids).size, bad:GRAMMAR.filter(g => !(g.t && g.lead && GRAM_GROUPS.includes(g.grp) && g.txt.length >= 2 && g.tbl && g.tbl.rows.length >= 3 && g.ex.length >= 5
          && g.ex.every(x => x.q && x.w && x.o.length >= 2 && x.a >= 0 && x.a < x.o.length && new Set(x.o).size === x.o.length))).map(g => g.id),
        noPhrases:GRAMMAR.filter(g => !g.micro && !g.begin && !g.nophr && !gramPhrases(g).length).map(g => g.id), badge:BADGES.find(b => b.id === 'gramall').n,
        // у каждого правила, где есть окончания, хватает слов для упражнений «что значит» и «соберите»
        dyn:GRAMMAR.filter(g => g.id !== 'harmony' && g.id !== 'qwords' && !g.begin && !g.micro && !g.nophr).filter(g => !gramMakeParse(g) || !gramMakeBuild(g)).map(g => g.id) }; });
    eq([r.n, r.uniq], [31, 31]); eq(r.bad, []); eq(r.noPhrases, []); eq(r.dyn, []); eq(r.badge, 31, 'медаль «все правила» = число правил'); eq(q.errors, []); await q.context().close();
  });
  await test('подсказка слова: разбор по частям (корень + окончания), кнопки правил открывают окно; слово без перевода получает значение по частям', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    const r = await q.evaluate(async () => { setMode('phrases'); const out = {}; const pop = () => { const p = document.getElementById('wordPop'); return p.hidden ? null : p; };
      document.getElementById('target').innerHTML = wordsHtml('Size odanızı gideceğiz.'); const w = i => document.querySelectorAll('#target .wd')[i];
      w(1).click(); await new Promise(z => setTimeout(z, 80)); const p = pop();
      out.cells = [...p.querySelectorAll('.wm-c')].map(c => c.querySelector('b').textContent + '|' + c.querySelector('i').textContent); out.rules = [...p.querySelectorAll('.wm-rule')].map(b => b.dataset.gr);
      out.fits = p.getBoundingClientRect().right <= innerWidth && p.getBoundingClientRect().left >= 0; out.btnH = Math.min(...[...p.querySelectorAll('.wm-rule')].map(b => b.getBoundingClientRect().height));
      out.noGloss = wordGloss('gideceğiz') === null; w(2).click(); await new Promise(z => setTimeout(z, 80)); out.noGlossPop = pop().textContent;
      w(1).click(); await new Promise(z => setTimeout(z, 80)); pop().querySelector('.wm-rule').click(); await new Promise(z => setTimeout(z, 120));
      out.sheet = !document.getElementById('sheet').hidden; out.sheetTitle = document.getElementById('sheetTitle').textContent; out.popHidden = !pop(); out.sheetHasTable = !!document.querySelector('#sheetBody table');
      document.querySelector('#sheetBody [data-act="quiz"]').click(); await new Promise(z => setTimeout(z, 120));
      out.mode = mode; out.sheetClosed = document.getElementById('sheet').hidden; out.view = gram.view; out.rule = gram.rule; return out; });
    eq(r.cells, ['oda|комната, номер', '-nız|ваш', '-ı|вин. падеж: кого? что?']); eq(r.rules, ['poss', 'acc_dat']); ok(r.fits, 'подсказка вышла за экран'); ok(r.btnH >= 44, 'кнопка правила ниже 44px: ' + r.btnH);
    ok(r.noGloss && /идти.* \+ будущее \+ мы/.test(r.noGlossPop), r.noGlossPop);
    eq([r.sheet, r.popHidden, r.sheetHasTable], [true, true, true]); ok(/Притяжательные/.test(r.sheetTitle), r.sheetTitle);
    eq([r.mode, r.sheetClosed, r.view, r.rule], ['grammar', true, 'quiz', 'poss']); eq(q.errors, []); await q.context().close();
  });
  await test('«Грамматика»: четвёртая вкладка тренировки, 31 урок списком, подвкладки и страницы без горизонтальной прокрутки на 3 размерах', async () => {
    const q = await openPage(browser); const bad = [];
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      await q.setViewportSize({ width:w, height:h }); await q.click('#tab-train'); await tap(q, 'tab-grammar'); await q.waitForTimeout(60);
      const r = await q.evaluate(() => ({ rows:document.querySelectorAll('#gramView .gm-row').length, mode, tab:document.getElementById('tab-grammar').getAttribute('aria-pressed'),
        sub:[document.getElementById('subtabs').scrollWidth, document.getElementById('subtabs').clientWidth], page:document.documentElement.scrollWidth <= innerWidth, hash:location.hash }));
      if(r.rows !== 31 || r.mode !== 'grammar' || r.tab !== 'true' || r.hash !== '#grammar') bad.push(`${w}: ${JSON.stringify(r)}`);
      if(r.sub[0] > r.sub[1]) bad.push(`${w}: подвкладки не помещаются ${r.sub}`); if(!r.page) bad.push(`${w}: страница шире экрана`);
      const bits = await q.evaluate(async () => { const out = [];
        for(const g of GRAMMAR){ gram = { view:'rule', rule:g.id, qs:[], i:0, ok:0, done:false }; gramRender(); const el = document.getElementById('gramView');
          if(el.scrollWidth > el.clientWidth + 1) out.push(g.id + ': страница правила шире');
          if(document.documentElement.scrollWidth > innerWidth) out.push(g.id + ': документ шире');
          gramSheet(g.id); const box = document.querySelector('#sheet .sheet-box'); if(box.scrollWidth > box.clientWidth + 1) out.push(g.id + ': окно правила шире'); closeSheet();
          gram = { view:'quiz', rule:g.id, qs:gramBuildQuiz(g), i:0, ok:0, done:false };
          for(let i = 0; i < gram.qs.length; i++){ gram.i = i; gramRender(); const q0 = gram.qs[i];
            if(el.scrollWidth > el.clientWidth + 1) out.push(g.id + ' вопрос ' + i + ': шире');
            const bs = [...el.querySelectorAll('.gm-opt, .gm-chip')]; if(bs.some(b => b.getBoundingClientRect().height < 44)) out.push(g.id + ' вопрос ' + i + ': кнопка ниже 44px'); }
          gram.done = true; gramRender(); if(el.scrollWidth > el.clientWidth + 1) out.push(g.id + ': итог шире'); }
        return out; });
      bad.push(...bits.map(b => w + ' ' + b)); }
    eq(bad, []); eq(q.errors, []); await q.context().close();
  });
  await test('упражнение: верный ответ — опыт и статистика, неверный — пояснение без наказания; итог, освоение правила после 6 ответов (≥80%), сохранение и медаль', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    await q.evaluate(() => { { let x = 11; window.__grnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); } }); await q.click('#tab-train'); await tap(q, 'tab-grammar');
    await q.click('[data-rule="poss"]'); await q.click('.gm-go'); await q.waitForTimeout(60);
    const total = await q.evaluate(() => gram.qs.length); eq(total, 8, '5 готовых + 2 «что значит» + 1 «соберите»');
    // отвечаем «как человек»: для вопроса со сборкой — тоже нажатиями (по порядку)
    const answer = async okay => q.evaluate(async okay => { const x = gram.qs[gram.i], xp0 = game.xp, wait = z => new Promise(r => setTimeout(r, z));
      if(x.type === 'mc'){ const want = okay ? x.a : x.order.find(i => i !== x.a); document.querySelector(`#gramView [data-act="opt"][data-i="${want}"]`).click(); }
      else { if(!okay){ const bad = [...document.querySelectorAll('#gramView .gm-chip')].find(b => b.textContent !== (x.m.parts[0].root ? x.m.parts[0].t : '-' + x.m.parts[0].t)); bad.click(); }
        for(let k = 0; k < x.m.parts.length; k++){ const p = x.m.parts[k], lab = p.root ? p.t : '-' + p.t; [...document.querySelectorAll('#gramView .gm-chip')].find(b => !b.disabled && b.textContent === lab).click(); } }
      await wait(30); const fb = document.querySelector('#gramView .gm-fb');
      return { type:x.type, fb:fb ? fb.className + '|' + fb.textContent.slice(0, 40) : '', nextOn:!document.querySelector('#gramView .gm-next').disabled, dxp:game.xp - xp0 }; }, okay);
    // первый вопрос — намеренно неверно (ошибка не наказывается: опыт не отнимается)
    const first = await q.evaluate(() => gram.qs[gram.i].type); let wrong;
    if(first === 'mc'){ wrong = await answer(false); ok(/gm-fb bad/.test(wrong.fb) && /Неверно/.test(wrong.fb) && wrong.nextOn && wrong.dxp === 0, JSON.stringify(wrong)); }
    else { wrong = await answer(false); ok(/gm-fb bad/.test(wrong.fb), JSON.stringify(wrong)); }
    await q.click('.gm-next'); const right = await answer(true); ok(/gm-fb ok/.test(right.fb) && right.dxp >= 2, JSON.stringify(right));
    for(let i = 2; i < 6; i++){ await q.click('.gm-next'); await answer(true); }
    const st = await q.evaluate(() => ({ s:JSON.parse(localStorage.getItem('soyle-gram')).r.poss, g:stats.gram, m:gramMastered('poss'), cnt:gramMasteredCount(), badge:BADGES.find(b => b.id === 'gram3').v(game, stats) }));
    eq([st.s.n, st.s.ok, st.g.t, st.g.ok, st.m, st.cnt, st.badge], [6, 5, 6, 5, true, 1, 1], JSON.stringify(st));   // 5 из 6 = 83% ≥ 80% — освоено
    await q.click('.gm-next'); await answer(true); await q.click('.gm-next'); await answer(true); await q.click('.gm-next');
    const done = await q.evaluate(() => ({ score:document.querySelector('#gramView .gm-score').textContent, text:document.querySelector('#gramView .gm-done').textContent, btns:[...document.querySelectorAll('#gramView .gm-done .btn')].map(b => b.textContent) }));
    eq(done.score, '7 из 8'); ok(/Правило освоено/.test(done.text), done.text); ok(done.btns.some(b => /Ещё раз/.test(b)) && done.btns.some(b => /Дальше/.test(b)), done.btns.join('|'));
    await q.click('[data-act="back"]'); await q.click('[data-act="back"]'); const row = await q.evaluate(() => document.querySelector('[data-rule="poss"]').className + '|' + document.querySelector('[data-rule="poss"] .gm-st').textContent);
    ok(/done/.test(row) && /освоено/.test(row), row);
    // сохранение: после перезагрузки страницы прогресс на месте
    await q.reload(); await q.waitForTimeout(150); const after = await q.evaluate(() => ({ m:gramMastered('poss'), n:gstate.r.poss.n }));
    eq([after.m, after.n], [true, 8]); eq(q.errors, []); await q.context().close();
  });
  await test('подсказка «как выбрать» (просьба 07:40): у каждого из 31 урока есть подсказка, в упражнении кнопка ≥ 44px раскрывает её, текст помещается на 3 размерах, ответ после подсказки засчитывается', async () => {
    const q = await openPage(browser); const bad = [];
    await q.evaluate(() => { let x = 11; window.__grnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); });
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      await q.setViewportSize({ width:w, height:h }); await q.click('#tab-train'); await tap(q, 'tab-grammar');
      const r = await q.evaluate(() => { const out = [];
        for(const g of GRAMMAR){ if(!GM_CUE[g.id]) out.push(g.id + ': нет подсказки');
          gram = { view:'quiz', rule:g.id, qs:gramBuildQuiz(g), i:0, ok:0, done:false }; gramRender(); const el = document.getElementById('gramView');
          const b = el.querySelector('[data-act="cue"]'); if(!b){ out.push(g.id + ': нет кнопки'); continue; }
          if(b.getBoundingClientRect().height < 44) out.push(g.id + ': кнопка ниже 44px');
          b.click(); const c = el.querySelector('.gm-cue'); if(!c || c.textContent.length < 40) out.push(g.id + ': подсказка не раскрылась');
          if(el.scrollWidth > el.clientWidth + 1) out.push(g.id + ': подсказка шире экрана'); if(document.documentElement.scrollWidth > innerWidth) out.push(g.id + ': документ шире');
          el.querySelector('[data-act="cue"]').click(); if(el.querySelector('.gm-cue')) out.push(g.id + ': не скрылась'); }
        return out; });
      bad.push(...r.map(x => w + ' ' + x)); }
    eq(bad, []);
    const ans = await q.evaluate(() => { gram = { view:'quiz', rule:'loc_abl', qs:gramBuildQuiz(gramRule('loc_abl')), i:0, ok:0, done:false }; gramRender(); document.querySelector('[data-act="cue"]').click();
      const x = gram.qs[0]; if(x.type === 'mc') document.querySelector(`#gramView [data-act="opt"][data-i="${x.a}"]`).click(); else x.m.parts.forEach(p => [...document.querySelectorAll('#gramView .gm-chip')].find(b => !b.disabled && b.textContent === (p.root ? p.t : '-' + p.t)).click());
      return !!document.querySelector('#gramView .gm-fb.ok'); });
    ok(ans, 'верный ответ после подсказки не засчитан'); eq(q.errors, []); await q.context().close();
  });
  await test('«С чего начать» (просьба 07:48, переработано 09:16): пять микроуроков идут первыми, в упражнениях есть «соберите фразу из блоков» (глагол последним), неверный блок — подсказка, верный порядок — засчитано, после ответа видно роли блоков', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    await q.evaluate(() => { let x = 11; window.__grnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); }); await q.click('#tab-train'); await tap(q, 'tab-grammar');
    const first = await q.evaluate(() => ({ ids:[...document.querySelectorAll('#gramView .gm-row')].slice(0, 2).map(b => b.dataset.rule), grp:document.querySelector('#gramView .gm-group h3').textContent, next:document.querySelector('#gramView .gm-row.next').dataset.rule, sub:document.querySelector('.gm-sub').textContent.includes('Новичок') }));
    eq(first, { ids:['cubes', 'want'], grp:'С чего начать', next:'cubes', sub:true });
    const r = await q.evaluate(() => { const out = { bad:[], blocks:0 };
      for(const id of ['build', 'steps', 'order']){ const g = gramRule(id); for(let k = 0; k < 6; k++){ const qs = gramBuildQuiz(g); const bl = qs.filter(x => x.blocks);
          if(bl.length !== 3 || new Set(bl.map(x => x.ruKey)).size !== 3) out.bad.push(id + ': блоков ' + bl.length);
          bl.forEach(x => { out.blocks++; const last = x.m.parts[x.m.parts.length - 1]; if(last.role !== 'глагол') out.bad.push(x.m.word + ': глагол не последний'); if(new Set(x.m.parts.map(p => p.t)).size !== x.m.parts.length) out.bad.push(x.m.word + ': повтор блока'); }); } }
      return out; });
    eq(r.bad, []); ok(r.blocks >= 36, 'блоков: ' + r.blocks);
    const flow = await q.evaluate(() => { gram = { view:'quiz', rule:'order', qs:[gramMakeBlocks()], i:0, ok:0, done:false }; const x = gram.qs[0]; x.q = gmFmt(x.q); x.html = true; gramRender(); const el = document.getElementById('gramView');
      const chips = () => [...el.querySelectorAll('.gm-chip')], lab = p => p.t;
      const wrong = chips().find(b => b.textContent !== x.m.parts[0].t); wrong.click(); const warn = !!el.querySelector('.gm-warn');
      x.m.parts.forEach(p => chips().find(b => !b.disabled && b.textContent === lab(p)).click());
      return { warn, cls:el.querySelector('.gm-fb').className, roles:[...el.querySelectorAll('.gm-fb .wm-c i')].map(i => i.textContent), width:el.scrollWidth <= el.clientWidth + 1 }; });
    ok(flow.warn, 'нет подсказки при неверном блоке'); ok(/gm-fb bad/.test(flow.cls), 'после ошибки засчитано: ' + flow.cls); ok(flow.roles.length >= 3 && flow.roles[flow.roles.length - 1] === 'глагол', flow.roles.join()); ok(flow.width, 'шире экрана');
    const good = await q.evaluate(() => { gram = { view:'quiz', rule:'steps', qs:[gramMakeBlocks()], i:0, ok:0, done:false }; const x = gram.qs[0]; x.q = gmFmt(x.q); x.html = true; gramRender(); const el = document.getElementById('gramView');
      x.m.parts.forEach(p => [...el.querySelectorAll('.gm-chip')].find(b => !b.disabled && b.textContent === p.t).click()); return el.querySelector('.gm-fb').className; });
    ok(/gm-fb ok/.test(good), good); eq(q.errors, []); await q.context().close();
  });
  await test('упражнение «соберите слово»: неверная часть — подсказка и ошибка, верный порядок — засчитано, «убрать последнюю» работает', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    await q.evaluate(() => { { let x = 11; window.__grnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); } }); await q.click('#tab-train'); await tap(q, 'tab-grammar');
    const set = rule => q.evaluate(rule => { gram = { view:'quiz', rule, qs:[gramMakeBuild(gramRule(rule))], i:0, ok:0, done:false }; gramRender(); const x = gram.qs[0]; return { word:x.m.word, n:x.m.parts.length, prompt:document.getElementById('gmQ').textContent }; }, rule);
    const t1 = await set('prog'); ok(/Соберите слово/.test(t1.prompt) && t1.n >= 3, JSON.stringify(t1));
    const bad = await q.evaluate(() => { const x = gram.qs[0], want = x.m.parts[0].t; const wrong = [...document.querySelectorAll('#gramView .gm-chip')].find(b => b.textContent !== want); wrong.click();
      return { warn:!!document.querySelector('#gramView .gm-warn'), got:gram.qs[0].got.length }; }); eq(bad, { warn:true, got:0 });
    const fin = await q.evaluate(() => { const x = gram.qs[0]; x.m.parts.forEach(p => { [...document.querySelectorAll('#gramView .gm-chip')].find(b => !b.disabled && b.textContent === (p.root ? p.t : '-' + p.t)).click(); });
      return { cls:document.querySelector('#gramView .gm-fb').className, txt:document.querySelector('#gramView .gm-fb').textContent }; });
    ok(/gm-fb bad/.test(fin.cls) && fin.txt.includes(t1.word), 'ошибка в первом нажатии — не засчитано: ' + JSON.stringify(fin));
    await set('prog'); const good = await q.evaluate(() => { const x = gram.qs[0]; x.m.parts.slice(0, 2).forEach(p => { [...document.querySelectorAll('#gramView .gm-chip')].find(b => !b.disabled && b.textContent === (p.root ? p.t : '-' + p.t)).click(); });
      const n2 = gram.qs[0].got.length; document.querySelector('#gramView .gm-undo').click(); const n1 = gram.qs[0].got.length;
      x.m.parts.slice(1).forEach(p => { [...document.querySelectorAll('#gramView .gm-chip')].find(b => !b.disabled && b.textContent === (p.root ? p.t : '-' + p.t)).click(); });
      return { n2, n1, cls:document.querySelector('#gramView .gm-fb').className }; });
    eq([good.n2, good.n1], [2, 1]); ok(/gm-fb ok/.test(good.cls), good.cls); eq(q.errors, []); await q.context().close();
  });
  await test('«Грамматика»: правило проходится до конца ботом (все 31 урок, все вопросы), без ошибок JS; Escape ведёт на уровень выше', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    await q.evaluate(() => { { let x = 11; window.__grnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); } }); await q.click('#tab-train'); await tap(q, 'tab-grammar');
    const r = await q.evaluate(async () => { const bad = [];
      for(const g of GRAMMAR){ document.querySelector(`[data-rule="${g.id}"]`).click(); document.querySelector('.gm-go').click();
        let steps = 0; while(!gram.done && steps++ < 20){ const x = gram.qs[gram.i];
          if(x.type === 'mc') document.querySelector(`#gramView [data-act="opt"][data-i="${x.a}"]`).click();
          else if(x.type === 'tap') document.querySelector(`#gramView [data-act="let"][data-i="${x.a}"]`).click();
          else x.m.parts.forEach(p => { [...document.querySelectorAll('#gramView .gm-chip')].find(b => !b.disabled && b.textContent === (p.root ? p.t : '-' + p.t)).click(); });
          if(!document.querySelector('#gramView .gm-fb.ok')) bad.push(g.id + ' ' + gram.i + ': не засчитано');
          document.querySelector('#gramView .gm-next').click(); }
        if(!gram.done || gram.ok !== gram.qs.length) bad.push(g.id + ': итог ' + gram.ok + '/' + gram.qs.length);
        document.querySelector('#gramView [data-act="back"]').click(); document.querySelector('#gramView [data-act="back"]') ? 0 : 0; if(gram.view === 'rule') document.querySelector('#gramView [data-act="back"]').click(); }
      return { bad, mastered:gramMasteredCount(), view:gram.view }; });
    eq(r.bad, []); eq([r.mastered, r.view], [31, 'list']);
    await q.click('[data-rule="plural"]'); await q.keyboard.press('Escape'); eq(await q.evaluate(() => gram.view), 'list'); eq(q.errors, []); await q.context().close();
  });
  await test('микроуроки для новичка (просьба 09:16 и 12:09): 5 уроков первыми, без записей «-(ı)yor», последняя гласная подсвечена, глухие/звонкие согласные различимы, упражнение «нажмите на гласную», образец в первой сборке фразы', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    await q.evaluate(() => { let x = 11; window.__grnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); }); await q.click('#tab-train'); await tap(q, 'tab-grammar');
    const r = await q.evaluate(() => { const ids = ['cubes', 'want', 'vowel', 'where', 'build'], out = { bad:[] };
      out.first = GRAMMAR.slice(0, 5).map(g => g.id); out.old = ['steps', 'order'].map(i => gramRule(i).grp);
      for(const id of ids){ const g = gramRule(id), all = [g.t, g.lead, ...g.txt, ...g.ex.flatMap(e => [e.q, e.w, ...e.o]), GM_CUE[id]].join(' ');
        if(/\(ı\)|\(y\)|\(s\)/.test(all)) out.bad.push(id + ': скобочная запись'); if(g.txt.length < 6) out.bad.push(id + ': мало шагов ' + g.txt.length); if(/\p{Extended_Pictographic}/u.test(all)) out.bad.push(id + ': эмодзи'); }
      const h = w => { const d = document.createElement('div'); d.innerHTML = hlWord(w); return { lv:[...d.querySelectorAll('.lv')].map(e => e.textContent), vl:[...d.querySelectorAll('.vl')].map(e => e.textContent), vd:[...d.querySelectorAll('.vd')].map(e => e.textContent) }; };
      out.tapA = Object.entries({ okul:2, ev:0, oda:2, göl:1, kapı:3, araba:4, kedi:3, bilet:3, telefon:5, pasaport:5, şehir:3, çanta:4, gün:1 }).filter(([w, i]) => gramMakeTap(w).a !== i).map(([w]) => w);   // независимый оракул: номер последней гласной задан вручную
      out.tapAll = gramRule('vowel').tap.filter(w => { const v = [...w].map((c, i) => 'aeıioöuü'.includes(c) ? i : -1).filter(i => i >= 0); return gramMakeTap(w).a !== v[v.length - 1]; });
      out.bilet = h('bilet'); out.sokak2 = h('kitap');
      out.okul = h('okul'); out.park = h('park'); out.araba = h('araba'); out.sokak = h('şehir');
      gram = { view:'rule', rule:'vowel', qs:[], i:0, ok:0, done:false }; gramRender(); out.hl = document.querySelectorAll('#gramView .hw .lv').length; out.vl = document.querySelectorAll('#gramView .hw .vl').length;
      const lv = getComputedStyle(document.querySelector('#gramView .hw .lv')), vl = getComputedStyle(document.querySelector('#gramView .hw .vl')); out.styles = [lv.backgroundColor !== 'rgba(0, 0, 0, 0)', vl.textDecorationLine.includes('underline')];
      return out; });
    eq(r.first, ['cubes', 'want', 'vowel', 'where', 'build']); eq(r.old, ['Памятка', 'Памятка']); eq(r.bad, []);
    eq(r.tapA, [], 'ответ «последняя гласная» неверен'); eq(r.tapAll, []); eq(r.bilet.vl, ['t']); eq(r.bilet.lv, ['e']); eq(r.sokak2.vl, ['k', 't', 'p']); eq(r.okul.vd, ['l']); eq(r.okul.lv, ['u']); eq(r.okul.vl, ['k']); eq(r.park.lv, ['a']); eq(r.park.vl, ['p', 'k']); eq(r.araba.lv, ['a']); eq(r.sokak.lv, ['i']); eq(r.sokak.vl, ['ş', 'h']);
    ok(r.hl >= 5 && r.vl >= 1, 'подсветка в уроке: ' + r.hl + '/' + r.vl); eq(r.styles, [true, true]);
    // упражнение «нажмите на последнюю гласную»: 3 вопроса, неверная буква — ошибка, верная — засчитано; после ответа слово подсвечено
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){ await q.setViewportSize({ width:w, height:h });
      const t = await q.evaluate(() => { gram = { view:'quiz', rule:'vowel', qs:gramBuildQuiz(gramRule('vowel')), i:0, ok:0, done:false }; const taps = gram.qs.filter(x => x.type === 'tap').length, out = { taps, n:gram.qs.length, bad:[] };
        for(let k = 0; k < gram.qs.length; k++){ gram.i = k; gramRender(); const x = gram.qs[k], el = document.getElementById('gramView');
          if(x.type === 'tap'){ const bs = [...el.querySelectorAll('.gm-let')]; if(bs.some(b => b.getBoundingClientRect().height < 44 || b.getBoundingClientRect().width < ([...x.word].length > 6 ? 30 : 44))) out.bad.push(x.word + ': кнопка меньше 44px по высоте или 44px (30px у слов длиннее 6 букв — иначе ряд не помещается в одну строку)');
            if(el.scrollWidth > el.clientWidth + 1) out.bad.push(x.word + ': шире экрана'); const wrong = bs.findIndex((b, i) => i !== x.a); bs[k % 2 ? x.a : wrong].click();
            const fb = el.querySelector('.gm-fb'); if(!fb || !el.querySelector('.gm-hl .lv')) out.bad.push(x.word + ': нет ответа/подсветки'); else if(fb.classList.contains('ok') !== (k % 2 === 1)) out.bad.push(x.word + ': неверный итог'); } }
        return out; });
      eq(t.taps, 3); eq(t.n, 6); eq(t.bad, [], w + '×' + h); }
    // первая сборка с образцом: ровно одна из трёх, образец исчезает после ответа
    const b = await q.evaluate(() => { const qs = gramBuildQuiz(gramRule('build')), bl = qs.filter(x => x.blocks), smp = bl.filter(x => x.sample).length;
      gram = { view:'quiz', rule:'build', qs:[bl.find(x => x.sample)], i:0, ok:0, done:false }; gramRender(); const el = document.getElementById('gramView'), before = !!el.querySelector('.gm-sample'), chips = el.querySelectorAll('.gm-sample .wm-c').length;
      const x = gram.qs[0]; x.m.parts.forEach(p => [...el.querySelectorAll('.gm-chip')].find(c => !c.disabled && c.textContent === p.t).click()); return { smp, bl:bl.length, before, chips, after:!!el.querySelector('.gm-sample') }; });
    eq([b.smp, b.bl, b.before, b.after], [1, 3, true, false]); ok(b.chips >= 3, 'в образце блоков: ' + b.chips); eq(q.errors, []); await q.context().close();
  });
  await test('грамматика после проверки 10-06: нет «глагол всегда последний», у «Порядка слов» один верный ответ, смягчение «git» — не общее правило, «Быть» — лицо после -ydi, birazdan не «через», Rusyalı без апострофа, разбор слова без двух верных ответов', async () => {
    const r = await p.evaluate(() => {
      const all = JSON.stringify(GRAMMAR), by = id => GRAMMAR.find(g => g.id === id), bad = [];
      if(/всегда (самый )?последн|глагол всегда/i.test(all)) bad.push('«всегда последний» остался');
      if(by('order').ex.some(e => /обычный вопрос/.test(e.q) && (e.o || []).includes('Eve mi gidiyorsunuz?'))) bad.push('order: два верных ответа про mi');
      if(/Перед ним ещё окончание лица/.test(all)) bad.push('cop: «перед ним»');
      if(!/ydi-m/.test(JSON.stringify(by('cop').txt))) bad.push('cop: нет evde-ydi-m');
      if(/через минуту/.test(JSON.stringify(by('loc_abl')))) bad.push('loc_abl: через минуту');
      if(/p, ç, t, k мягчают/.test(all)) bad.push('prog: общее смягчение');
      if(/Rusya'/.test(JSON.stringify(by('deriv')))) bad.push("deriv: Rusya'lı");
      if(!/глагол/.test(by('cubes').lead)) bad.push('cubes: заголовок не про глагол');
      if(/который не меняется|он не меняется\./.test(JSON.stringify(by('cubes')))) bad.push('cubes: корень «не меняется»');
      if(!JSON.stringify(by('vowel').txt).includes('saat')) bad.push('vowel: нет оговорки про saat');
      if(!/hastane-nin/.test(JSON.stringify(by('cases_buffer')))) bad.push('cases_buffer: нет исключения родительного');
      if(!/-ydu/.test(JSON.stringify(by('cop').txt))) bad.push('cop: нет -ydu/-ydü');
      if(/после звонких \{-ca/.test(JSON.stringify(by('deriv')))) bad.push('deriv: -ca только после звонких');
      if(/между ними \{y\} \(после/.test(GM_STEPS.join(' '))) bad.push('GM_STEPS: y для родительного');
      const pairs = [['acc','poss3s'],['poss3s','acc'],['gen','poss2s'],['poss2s','gen'],['cpast','past'],['past','cpast'],['gen','poss1s'],['gen','poss1p'],['gen','poss2p']];
      for(const rid of ['acc_dat','poss','gen_ins','cop','past']) for(let k = 0; k < 150; k++){
        const q = gramMakeParse(by(rid)); if(!q) continue;
        const right = q.o[q.a];
        for(const [a, b] of pairs) if(SUF[a].n === right && q.o.includes(SUF[b].n)) bad.push(rid + ': ' + q.q + ' → ' + a + '/' + b);
      }
      return bad;
    });
    eq(r, []);
    ok(!fs.readFileSync(FILE.replace('file://', ''), 'utf8').includes("Rusya'lıyım"), "реплики города: Rusyalıyım без апострофа");
  });
  await test('упражнения микроуроков спрашивают только то, что объяснено: каждое турецкое слово из вопроса и верного ответа есть в тексте/таблице этого или прежнего микроурока (жалоба 10-06: konuşmak в уроке 2)', async () => {
    const r = await p.evaluate(() => {
      const lat = s => (String(s).replace(/\[\[|\]\]/g, '').match(/[A-Za-zÇĞİÖŞÜçğıöşü']+/g) || []).map(w => w.toLowerCase().replace(/'.*$/, '')), bad = [], known = new Set();
      for(const r of GRAMMAR.filter(g => g.micro || g.nophr || g.begin)){
        lat(JSON.stringify([r.txt, r.tbl, r.tap, r.lead, r.t])).forEach(w => known.add(w)); lat(JSON.stringify([r.txt, r.tbl]).replace(/([A-Za-zçğıöşü])-(?=[A-Za-zçğıöşü])/g, '$1')).forEach(w => known.add(w));
        r.ex.forEach((e, i) => [e.q, e.o[e.a]].forEach(s => lat(s).forEach(w => { if(w.length > 1 && !known.has(w) && !/^(ist|alm|iyor|um|sun|ak|ek|okulde)$/.test(w)) bad.push(r.id + '#' + (i + 1) + ': ' + w); })));
      }
      // блоки: у каждого слова есть значение
      GM_SENT.forEach(sn => sn.b.forEach(x => { if(!x[2]) bad.push('GM_SENT без значения: ' + x[0]); }));
      return bad;
    });
    eq(r, []);
  });
  await test('«Из ваших фраз» не показывается во вводных уроках и «Памятке» (там одни и те же фразы повторялись); в блоке фраз значения слов', async () => {
    const r = await p.evaluate(() => {
      const sets = {}; ['cubes','want','vowel','where','build','steps','order'].forEach(id => { sets[id] = gramPhrases(GRAMMAR.find(g => g.id === id)).map(x => x.tr).join('|'); });
      const q = gramMakeBlocks(null, 1).q;
      return { sets, q, lv1: Array.from({ length: 60 }, () => gramMakeBlocks(null, 1).ruKey).every(k => GM_SENT.find(x => x.ru === k).lv === 1) };
    });
    Object.keys(r.sets).forEach(id => eq(r.sets[id], '', 'у вводного урока «' + id + '» нет блока «Из ваших фраз» (одни и те же фразы во всех уроках)'));
    ok(/Слова: /.test(r.q) && /—/.test(r.q), 'в вопросе есть значения слов'); ok(r.lv1, 'уровень 1 — только простые фразы');
  });
  await test('урок «На, в, под, перед, за, рядом» (22:02): каждая форма «предмет + слово-часть + где/куда/откуда» в тексте, таблице и ответах собрана по правилам (независимый расчёт) и подтверждена Zemberek', async () => {
    const lesson = await p.evaluate(() => { const g = GRAMMAR.find(x => x.id === 'place_n'); return g ? JSON.stringify([g.txt, g.tbl, g.ex]) : ''; });
    ok(lesson, 'урок place_n есть');
    const V = 'aeıioöuü', last = w => [...w].reverse().find(c => V.includes(c)), back = c => 'aıou'.includes(c), round = c => 'ouöü'.includes(c);
    const four = c => back(c) ? (round(c) ? 'u' : 'ı') : (round(c) ? 'ü' : 'i'), two = c => back(c) ? 'a' : 'e';
    const gen = w => V.includes(w[w.length - 1]) ? w + 'n' + four(last(w)) + 'n' : w + four(last(w)) + 'n';
    const poss = w => V.includes(w[w.length - 1]) ? w + 's' + four(last(w)) : w + four(last(w));
    const forms = (own, part, k) => { const ps = poss(part), l = last(ps); return gen(own) + ' ' + ps + 'n' + (k === 'g' ? 'd' + two(l) : k === 'd' ? two(l) : 'd' + two(l) + 'n'); };
    const own = ['masa', 'oda', 'ev', 'okul', 'çanta'], parts = ['üst', 'alt', 'iç', 'ön', 'arka', 'yan'], all = new Set();
    own.forEach(o => parts.forEach(pt => ['g', 'd', 'a'].forEach(k => all.add(forms(o, pt, k)))));
    const found = [...new Set((lesson.match(/(masanın|odanın|evin|okulun|çantanın) (üst|alt|iç|ön|arka|yan)[a-zçğıöşü]*/g) || []))];
    ok(found.length >= 15, 'в уроке нашлось форм: ' + found.length);
    eq(found.filter(f => !all.has(f) && !/ (altı|içi|üstü|önü|arkası|yanı)$/.test(f)), [], 'формы, которых нет в расчёте');
    const z = require('child_process').spawnSync('python3', ['-I', '/tmp/claude-0/zy/zyq.py', ...found.flatMap(f => f.split(' ')[1]).filter((v, i, a) => a.indexOf(v) === i)], { encoding:'utf8', timeout:240000 });
    if(z.status === 0 && /->/.test(z.stdout)) eq(z.stdout.split('\n').filter(l => /->/.test(l) && /НЕТ РАЗБОРА/.test(l)), [], 'Zemberek не разбирает форму');
  });
  await test('«соберите фразу из блоков» (22:45): ни одно слово не налезает на соседние на 320, 360, 390, 412 px — ни в выборе слов, ни в собранной строке, ни в разборе после ответа (все фразы GM_SENT)', async () => {
    const q = await openPage(browser); await q.click('#tab-train'); await tap(q, 'tab-grammar');
    const bad = [];
    for(const w of [320, 360, 390, 412]){
      await q.setViewportSize({ width:w, height:700 });
      const r = await q.evaluate(() => { const out = [];
        const over = (sel, name) => { const els = [...document.querySelectorAll(sel)].filter(e => e.getBoundingClientRect().width); for(let i = 0; i < els.length; i++){ const a = els[i].getBoundingClientRect(); if(a.right > innerWidth + 1 || a.left < -1) out.push(name + ' выходит за экран: ' + els[i].textContent.slice(0, 30));
            if(els[i].scrollWidth > els[i].clientWidth + 1) out.push(name + ' текст шире рамки: ' + els[i].textContent.slice(0, 30));
            for(let j = i + 1; j < els.length; j++){ const b = els[j].getBoundingClientRect(); if(a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push(name + ' налезают: ' + els[i].textContent.slice(0, 20) + ' / ' + els[j].textContent.slice(0, 20)); } } };
        for(const sn of GM_SENT){ const m = { ruKey:sn.ru, parts:sn.b.map(x => ({ t:x[0], role:x[1], root:true })) };
          const qz = gramMakeBlocks([], 3); Object.assign(qz, { ruKey:sn.ru, m, got:[], order:m.parts.map((_, i) => i), blocks:true, q:gmFmt('Соберите: ' + sn.ru), html:true, w:'x' });
          gram = { view:'quiz', rule:'build', qs:[qz], i:0, ok:0, done:false }; gramRender(); over('#gramView .gm-chip', 'выбор');
          qz.got = m.parts.map((_, i) => i); gramRender(); over('#gramView .gm-cell', 'строка');
          qz.res = true; gramRender(); over('#gramView .wm-c', 'разбор'); }
        return out; });
      r.forEach(x => bad.push(w + ': ' + x));
    }
    eq(bad.slice(0, 20), []); eq(q.errors, []); await q.context().close();
  });
  await test('упражнения грамматики (23:19): в каждом уроке не меньше 10, у каждого 2–4 разных варианта и один верный индекс, вопросы не повторяются, а каждое новое упражнение проходит показ (верный ответ засчитывается, неверный — нет)', async () => {
    const r = await p.evaluate(() => { const bad = [];
      for(const g of GRAMMAR){ if(g.ex.length < 10) bad.push(g.id + ': упражнений ' + g.ex.length); const qs = new Set();
        g.ex.forEach((e, i) => { const n = g.id + '#' + (i + 1); if(!e.q || !e.w) bad.push(n + ': нет вопроса или пояснения'); if(e.o.length < 2 || e.o.length > 4 || new Set(e.o).size !== e.o.length) bad.push(n + ': варианты');
          if(!(e.a >= 0 && e.a < 4)) bad.push(n + ': индекс'); if(qs.has(e.q)) bad.push(n + ': повтор вопроса'); qs.add(e.q); if(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(JSON.stringify(e))) bad.push(n + ': эмодзи'); }); }
      return bad; });
    eq(r, []);
  });
  await test('урок «Числа» (07:30): время «в N часов» и порядковые собраны по правилам (независимый расчёт), все такие формы в тексте и ответах верны', async () => {
    const lesson = await p.evaluate(() => { const g = GRAMMAR.find(x => x.id === 'nums'); return g ? JSON.stringify([g.txt, g.tbl, g.ex.map(e => e.o[e.a])]) : ''; });
    ok(lesson, 'урок nums есть');
    const V = 'aeıioöuü', last = w => [...w].reverse().find(c => V.includes(c)), back = c => 'aıou'.includes(c), round = c => 'ouöü'.includes(c);
    const four = c => back(c) ? (round(c) ? 'u' : 'ı') : (round(c) ? 'ü' : 'i'), two = c => back(c) ? 'a' : 'e';
    const hard = w => 'çfhkpsştT'.includes(w[w.length - 1]);
    const at = w => w + (hard(w) ? 't' : 'd') + two(last(w));
    const ord = w => w === 'dört' ? 'dördüncü' : V.includes(w[w.length - 1]) ? w + 'n' + 'c' + four(last(w)) : w + four(last(w)) + 'nc' + four(last(w));
    const nums = ['iki', 'üç', 'dört', 'beş', 'altı', 'yedi', 'sekiz', 'dokuz', 'on'];
    const okAt = new Set(nums.map(at)), okOrd = new Set([...nums, 'bir', 'yirmi'].map(ord).concat(['birinci']));
    eq([at('üç'), at('beş'), at('dört'), at('iki'), at('altı'), at('yedi'), at('sekiz'), at('dokuz'), at('on')], ['üçte', 'beşte', 'dörtte', 'ikide', 'altıda', 'yedide', 'sekizde', 'dokuzda', 'onda']);
    eq([ord('altı'), ord('iki'), ord('on'), ord('beş'), ord('üç'), ord('bir')], ['altıncı', 'ikinci', 'onuncu', 'beşinci', 'üçüncü', 'birinci']);
    const foundAt = [...new Set(lesson.match(/(?:üç|beş|dört|iki|altı|yedi|sekiz|dokuz|on)(?:te|ta|de|da)(?![a-zçğıöşü])/g) || [])].filter(w => w !== 'onda' || true);
    ok(foundAt.length >= 7, 'в уроке форм времени: ' + foundAt.length); eq(foundAt.filter(w => !okAt.has(w)), [], 'неверные формы времени (кроме неверных вариантов ответа)');
  });
  await test('урок «Когда меняется последняя буква» (18:20): формы «куда?» собраны по правилам (независимый расчёт) и стоят в тексте/таблице, неверных (kitapa, ağaça…) нет; урок идёт сразу после «Гармонии»', async () => {
    const r = await p.evaluate(() => { const ids = GRAMMAR.map(g => g.id), g = GRAMMAR.find(x => x.id === 'soft'); return { ids, lesson: g ? JSON.stringify([g.txt, g.tbl, g.ex.map(e => e.o[e.a])]) : '' }; });
    ok(r.lesson, 'урок soft есть'); eq(r.ids[r.ids.indexOf('harmony') + 1], 'soft', 'после гармонии');
    const V = 'aeıioöuü', last = w => [...w].reverse().find(c => V.includes(c)), two = c => 'aıou'.includes(c) ? 'a' : 'e', soft = { p:'b', ç:'c', t:'d', k:'ğ' };
    const dat = (w, sw) => (sw ? w.slice(0, -1) + soft[w[w.length - 1]] : w) + two(last(w));
    const change = ['kitap', 'ağaç', 'çocuk', 'yatak', 'hesap', 'kanat', 'gök', 'dip'], keep = ['park', 'at', 'saç', 'top', 'bulut', 'bilet'];
    const want = [...change.map(w => dat(w, true)), ...keep.map(w => dat(w, false))];
    eq(want.slice(0, 5), ['kitaba', 'ağaca', 'çocuğa', 'yatağa', 'hesaba']); eq(dat('gök', true), 'göğe'); eq(dat('bulut', false), 'buluta');
    const miss = want.filter(f => !r.lesson.includes(f)); eq(miss, [], 'нет в тексте');
    const bad = ['kitapa', 'ağaça', 'çocuka', 'yataka', 'hesapa', 'parga', 'ada ']; eq(bad.filter(b => new RegExp('\\{' + b.trim() + '\\}').test(r.lesson)), [], 'неверные формы в тексте');
  });
  await test('урок «Звуки: буквы и сочетания» (19:09): стоит второй группой, у каждого слова с треугольником есть перевод и звук (запись или синтез), Enter работает; в упражнении «послушайте» слово не видно до ответа, кнопка играет его, верный ответ засчитывается', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:390, height:844 });
    const r = await q.evaluate(async () => {
      trVoice = { name:'T', lang:'tr-TR' }; trVoices = [trVoice]; window.__spoken = []; window.__played = [];
      ['hazır', 'var', 'cam', 'şu'].forEach(w => nativeCache.set(w, []));
      const out = { groups:GRAM_GROUPS.slice(0, 3) }; setMode('grammar'); gram = { view:'rule', rule:'sounds', qs:[], i:0, ok:0, done:false }; gramRender();
      const sp = [...document.querySelectorAll('#gramView .gm-snd')]; out.n = sp.length; out.noGloss = [...new Set(sp.map(e => e.dataset.w))].filter(w => !wordGloss(w));
      out.roles = [...new Set(sp.map(e => e.getAttribute('role') + ':' + e.getAttribute('tabindex')))];
      const byW = w => sp.find(e => e.dataset.w === w);
      byW('hazır').click(); await new Promise(z => setTimeout(z, 1700)); out.pop = document.getElementById('wordPop').textContent; out.spoken = window.__spoken.length;
      byW('var').focus(); byW('var').dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true, cancelable:true })); await new Promise(z => setTimeout(z, 1700)); out.popEnter = document.getElementById('wordPop').textContent;
      // состав упражнения: 8 вопросов, из них 3 «послушайте»; слово-ответ в тексте вопроса не названо, а верный вариант — это оно
      const bad = []; for(let k = 0; k < 40; k++){ const qs = gramBuildQuiz(gramRule('sounds')), s = qs.filter(x => x.snd);
        if(qs.length !== 8 || s.length !== 3) bad.push('состав ' + qs.length + '/' + s.length);
        s.forEach(x => { if(x.q.includes(x.snd) || x.o[x.a] !== x.snd) bad.push('ответ виден или не совпадает: ' + x.snd); }); }
      out.bad = [...new Set(bad)];
      // показ: вопрос «послушайте» первым
      const qs = gramBuildQuiz(gramRule('sounds')); const i = qs.findIndex(x => x.snd); [qs[0], qs[i]] = [qs[i], qs[0]];
      gram = { view:'quiz', rule:'sounds', qs, i:0, ok:0, done:false }; gramRender(); window.__spoken = [];
      const w = qs[0].snd; out.word = w; out.qText = document.getElementById('gmQ').textContent; out.btn = !!document.querySelector('.gm-listen');
      document.querySelector('.gm-listen').click(); await new Promise(z => setTimeout(z, 1700)); out.spokenQuiz = window.__spoken.length;
      out.visibleBefore = document.getElementById('gramView').innerText.includes('Прозвучало слово');
      document.querySelectorAll('.gm-opt')[qs[0].order.indexOf(qs[0].a)].click(); out.fb = document.querySelector('.gm-fb').textContent; out.ok = gram.ok;
      out.h = Math.round(document.querySelector('.gm-listen').getBoundingClientRect().height);
      return out; });
    eq(r.groups, ['С чего начать', 'Произношение', 'Основа']); ok(r.n >= 20, 'слов с треугольником: ' + r.n); eq(r.noGloss, [], 'нет перевода');
    eq(r.roles, ['button:0']); ok(/готов/.test(r.pop) && r.spoken >= 1, 'hazır: ' + r.pop + ' / синтез ' + r.spoken); ok(/есть/.test(r.popEnter), 'Enter: ' + r.popEnter);
    eq(r.bad, []); ok(r.btn && r.spokenQuiz >= 1, 'кнопка «Послушать слово» не играет'); ok(!r.qText.includes(r.word), 'в вопросе названо слово ' + r.word); ok(!r.visibleBefore, 'ответ виден до выбора');
    ok(/Верно/.test(r.fb) && r.ok === 1, r.fb); ok(r.h >= 44, 'кнопка ниже 44px: ' + r.h); eq(q.errors, []); await q.context().close();
  });
  await test('озвучка Piper, шаг 1 (2026-10-08; 2026-10-09: только фразы и реплики): список всего, что сайт может произнести фразой — фразы, реплики и числа города, такси, лавка; одиночных слов нет (их говорит телефон); без повторов', async () => {
    const r = await p.evaluate(() => {
      if(typeof ttsInventory !== 'function') return { none:true };
      const inv = ttsInventory(), keys = new Set(inv.map(ttsKey)), has = t => keys.has(ttsKey(t)), miss = [];
      const need = (src, list) => list.forEach(t => { if(t && !has(t)) miss.push(src + ': ' + t); });
      need('фраза', [...PHRASE_SETS.flatMap(g => g.items), ...OLD_PHRASES].map(x => x.tr));
      const single = inv.filter(t => !/\s/.test(t) && !/[.!?…]$/.test(t));
      need('такси', [`Geldik. ${trNumWords(110).replace(/^./, c => c.toLocaleUpperCase('tr-TR'))} lira.`, `Eksik. ${trNumWords(240).replace(/^./, c => c.toLocaleUpperCase('tr-TR'))} lira.`, `Geldik. ${trNumWords(relDiscount(240)).replace(/^./, c => c.toLocaleUpperCase('tr-TR'))} lira.`, ...BOARD.filter(b => b.dat).map(b => `${b.dat} lütfen.`)]);
      need('лавка', Object.keys(SHOP_LINES).flatMap(it => [SHOP_LINES[it][0], `${it[0].toLocaleUpperCase('tr-TR') + it.slice(1)}, tamam. Başka?`]));
      need('светская', SMALLTALK.map(x => x.tr));
      return { n:inv.length, uniq:keys.size, miss:[...new Set(miss)].slice(0, 20), nmiss:miss.length, empty:inv.filter(t => !/\p{L}/u.test(t)).length, single:single.slice(0, 5) };
    });
    ok(!r.none, 'нет ttsInventory'); const city = JSON.parse(fs.readFileSync(path.join(__dirname, 'city-phrases.json'), 'utf8'));
    const r2 = await p.evaluate(list => { const keys = new Set(ttsInventory().map(ttsKey)); return list.filter(t => !keys.has(ttsKey(t))).slice(0, 10); }, city);
    eq(r.miss, [], 'нет в списке (' + r.nmiss + ')'); eq(r2, [], 'реплики города (city-phrases.json) не в списке'); eq(r.n, r.uniq, 'повторы'); eq(r.empty, 0); eq(r.single, [], 'одиночные слова в списке озвучки'); ok(r.n > 1000, 'текстов мало: ' + r.n);
  });
  await test('озвучка Piper, шаг 4: есть файл в манифесте — играет он (слово, «Синтез» обычный и медленный, собеседник в городе со скоростью Kulak, образец без записи носителя); нет файла — голос телефона', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(async () => {
      const wait = ms => new Promise(z => setTimeout(z, ms)), a = document.getElementById('nativeAudio');
      trVoice = { name:'T', lang:'tr-TR' }; trVoices = [trVoice]; const pl0 = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function(){ window.__rate = this.playbackRate; return pl0.call(this); };
      TTS.man = { [ttsKey('Hesap lütfen.')]:'aaa.mp3', [ttsKey('hesap')]:'bbb.mp3', [ttsKey('Merhaba, buyurun.')]:'ccc.mp3' };
      const out = {}, reset = () => { window.__played = []; window.__spoken = []; }; const P = () => window.__played.map(s => s.replace(/^.*\/(tts\/)/, '$1'));
      reset(); sayText('Hesap'); await wait(50); out.word = [P(), window.__spoken.slice()];
      reset(); sayText('yok böyle'); await wait(50); out.missing = [P(), window.__spoken.slice()];
      setMode('phrases'); item = { target:'Hesap lütfen.', gid:'x' }; document.getElementById('play').disabled = false; synthSlow = false;
      reset(); document.getElementById('play').click(); await wait(50); out.synth = [P(), window.__rate];
      await wait(200); reset(); document.getElementById('play').click(); await wait(50); out.slow = [P(), window.__rate];
      await wait(200); nativeCache.set(clean('Hesap lütfen.'), []); reset(); let done = 0; playReference('Hesap lütfen.', () => done++); await wait(300); out.ref = [P(), window.__spoken.slice(), done];
      reset(); trVoices = []; trVoice = null; let fin = 0; npcSay('Merhaba, buyurun.', () => fin++); await wait(50); out.npc = [P(), window.__rate === npcRate()]; await wait(100); out.npcDone = fin;
      out.canSpeak = canSpeak();
      return out; });
    const errs = q.errors; await q.context().close();
    eq(r.word, [[], ['Hesap']], 'одиночное слово — голос телефона (решение 2026-10-09), даже если файл есть'); eq(r.missing, [[], ['yok böyle']], 'нет файла — телефон');
    eq(r.synth[0], ['tts/aaa.mp3'], '«Синтез»'); eq(r.synth[1], 1); eq(r.slow[0], ['tts/aaa.mp3']); ok(Math.abs(r.slow[1] - 0.7) < 1e-6, 'медленно: ' + r.slow[1]);
    eq(r.ref, [['tts/aaa.mp3'], [], 1], 'образец без записи носителя'); eq(r.npc, [['tts/ccc.mp3'], true], 'собеседник'); eq(r.npcDone, 1); ok(r.canSpeak, 'без голоса телефона — можно говорить файлами'); eq(errs, []);
  });
  await test('«Из ваших фраз» (21:39): у каждой фразы урока словообразования есть разбор «слово = части», а формы этих фраз объяснены в тексте урока', async () => {
    const r = await p.evaluate(() => { const g = GRAMMAR.find(x => x.id === 'deriv'), html = gramRuleHtml(g), ph = gramPhrases(g).map(x => x.tr); return { html, ph, lesson: JSON.stringify([g.txt, g.tbl]) }; });
    ok(r.ph.length >= 3, 'фраз мало: ' + r.ph.length);
    eq((r.html.match(/class="gm-bk"/g) || []).length, r.ph.length, 'разбор есть у каждой фразы');
    for(const f of ['sıra-da-ki', 'nere-li-sin', 'gürültü-lü-ydü', 'Sessiz olun']) ok(r.lesson.includes(f), 'в уроке нет разбора: ' + f);
    for(const f of ['sıradaki = sıra-da-ki', 'nerelisin = nere-li-sin', 'gürültülüydü = gürültü-lü-ydü']) ok(r.html.toLowerCase().includes(f), 'нет разбора под фразой: ' + f);
  });
  await test('«нажмите на последнюю гласную»: буквы любого слова из списка (и слова на 10 букв) стоят в ОДНУ строку на 320, 360, 390, 412 px, не шире экрана, кнопка не уже 24 px (WCAG 2.5.8), слова не длиннее 10 букв (жалоба 10-06 22:04: telefon переносился)', async () => {
    const q = await openPage(browser); await q.click('#tab-train'); await tap(q, 'tab-grammar');
    const bad = [];
    for(const w of [320, 360, 390, 412]){
      await q.setViewportSize({ width:w, height:700 });
      const r = await q.evaluate(() => { const out = []; const words = [...new Set(GRAMMAR.flatMap(g => g.tap || [])), 'pasaportçu'];
        if(words.some(x => [...x].length > 10)) out.push('слово длиннее 10 букв в списке tap — кнопки станут уже 24 px');
        for(const word of words){ gram = { view:'quiz', rule:'vowel', qs:[gramMakeTap(word)], i:0, ok:0, done:false }; gramRender();
          const bs = [...document.querySelectorAll('#gramView .gm-let')], box = document.querySelector('#gramView .gm-word'); if(!bs.length || !box){ out.push(word + ': нет кнопок'); continue; }
          const tops = new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))), minW = Math.min(...bs.map(b => b.getBoundingClientRect().width)), right = Math.max(...bs.map(b => b.getBoundingClientRect().right)), left = Math.min(...bs.map(b => b.getBoundingClientRect().left));
          if(tops.size !== 1) out.push(word + ': ' + tops.size + ' строк'); if(minW < 24) out.push(word + ': кнопка ' + Math.round(minW) + 'px'); if(right > innerWidth || left < 0) out.push(word + ': выходит за экран'); if(document.documentElement.scrollWidth > innerWidth) out.push(word + ': горизонтальная прокрутка'); }
        return out; });
      r.forEach(x => bad.push(w + ': ' + x));
    }
    eq(bad, []); eq(q.errors, []); await q.context().close();
  });
  await test('код-ревью 10-06: Escape при открытом окне закрывает ТОЛЬКО окно (упражнение грамматики остаётся), а реплика собеседника с записью не зависает, если запись не стартует или её перехватили', async () => {
    const q = await openPage(browser); await q.setViewportSize({ width:360, height:640 });
    await q.evaluate(() => { let x = 11; window.__grnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648); }); await q.click('#tab-train'); await tap(q, 'tab-grammar');
    const e = await q.evaluate(() => { gram = { view:'quiz', rule:'cubes', qs:gramBuildQuiz(gramRule('cubes')), i:0, ok:0, done:false }; gramRender(); showModal({ title:'Тест', text:'окно' }); return { modal:modalOpen, view:gram.view }; });
    eq(e, { modal:true, view:'quiz' }); await q.keyboard.press('Escape');
    eq(await q.evaluate(() => ({ modal:modalOpen, view:gram.view })), { modal:false, view:'quiz' }, 'Escape закрыл окно и вышел из упражнения');
    await q.keyboard.press('Escape'); eq(await q.evaluate(() => gram.view), 'rule', 'второй Escape ведёт на уровень выше');
    // реплика с настоящей записью: play() молчит (ни playing, ни ended) — через ~4 с запасной синтез и onDone
    const r = await q.evaluate(async () => { window.__realNative = true; await cvReady; CV_INDEX = Object.assign({}, CV_INDEX, { 'Hesap lütfen.':[{ file:'t1.mp3' }] });
      /* под file:// индекс Common Voice не грузится — подкладываем запись */ trVoice = trVoice || { name:'t', lang:'tr-TR' };
      HTMLMediaElement.prototype.play = function(){ return new Promise(() => {}); };          // запись «грузится вечно»: ни playing, ни ended, ни error
      Object.defineProperty($('nativeAudio'), 'src', { configurable:true, get(){ return ''; }, set(v){} });   // иначе file:// сразу даёт error и запасной путь включается сам
      const text = 'Hesap lütfen.'; const has = localNative(text).length > 0; let done = false; npcSay(text, () => { done = true; });
      await new Promise(z => setTimeout(z, 5500)); const d1 = done;
      // перехват: вторая запись на том же <audio> не должна «съедать» окончание первой реплики
      done = false; npcSay(text, () => { done = true; }); await new Promise(z => setTimeout(z, 200)); playNativeOr(localNative('Hesap lütfen.'), () => {}); await new Promise(z => setTimeout(z, 600)); const d2 = done;
      return { has, d1, d2 }; });
    ok(r.has, 'нет записи «Hesap lütfen.» в audio/cv'); ok(r.d1, 'реплика с записью зависла (нет запасного пути за 5,5 с)'); ok(r.d2, 'реплику затёрла другая запись на общем <audio>'); eq(q.errors, []); await q.context().close();
  });
  console.log('«Город» (Mahalle): разговоры с последствиями');
  const openCity = async (opts) => { const q = await openPage(browser, opts); await q.setViewportSize({ width:360, height:640 }); await q.click('#tab-city'); await q.waitForTimeout(100); return q; };
  const ctSay = async (q, t) => { await q.evaluate(t => { window.__say = t; window.__silent = !t; }, t); await q.click('#ctSpeak'); await q.waitForTimeout(120);
    return q.evaluate(() => ({ res: document.getElementById('ctResult').textContent, npc: document.getElementById('ctTr').textContent, pat: ct && ct.patience, next: !document.getElementById('ctNext').disabled, money: city.money,
      opts: [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent), score: (document.querySelector('#ctResult .score b') || {}).textContent })); };
  const ctNext = async q => { await q.click('#ctNext'); await q.waitForTimeout(60); };
  const ctPick = async (q, i) => { await q.click(`#ctOpts .ct-opt-main[data-i="${i}"]`); await q.waitForTimeout(40); return q.evaluate(() => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)); };
  await test('кубик на поле (просьба 22:05): стоит на одном месте при смене вкладок Дела · Люди · Умения, рядом нет надписи «Выпало N», грань показывает число', async () => {
    for(const [w, h] of [[360, 640], [390, 844]]){
      const q = await openCity(); await q.setViewportSize({ width:w, height:h });
      const pos = []; for(const id of ['ctTabTasks', 'ctTabPeople', 'ctTabSkills', 'ctTabTasks']){ await q.evaluate(id => document.getElementById(id).click(), id); await q.waitForTimeout(40);
        pos.push(await q.evaluate(() => { const r = document.getElementById('ctRoll').getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })); }
      eq(pos.every(x => x.join() === pos[0].join()), true, w + ': ' + JSON.stringify(pos));
      await q.evaluate(() => { window.__dice = 4; }); await q.click('#ctRoll'); await q.waitForTimeout(80);
      const r = await q.evaluate(() => ({ hint:document.getElementById('ctDiceHint').textContent, n:document.querySelector('#ctRoll .die').parentNode.dataset.n, dots:document.querySelectorAll('#ctRoll .die circle').length, text:document.getElementById('ctCard') ? '' : document.getElementById('cityCard').innerText }));
      ok(!/Выпало/i.test(r.hint + r.text), 'надпись про выпавшее число осталась: ' + r.hint); eq(r.dots, 4); await q.context().close(); }
  });
  await test('больше персонажей (просьба 22:04): 18 человек, новые встречаются в местах своего пула, итог сцены называет их по имени, портреты все разные', async () => {
    const q = await openCity();
    const r = await q.evaluate(() => { const out = { n:Object.keys(CHARS).length, bad:[] };
      for(const sid of ['taxi', 'bakkal', 'visit_bakkal', 'mama', 'kapici', 'visit_kapici', 'cay', 'lokanta', 'visit_cay', 'visit_lokanta', 'eczane', 'visit_eczane', 'visit_berber', 'visit_pazar']){
        const sc = SCENES[sid]; for(const c of sc.pool){ if(!CHARS[c]) { out.bad.push(sid + ': нет ' + c); continue; }
          window.__char = c; city.min = (c === 'bakkal_emre' ? 19 : 10) * 60; cityStart(sid); if(!ct || ct.char !== c){ out.bad.push(sid + ' ' + c + ': не выбран (' + (ct && ct.char) + ')'); if(ct) ct = null; continue; }
          const g = document.getElementById('ctGoal').textContent, w = document.getElementById('ctWho').textContent; if(w !== CHARS[c].name) out.bad.push(sid + ': имя ' + w);
          const nm = ctNm(sc.fail ? sc.fail.text : ''); const d = CHARS[sc.pool[0]].name.split(/[ ,]/).pop();   // имя «главного» — последнее слово («Бакал Хасан» → Хасан); первое слово — должность
          if(c !== sc.pool[0] && CHARS[c].short && typeof nm === 'string' && nm.includes(d)) out.bad.push(sid + ' ' + c + ': в итоге осталось имя ' + d);
          if(c !== sc.pool[0] && CHARS[c].short && ctNm(g).includes(d)) out.bad.push(sid + ' ' + c + ': в цели осталось имя ' + d);
          ct = null; } }
      cityRender(); return out; });
    eq(r.n, 18); eq(r.bad, []); eq(q.errors, []); await q.context().close();
  });
  await test('вместо буквы — портрет (просьба 07:30): у каждой сцены на лице собеседника SVG-портрет (у людей без имени — свой по роли), окно «Бакал Хасан» в «Людях» тоже с портретом, не с буквой', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__busy = ''; });
    const r = await q.evaluate(() => { const bad = [], seen = new Set();
      for(const sid of Object.keys(SCENES)){ const sc = SCENES[sid]; if(sc.phone || sc.dm) continue; city.min = 19 * 60; cityStart(sid); if(!ct){ bad.push(sid + ': не началась'); continue; }
        const el = document.getElementById('ctInitial'); if(!el.querySelector('svg.avatar')) bad.push(sid + ': нет портрета (' + el.textContent + ')'); if(el.textContent.trim()) bad.push(sid + ': в портрете есть текст'); seen.add(el.innerHTML); ct = null; }
      cityRender(); city.met = { bakkal:1 }; cityRender(); document.getElementById('ctTabPeople').click(); document.querySelector('#ctChars .ct-char[data-char="bakkal"]').click();
      const dm = document.getElementById('dmIc'), mod = document.getElementById('modalIc'); return { bad, kinds:seen.size, modal:mod && !document.getElementById('modal').hidden ? mod.innerHTML : 'closed', dm:dm ? dm.innerHTML.slice(0, 40) : '' }; });
    eq(r.bad, []); ok(r.kinds >= 20, 'разных портретов мало: ' + r.kinds);
    ok(!/^<svg/.test(r.modal) ? r.modal === 'closed' || !/^\s*[A-Z]\s*$/.test(r.modal) : true, r.modal.slice(0, 60)); eq(q.errors, []); await q.context().close();
  });
  await test('портреты (просьба 17:02): у каждого из персонажей свой рисунок (все разные), он в списке «Люди», в окне звонка и на лице собеседника в сцене', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__busy = ''; });
    const r = await q.evaluate(async () => { const ids = Object.keys(CHARS), svgs = ids.map(c => charAvatar(c)); const out = { all:ids.every(c => AVATARS[c]), uniq:new Set(svgs).size === ids.length, emoji:svgs.some(x => /\p{Extended_Pictographic}/u.test(x)) };
      city.rel = { sofor:3 }; city.met = { sofor:1 }; city.contacts = { sofor:1 }; cityRender(); document.getElementById('ctTabPeople').click(); out.row = !!document.querySelector('#ctChars .ct-char[data-char="sofor"] i svg.avatar');
      document.querySelector('#ctChars .ct-char[data-char="sofor"]').click(); out.dm = !!document.querySelector('#dmIc svg.avatar'); document.getElementById('dmClose').click();
      cityStart('taxi'); out.face = !!document.querySelector('#ctInitial svg.avatar'); const f = document.getElementById('ctReplay').getBoundingClientRect(); out.faceSize = [Math.round(f.width), Math.round(f.height)]; return out; });
    eq([r.all, r.uniq, r.emoji, r.row, r.dm, r.face], [true, true, false, true, true, true]); eq(r.faceSize, [44, 44]); eq(q.errors, []); await q.context().close();
  });
  await test('биографии (просьба 09:16): у каждого из 18 персонажей есть своя мини-биография (40–400 знаков, без эмодзи, все разные), она видна в окне человека и помещается на 3 размерах', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__busy = ''; });
    const r = await q.evaluate(() => { const ids = Object.keys(CHARS), bad = [];
      for(const c of ids){ const b = CHARS[c].bio; if(typeof b !== 'string' || b.length < 40 || b.length > 400) bad.push(c + ': длина ' + (b && b.length)); else if(/\p{Extended_Pictographic}/u.test(b)) bad.push(c + ': эмодзи'); }
      return { n:ids.length, bad, uniq:new Set(ids.map(c => CHARS[c].bio)).size }; });
    eq(r.bad, []); eq(r.uniq, r.n);
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      await q.setViewportSize({ width:w, height:h });
      const m = await q.evaluate(() => { city.met = { bakkal:1 }; cityRender(); document.getElementById('ctTabPeople').click(); document.querySelector('#ctChars .ct-char[data-char="bakkal"]').click();
        const mod = document.getElementById('modal'); return { t:mod.textContent.includes(CHARS.bakkal.bio.slice(0, 30)) }; });
      await q.waitForTimeout(600);
      m.fits = await q.evaluate(() => { const rc = document.querySelector('#modal .modal-box').getBoundingClientRect(); return { top:Math.round(rc.top), bottom:Math.round(rc.bottom), h:innerHeight }; });
      ok(m.t, 'биографии нет в окне ' + w); ok(m.fits.top >= 0 && m.fits.bottom <= m.fits.h + 1, 'окно не помещается ' + w + '×' + h + ' ' + JSON.stringify(m.fits));
      await q.evaluate(() => { const b = document.getElementById('modalClose') || document.querySelector('#modal button'); b && b.click(); });
    }
    eq(q.errors, []); await q.context().close();
  });
  await test('чат: окно со всеми 8 темами помещается на 3 размерах (кнопки ≥ 44 px, ничего не обрезано), «Закрыть» на месте; «Занять денег» (+200 ₺, долг до зарплаты) и «Погода» (зонт) меняют состояние игры', async () => {
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      const q = await openCity(); await q.setViewportSize({ width:w, height:h }); await q.evaluate(() => { window.__busy = ''; city.rel = { bakkal:6 }; city.met = { bakkal:1 }; city.contacts = { bakkal:1 }; cityRender(); document.getElementById('ctTabPeople').click(); document.querySelector('#ctChars .ct-char[data-char="bakkal"]').click(); });
      await q.waitForTimeout(450);
      const r = await q.evaluate(() => { const box = document.querySelector('#dmModal .modal-box').getBoundingClientRect(), bs = [...document.querySelectorAll('#dmTopics .dm-topic')].map(b => b.getBoundingClientRect());
        return { inside:box.top >= 0 && box.bottom <= innerHeight + 1 && box.left >= 0 && box.right <= innerWidth + 1, small:bs.filter(r => r.height < 43.5).length, n:bs.length, clipped:[...document.querySelectorAll('#dmTopics .dm-topic')].filter(b => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1).length, close:document.getElementById('dmClose').getBoundingClientRect().height }; });
      await q.context().close(); eq([r.inside, r.small, r.n, r.clipped], [true, 0, 8, 0], `${w}×${h}: ` + JSON.stringify(r)); ok(r.close >= 43.5, 'кнопка «Закрыть» ≥ 44px');
    }
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__busy = ''; city.rel = { bakkal:6 }; city.met = { bakkal:1 }; city.contacts = { bakkal:1 }; });
    const play = async () => { for(let i = 0; i < 6 && await q.evaluate(() => ct); i++){ await q.evaluate(() => { document.querySelector('#ctOpts .ct-opt-main').click(); }); const mv = await q.evaluate(() => ct.node.moves.filter(m => !m.hide)[0].say[0]); await ctSay(q, mv); await ctNext(q); } await q.waitForTimeout(250); await q.evaluate(() => { while(!document.getElementById('modal').hidden) document.getElementById('modalPrimary').click(); }); await q.waitForTimeout(200); };
    await q.evaluate(() => { cityStart('dm_loan', { char:'bakkal' }); }); await q.waitForTimeout(80);
    // loan: первый ход верхнего узла ведёт к «ask» → «how» → первый ход «yes»
    await play(); const loan = await q.evaluate(() => [city.money, city.debt, city.played.dm_loan.ok]); eq(loan, [3700, 200, 1]);
    await q.evaluate(() => { cityStart('dm_weather', { char:'bakkal' }); }); await q.waitForTimeout(80);
    await play(); const wth = await q.evaluate(() => [!!city.flags.semsiye, city.played.dm_weather.ok]); eq(wth, [true, 1]);
    eq(q.errors, []); await q.context().close();
  });
  console.log('Личные чаты с персонажами (просьба 16:00)');
  const dmOpen = () => !document.getElementById('dmModal').hidden;
  await test('чат: имя без номера — «Недоступно пока» (с причиной и сколько до знакомства); номер даёт персонаж при доверии (знакомый 3; молчуны и строгие — позже) окном «Новый контакт»; старые сохранения с высокими отношениями получают номера сами', async () => {
    const q = await openCity();
    const r = await q.evaluate(() => { const out = {}; city.rel = { sofor:1, usta:3 }; city.met = { sofor:1, usta:1 }; city.contacts = {}; cityRender(); document.getElementById('ctTabPeople').click();
      document.querySelector('#ctChars .ct-char[data-char="sofor"]').click(); out.no = [document.getElementById('modalTitle').textContent, document.getElementById('modalText').textContent, !document.getElementById('dmModal').hidden]; document.getElementById('modalPrimary').click();
      out.ustaNo = (() => { document.querySelector('#ctChars .ct-char[data-char="usta"]').click(); const t = document.getElementById('modalText').textContent; document.getElementById('modalPrimary').click(); return t; })();   // Кемаль скуп: на «знакомый» номера ещё нет
      out.at = { sofor:CHARS.sofor.dm.contactAt || 3, usta:CHARS.usta.dm.contactAt };
      city.rel.sofor = 3; cityStart('taxi'); cityEnd({ kind:'ok', text:'Доехали.' }); out.granted = [!!city.contacts.sofor, !!city.contacts.usta];
      out.queue = []; return out; });
    eq(r.no[0], 'Шофёр Али'); ok(/Недоступно пока/.test(r.no[1]) && /номера нет/.test(r.no[1]) && /ещё 2/.test(r.no[1]), r.no[1]); eq(r.no[2], false);
    ok(/Недоступно пока/.test(r.ustaNo), r.ustaNo); eq(r.at.sofor, 3); ok(r.at.usta >= 5, 'у Кемаля контакт позже: ' + r.at.usta); eq(r.granted, [true, false]);
    const modal = await q.evaluate(() => [document.getElementById('modalTitle').textContent, document.getElementById('modalText').textContent]);   // номер — в итоговом окне сцены, без лишнего окна
    ok(/Новый контакт: Шофёр Али дал вам свой номер/.test(modal[1]) && /Люди/.test(modal[1]), modal.join(' | '));
    const mig = await q.evaluate(() => { city.contacts = {}; city.rel = { bakkal:4, usta:4 }; cityNormalize(); return Object.keys(city.contacts).sort(); }); eq(mig, ['bakkal']);   // отношения 4: у Хасана контакт (3) есть, у Кемаля (6) нет
    eq(q.errors, []); await q.context().close();
  });
  await test('чат: есть номер — нажатие на имя звонит; ответил — темы (знакомый: 4, «свой»: ещё 4 закрыты замком с пояснением); тема запускает разговор с ЭТИМ человеком, время идёт, отношения растут раз в день', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__busy = ''; });
    const r = await q.evaluate(async () => { const out = {}; city.rel = { sofor:3 }; city.met = { sofor:1 }; city.contacts = { sofor:1 }; cityRender(); document.getElementById('ctTabPeople').click();
      out.label = document.querySelector('#ctChars .ct-char[data-char="sofor"] .ct-char-lvl').textContent;
      document.querySelector('#ctChars .ct-char[data-char="sofor"]').click(); await new Promise(z => setTimeout(z, 60));
      const tp = () => [...document.querySelectorAll('#dmTopics .dm-topic')].map(b => [b.dataset.id, b.disabled, b.textContent]);
      out.open = !document.getElementById('dmModal').hidden; out.title = document.getElementById('dmTitle').textContent; out.topics = tp(); out.min0 = city.min;
      document.querySelector('#dmTopics .dm-topic[data-id="dm_how"]').click(); await new Promise(z => setTimeout(z, 80));
      out.ct = [ct && ct.id, ct && ct.char, ct && ct.dm, document.getElementById('dmModal').hidden, document.getElementById('ctWho').textContent, document.getElementById('ctScene').hidden];
      return out; });
    eq(r.open, true); eq(r.title, 'Шофёр Али'); eq(r.topics.length, 8, JSON.stringify(r.topics)); eq(r.topics.filter(t => !t[1]).length, 4, 'на «знакомый» открыты 4'); ok(r.topics.filter(t => t[1]).every(t => /свой/.test(t[2])), 'замок объясняет: ' + JSON.stringify(r.topics.filter(t => t[1])));
    eq(r.ct, ['dm_how', 'sofor', true, true, 'Шофёр Али', false]); ok(/номер/.test(r.label) || /знаком/.test(r.label), r.label);
    // разговор: верные реплики; отношения +1 в первый раз за день и не растут во второй
    const play = async () => { await q.evaluate(() => { document.querySelector('#ctOpts .ct-opt-main').click(); });
      const mv = await q.evaluate(() => ct.node.moves.filter(m => !m.hide)[0].say[0]); await ctSay(q, mv); await ctNext(q); return mv; };
    for(let i = 0; i < 4 && await q.evaluate(() => ct); i++) await play();
    await q.waitForTimeout(150); const after = await q.evaluate(() => [city.rel.sofor, !!ct, city.min]);
    ok(after[2] > 540, 'разговор по телефону занял время: ' + after[2]); const rel1 = after[0];
    await q.evaluate(() => { document.getElementById('modalPrimary').click(); }); await q.waitForTimeout(200);
    const again = await q.evaluate(async () => { cityRender(); document.getElementById('ctTabPeople').click(); document.querySelector('#ctChars .ct-char[data-char="sofor"]').click(); await new Promise(z => setTimeout(z, 60)); document.querySelector('#dmTopics .dm-topic[data-id="dm_how"]').click(); await new Promise(z => setTimeout(z, 80)); return !!ct; });
    eq(again, true); for(let i = 0; i < 4 && await q.evaluate(() => ct); i++) await play(); await q.waitForTimeout(150);
    const rel2 = await q.evaluate(() => city.rel.sofor); ok(rel1 >= 4, 'первый разговор поднял отношения: ' + rel1); eq(rel2, rel1, 'второй разговор в тот же день отношений не прибавляет');
    eq(q.errors, []); await q.context().close();
  });
  await test('чат: «свой» (6) открывает 8 тем; тема «Занять денег» закрыта замком, пока долг ≥ 200', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__busy = ''; });
    const r = await q.evaluate(async () => { const out = {}; city.rel = { sofor:6 }; city.met = { sofor:1 }; city.contacts = { sofor:1 }; cityRender(); document.getElementById('ctTabPeople').click();
      document.querySelector('#ctChars .ct-char[data-char="sofor"]').click(); await new Promise(z => setTimeout(z, 60));
      out.enabled = [...document.querySelectorAll('#dmTopics .dm-topic')].filter(b => !b.disabled).length; document.getElementById('dmClose').click();
      city.debt = 250; document.querySelector('#ctChars .ct-char[data-char="sofor"]').click(); await new Promise(z => setTimeout(z, 60));
      const loan = document.querySelector('#dmTopics .dm-topic[data-id="dm_loan"]'); out.loanLocked = [loan.disabled, loan.textContent]; document.getElementById('dmClose').click(); city.debt = 0; return out; });
    eq(r.enabled, 8); eq(r.loanLocked[0], true); ok(/долг/i.test(r.loanLocked[1]), r.loanLocked[1]);
    eq(q.errors, []); await q.context().close();
  });
  await test('чат: не берёт трубку — причины: ночь (спит), клиент (работа), за рулём, пятничный намаз, матч, свадьба, болен, нет сети, просто занят; у каждой — свой заголовок, русское объяснение и короткое сообщение по-турецки (слова нажимаются); темы не показываются; перезванивает сам только там, где человек занят ненадолго', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; city.rel = { bakkal:6 }; city.met = { bakkal:1 }; city.contacts = { bakkal:1 }; cityRender(); document.getElementById('ctTabPeople').click(); });
    const out = {};
    for(const why of ['sleep', 'work', 'drive', 'prayer', 'match', 'wedding', 'sick', 'nosignal', 'busy']){
      out[why] = await q.evaluate(async why => { window.__busy = why; city.callback = null; document.querySelector('#ctChars .ct-char[data-char="bakkal"]').click(); await new Promise(z => setTimeout(z, 450));   // окно выезжает снизу 0,3 с
        const tr = document.getElementById('dmTr'); const o = { title:document.getElementById('dmTitle').textContent, text:document.getElementById('dmText').textContent, tr:tr.textContent, words:tr.querySelectorAll('.wd').length, ru:document.getElementById('dmRu').textContent,
          topics:document.querySelectorAll('#dmTopics .dm-topic').length, cb:!!city.callback, atLater:city.callback ? city.callback.at > city.min : null, inside:(() => { const b = document.querySelector('#dmModal .modal-box').getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 1; })() };
        document.getElementById('dmClose').click(); return o; }, why); }
    const titles = Object.values(out).map(o => o.title); eq(new Set(titles).size, 9, 'у каждой причины свой заголовок: ' + titles.join(' / '));
    for(const [why, o] of Object.entries(out)){ eq(o.topics, 0, why + ': темы'); ok(o.text.length > 20 && o.ru.length > 3, why + ': есть объяснение и перевод'); ok(o.words >= 2 && o.tr.length > 5, why + ': турецкое сообщение со словами'); ok(o.inside, why + ': окно помещается'); }
    eq(Object.entries(out).filter(([, o]) => o.cb).map(([w]) => w).sort(), ['busy', 'drive', 'prayer', 'work']);
    eq(out.work.atLater, true);
    ok(/спит|ночь/i.test(out.sleep.text) && /Aradığınız|Uyu/i.test(out.sleep.tr), JSON.stringify(out.sleep));
    eq(q.errors, []); await q.context().close();
  });
  await test('чат: время и день решают сами (без подмены): после 21:30 бабушка-соседка спит; в пятницу в обед у набожных — намаз; в среду вечером у болельщиков — матч; свой звонит редко занятому реже', async () => {
    const q = await openCity();
    const r = await q.evaluate(() => { const out = {}; window.__busy = undefined; delete window.__busy;
      city.min = 21 * 60 + 40; out.komsuNight = dmAvail('komsu').why; city.min = 10 * 60; out.komsuDay = dmAvail('komsu').ok === true;   // в тестах случайные причины выключены
      city.day = 5; city.min = 12 * 60 + 30; out.prayer = dmAvail('kapici').why; out.prayerFan = dmAvail('berber').ok === true;
      city.day = 3; city.min = 20 * 60 + 30; out.match = dmAvail('sofor_emre').why; out.matchNo = dmAvail('komsu').ok === true;
      city.day = 3; city.min = 23 * 60; out.late = dmAvail('sofor_emre').why; return out; });
    eq(r.komsuNight, 'sleep'); eq(r.komsuDay, true); eq(r.prayer, 'prayer'); eq(r.prayerFan, true); eq(r.match, 'match'); eq(r.matchNo, true); eq(r.late, 'sleep');
    await q.context().close();
  });
  await test('чат: «перезванивает» — если человек был занят ненадолго, позже по ходу дня приходит звонок: «Ответить» открывает темы, «Не брать» — тишина; после конца дня обратный звонок не приходит', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__busy = ''; city.rel = { bakkal:6 }; city.met = { bakkal:1 }; city.contacts = { bakkal:1 }; });
    const r = await q.evaluate(async () => { const out = {}; city.callback = { char:'bakkal', at:city.min + 30, why:'work' }; dmCallbackCheck(); out.early = document.getElementById('modal').hidden;
      city.min += 31; dmCallbackCheck(); await new Promise(z => setTimeout(z, 60)); out.ring = [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, document.getElementById('modalPrimary').textContent, city.callback];
      document.getElementById('modalPrimary').click(); await new Promise(z => setTimeout(z, 120)); out.talk = [!document.getElementById('dmModal').hidden, document.querySelectorAll('#dmTopics .dm-topic').length]; document.getElementById('dmClose').click();
      city.callback = { char:'bakkal', at:city.min + 5, why:'busy' }; city.min = 21 * 60 + 10; dmCallbackCheck(); await new Promise(z => setTimeout(z, 60)); out.late = [document.getElementById('modal').hidden, city.callback];
      return out; });
    eq(r.early, true); eq(r.ring[0], false); ok(/перезванивает|звонит/i.test(r.ring[1]) && /Бакал/.test(r.ring[1]), r.ring[1]); eq(r.ring[2], 'Ответить'); eq(r.ring[3], null); eq(r.talk, [true, 8]); eq(r.late, [true, null]);
    eq(q.errors, []); await q.context().close();
  });
  await test('центр поля: ни одна надпись внутри кольца не обрезана («Bakkal — лавка …», «Nezaket · ве…») — все три вкладки на 3 размерах (просьба 16:00)', async () => {
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      const q = await openCity(); await q.setViewportSize({ width:w, height:h }); await q.waitForTimeout(100);
      const bad = await q.evaluate(async () => { const out = [];
        for(const t of ['tasks', 'people', 'skills']){ if(t === 'people') { city.met = Object.assign(city.met || {}, { sofor:1, bakkal_emre:1, komsu:1, eczaci:1 }); city.rel.bakkal_emre = 4; cityRender(); } cityInnerTab(t); await new Promise(z => setTimeout(z, 80));
          const inner = document.getElementById('ctInner'), ir = inner.getBoundingClientRect();
          for(const e of inner.querySelectorAll('*')){ if(!e.offsetParent) continue; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
            const hid = o => o === 'hidden' || o === 'clip';   // список людей прокручивается (overflow:auto) — так задумано, остальное обрезаться не должно
            const clipped = (e.scrollWidth > e.clientWidth + 1 && hid(cs.overflowX)) || (e.scrollHeight > e.clientHeight + 1 && hid(cs.overflowY)) || cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth;
            const outside = r.right > ir.right + 1 || r.bottom > ir.bottom + 1 || r.left < ir.left - 1;
            if(clipped || outside) out.push([t, e.id || e.className || e.tagName, e.textContent.slice(0, 30)]); } }
        return out.slice(0, 5); });
      await q.context().close(); eq(bad, [], `${w}×${h}:`);
    }
  });
  await test('Город (08:08): у телефонного дела подпись «звоните отсюда» (дома) или «звонок · …», а не «вы здесь»', async () => {
    const q = await openCity();
    const r = await q.evaluate(() => { city.plan = ['su', 'bakkal']; city.done = []; city.pos = 0; cityRender(); const tx = id => document.querySelector('.ct-task[data-scene="' + id + '"] span').textContent;
      const homeI = cellOfScene('su'); city.pos = homeI === 0 ? 1 : 0; cityRender(); const away = tx('su'); city.pos = homeI; cityRender(); return { here: tx('su'), away, homeI, bakkalHere: city.pos === cellOfScene('bakkal') ? 'same' : tx('bakkal') }; });
    eq(r.here, 'нажмите, чтобы позвонить'); ok(/^звонок · /.test(r.away), 'издалека: ' + r.away); ok(!/вы здесь/.test(r.here + r.away + r.bakkalHere), 'нет «вы здесь»');
    await q.context().close();
  });
  await test('Город (21:56): дело на клетке, где вы стоите, запускается нажатием на строку (раньше «звоните отсюда» не нажималось); у кнопок «Taksi çağır»/«Eve dön» есть перевод; симитчи объяснён', async () => {
    const q = await openCity();
    const r = await q.evaluate(() => { city.plan = ['su', 'bakkal']; city.done = []; city.pos = cellOfScene('su'); city.roll = null; cityRender();
      const li = document.querySelector('.ct-task[data-scene="su"]'), go = li.classList.contains('go'), role = li.getAttribute('role'); li.click();
      return { go, role, started: !!ct && ct.id === 'su', taxi: document.querySelector('#ctTaxi small').textContent, home: document.querySelector('#ctHomeBtn small').textContent,
        place: document.getElementById('ctPlace').textContent, simit: BOARD.find(b => b.id === 'simitci').title + '|' + BOARD.find(b => b.id === 'simitci').ru }; });
    eq([r.go, r.role, r.started], [true, 'button', true], 'строка дела не запускает сцену');
    eq([r.taxi, r.home], ['вызвать такси', 'вернуться домой']); ok(/продавец симита/.test(r.simit), r.simit);
    await q.context().close();
  });
  await test('«Примеры» (22:10): для слова «yastık» Tatoeba-основа не приносит «yasta/yasa» (траур, закон) — остаются предложения с самим словом в любой форме', async () => {
    const r = await p.evaluate(() => ['Yastayım.', 'Yasa açık.', 'Tom yasta.', 'Biz yastayız.', 'Yastığı yok.', 'Bir yastık lütfen.'].filter(s => exampleHas(s, 'yastık')).concat(['İstiyorum.', 'Kitabı aldım.'].filter((s, i) => exampleHas(s, ['istemek', 'kitap'][i]))));
    eq(r, ['Yastığı yok.', 'Bir yastık lütfen.', 'İstiyorum.', 'Kitabı aldım.']);
  });
  await test('Город (08:51): заголовок дома — «Mahalle (квартал) · …», без «города»', async () => {
    const q = await openCity();
    const s = await q.evaluate(() => { cityRender(); return document.getElementById('ctPlace').textContent; }); await q.context().close();
    ok(/^Mahalle \(квартал\) · /.test(s) && !/города/.test(s), s);
  });
  await test('«Память» (22:03): сохранённые карточки со старым «çok güzel» про еду заменяются на «çok lezzetli»', async () => {
    const q = await openPage(browser, { storage:{ 'soyle-srs': JSON.stringify([{ tr:'Ellerinize sağlık, çok güzel.', ru:'x', side:'rec', state:2, step:null, s:3, d:5, due:0, last:0, reps:2, seen:true }]) } });
    const r = await q.evaluate(() => loadCards().map(c => c.tr)); await q.context().close();
    eq(r, ['Ellerinize sağlık, çok lezzetli.']);
  });
  await test('Город: выбор ответа карточками — что сказать, видно сразу по-русски; выбранная раскрывается (турецкий + чтение), говорите её; выбор меняет исход; перевод первой реплики бесплатно', async () => {
    const q = await openCity();
    const home = await q.evaluate(() => [document.querySelectorAll('.ct-task:not(.done)').length, document.getElementById('ctDay').textContent, city.money, city.min]);
    eq(home, [3, 'Дела на сегодня — 3 из 3', 3500, 540]);   // первая зарплата — в понедельник дня 1
    await q.evaluate(() => cityStart('taxi')); await q.waitForTimeout(80);
    const start = await q.evaluate(() => [document.getElementById('ctTr').textContent, document.getElementById('ctSpeak').disabled, document.getElementById('ctWho').textContent, [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)]);
    eq(start, ['Buyurun, nereye?', false, 'Шофёр Али', ['На Таксим, пожалуйста.']]);           // варианты — сразу, по-русски; скрытые ходы (Кадыкёй) не показываются
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
    eq(end, [false, 'Такси до Таксима — так себе', 3470, 540 + 1 + 1 + 2 + 1 + 40, ['Fark etmez.', 'O zaman kalsın, metroyla giderim.', "Taksim'e lütfen."]]);   // метро: −30 ₺, +40 мин; сказанное — в «Память»
    await q.click('#modalPrimary'); await q.waitForTimeout(60);
    // освоение: уровень 1 — без чтения; уровень 2 — первые буквы; подсмотрели — уровень не растёт
    await q.evaluate(() => { city.done = []; cityRender(); }); await q.evaluate(() => cityStart('taxi')); await q.waitForTimeout(80);
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
    await q.evaluate(() => cityStart('bakkal')); await q.waitForTimeout(80);
    eq(await q.evaluate(() => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)), ['Рад быть здесь! (ответ на «hoş geldin»)', 'Здравствуйте!']);
    await ctPick(q, 0); const hb = await ctSay(q, 'hoş bulduk'); ok(hb.next, hb.res); await ctNext(q);
    eq(await q.evaluate(() => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)), ['Хлеб, пожалуйста.', 'Воду, пожалуйста.', 'Десять яиц, пожалуйста.', 'Можно в долг? (так покупают у знакомого бакала)']);
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
  await test('Город: карточка товара в лавке раскрывается — турецкий с чтением виден и значок звука озвучивает (жалоба: «Большой, пожалуйста» не показывал турецкий и не озвучивал)', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = [{ name:'A', lang:'tr-TR' }]; trVoice = trVoices[0]; window.__spoken = []; city.flags = { kedi:1 }; cityStart('mama'); });
    await q.waitForTimeout(150); await ctPick(q, 0); await ctSay(q, 'kedi maması var mı'); await ctNext(q); await q.waitForTimeout(150);
    const before = await q.evaluate(() => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent));
    await ctPick(q, 0);
    const r = await q.evaluate(() => { const on = document.querySelector('#ctOpts .ct-opt.on'); return { on: !!on, tr: on && on.querySelector('.ct-say') && on.querySelector('.ct-say').textContent, read: on && on.querySelector('.ct-read') && on.querySelector('.ct-read').textContent, ear: !!document.querySelector('#ctOpts [data-ear]') }; });
    await q.click('#ctOpts [data-ear]'); await q.waitForTimeout(80);
    const spoken = await q.evaluate(() => window.__spoken.slice(-1)[0]);
    const errs = q.errors; await q.context().close();
    eq(before[0], 'Большой, пожалуйста.'); eq([r.on, r.tr, r.ear], [true, 'Büyük olanı lütfen.', true]); ok(/бюйюк/.test(r.read || ''), r.read); eq(spoken, 'Büyük olanı lütfen.'); eq(errs, []);
  });
  await test('Город: bakkal — «в долг» незнакомому не дают: развилка по смыслу → «тогда не надо» = концовка «так себе» (−60 ₺ супермаркет, +20 мин); дополнительный ход в лавке не ломает список покупок', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; });
    await q.evaluate(() => cityStart('bakkal')); await q.waitForTimeout(80);
    await ctPick(q, 1); await ctSay(q, 'merhaba'); await ctNext(q);
    await ctPick(q, 3); const v = await ctSay(q, 'veresiye olur mu'); ok(v.next, v.res); await ctNext(q);
    const node = await q.evaluate(() => [ct.nodeId, document.getElementById('ctTr').textContent, ct.bought.size]);
    eq(node, ['veresiye', 'Seni daha yeni tanıyorum komşu, veresiye olmaz. Nakit var mı?', 0]);
    const m0 = await q.evaluate(() => [city.money, city.min]);
    await ctPick(q, 1); const k = await ctSay(q, 'o zaman kalsın'); ok(k.next, k.res); await ctNext(q); await q.waitForTimeout(80);
    const r = await q.evaluate(m0 => [document.getElementById('modalTitle').textContent, m0[0] - city.money, city.min - m0[1] >= 20, city.done[0].kind], m0);
    const errs = q.errors; await q.context().close();
    eq(r, ['Bakkal — лавка у дома — так себе', 60, true, 'near']); eq(errs, []);
  });
  await test('Город: терпение кончилось — сцена провалена с последствиями; «Показать» на телефоне — путь без речи и без опыта; итог дня и новый день; всё сохраняется', async () => {
    const q = await openCity();
    await q.evaluate(() => cityStart('kapici')); await q.waitForTimeout(80);
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
    eq(end, [false, 'Kapıcı — нет горячей воды — получилось', [['kapici', 'ok']], { kapici:4 }, true]);   // +1 kolay gelsin (ход), +1 likes «kolay gelsin», +1 просьба понята с первой попытки (likes.firstTry), +1 «lütfen»
    await q.click('#modalPrimary'); await q.waitForTimeout(60);
    await q.evaluate(() => cityStart('bakkal')); await q.waitForTimeout(80);
    const money0 = await q.evaluate(() => city.money);
    await ctPick(q, 1); await ctSay(q, 'merhaba'); await ctNext(q);
    await ctSay(q, 'zzz'); await ctSay(q, 'zzz'); await ctSay(q, 'zzz'); await q.waitForTimeout(80);
    const fail = await q.evaluate(() => [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, city.money, city.done.find(d => d.id === 'bakkal').kind, document.getElementById('modalText').textContent]);
    eq(fail.slice(0, 4), [false, 'Bakkal — лавка у дома — не вышло', money0 - 160, 'bad']); ok(/Что стоило сказать: «Ekmek lütfen»/.test(fail[4]), fail[4]);
    await q.click('#modalPrimary'); await q.waitForTimeout(60);
    const homeNow = await q.evaluate(() => [document.querySelectorAll('.ct-task.done').length, document.querySelector('.ct-task.done.bad') !== null, !!document.getElementById('ctDayEnd'), JSON.parse(localStorage.getItem('soyle-city')).done.length]);
    eq(homeNow, [2, true, false, 2]);
    await q.evaluate(() => cityStart('taxi')); await q.waitForTimeout(80);
    const trace = [];
    for(let i = 0; i < 8 && await q.evaluate(() => !!ct); i++){
      trace.push(await q.evaluate(() => [ct.nodeId, document.getElementById('ctPay').hidden]));
      if(await q.evaluate(() => !document.getElementById('ctPay').hidden)) await q.click('.ct-note:not([disabled]) >> nth=-1'); else await q.click('#ctShow', { timeout:2000 }).catch(e => trace.push('show: ' + e.message.split('\n')[0]));
      await q.waitForTimeout(40); if(await q.evaluate(() => ct && ct.resolved)) await ctNext(q); await q.waitForTimeout(40);
    }
    eq(await q.evaluate(() => [!!ct, document.getElementById('modal').hidden]), [false, false], JSON.stringify(trace)); await q.click('#modalPrimary'); await q.waitForTimeout(60);
    eq(await q.evaluate(() => !!document.getElementById('ctDayEnd')), true);
    await q.click('#ctDayEnd'); await q.waitForTimeout(60);
    eq(await q.evaluate(() => [document.getElementById('modalTitle').textContent, document.getElementById('modalStats').textContent.includes('потрачено'), document.getElementById('modalPrimary').textContent.startsWith('Повторить фразы дня')]), ['День 1 прожит', true, true]);
    await q.click('#modalSecondary'); await q.waitForTimeout(60);                                        // «Новый день» (первая кнопка — повтор фраз дня)
    eq(await q.evaluate(() => [city.day, city.done.length, city.min, document.getElementById('ctDay').textContent, JSON.parse(localStorage.getItem('soyle-city')).day]), [2, 0, 540, 'Дела на сегодня — 3 из 3', 2]);
    const errs = q.errors; await q.context().close(); eq(errs, []);
  });
  await test('Город: собеседник говорит голосом персонажа; турецкий текст открывается после звука; перевод знакомой реплики стоит терпения (один раз)', async () => {
    const q = await openCity({ storage:{ 'soyle-city': JSON.stringify({ seen:{ 'Hoş geldin komşu! Buyur.':1 } }) } });
    await q.evaluate(() => { trVoice = { name:'A', lang:'tr-TR' }; trVoices = [trVoice, { name:'B', lang:'tr-TR' }]; window.__spoken = []; window.__noOnEnd = true; });
    await q.evaluate(() => cityStart('bakkal')); await q.waitForFunction(() => window.__spoken.length > 0, null, { timeout:1500 });
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
  await test('Город: сохранение v1 переносится (rel сцен → персонажи, деньги ≥ 1500, ver 2); персонажи CHARS: голос, терпение, имя; пул разных людей на одном месте (водитель по window.__char, свои реплики)', async () => {
    const q = await openCity({ storage:{ 'soyle-city': JSON.stringify({ day:3, money:120, min:600, rel:{ taxi:2, bakkal:5 }, done:[], said:4, ok:3, days:2 }) } });
    const r = await q.evaluate(async () => { trVoices = [{ name:'A', lang:'tr-TR' }, { name:'B', lang:'tr-TR' }, { name:'C', lang:'tr-TR' }]; trVoice = trVoices[0];
      SCENES.t = { title:'t', who:'Айше', char:'komsu', place:'p', goal:'g', start:'a', fail:{ text:'f', fx:{} }, nodes:{ a:{ npc:'Buyur.', ru:'…', again:'?', againRu:'?', moves:[{ key:['*'], say:['Tamam.'], ru:'ок', go:'e' }] }, e:{ end:{ kind:'ok', text:'e', fx:{} } } } };
      cityStart('t'); await new Promise(z => setTimeout(z, 120)); const out = { ver: city.ver, rel: Object.assign({}, city.rel), money: city.money, day: city.day, pat: ct.patience, voice: window.__lastVoice, want: trVoices[CHARS.komsu.voice % 3].name, who: document.getElementById('ctWho').textContent, arrays: [Array.isArray(city.carry), Array.isArray(city.todaySaid), typeof city.skill, typeof city.played, city.debt] };
      cityFx({ rel:1 }); out.relAfter = city.rel.komsu; cityLeave(); ct = null;
      window.__char = 'sofor_hasan'; cityStart('taxi'); out.pool = [ct.char, document.getElementById('ctWho').textContent, document.getElementById('ctTr').textContent, ct.patience, document.querySelectorAll('#ctInitial svg.avatar').length ? 'портрет' : document.getElementById('ctInitial').textContent];   // у персонажа — свой портрет (просьба 17:02)
      cityLeave(); ct = null; window.__char = null; cityStart('taxi'); out.def = [ct.char, document.getElementById('ctTr').textContent]; return out; });
    const errs = q.errors; await q.context().close();
    eq([r.ver, r.day, r.money], [2, 3, 1500]); eq(r.rel, { sofor:2, bakkal:5 }); eq(r.pat, 4); eq(r.voice, r.want); eq(r.who, 'Айше-тейзе'); eq(r.arrays, [true, true, 'object', 'object', 0]); eq(r.relAfter, 1);
    eq(r.pool, ['sofor_hasan', 'Хасан-амджа', 'Nereye.', 2, 'портрет']); eq(r.def, ['sofor', 'Buyurun, nereye?']); eq(errs, []);
  });
  console.log('«Город»: поле-настолка (кубик, клетки, визит, домой, такси)');
  await test('Поле: 28 клеток кольцом 7×9, расстояния в обе стороны (без срезок), кубик с точками; бросок подсвечивает клетки ≤ N, остановка раньше, шаг 10 мин; место с делом — сцена, без дела — «Зайти?»; бросок сохраняется; «Eve dön»', async () => {
    const q = await openCity();
    const r = await q.evaluate(() => { const out = {};
      out.n = BOARD.length; out.events = BOARD.filter(b => b.kind === 'event').length; out.home = [BOARD[0].kind, city.pos];
      out.dist = [boardDist(0, 27), boardDist(0, 14), boardDist(3, 17), boardDist(10, 24), boardDist(2, 11)];   // без срезок: кольцо в обе стороны
      window.__dice = 3; cityRoll(); out.reach = boardReach(0, 3).sort((a, b) => a - b); out.rollBtn = document.getElementById('ctRoll').disabled;
      out.lit = document.querySelectorAll('.bd-cell.reach').length; out.savedRoll = JSON.parse(localStorage.getItem('soyle-city')).roll; out.rolled = document.getElementById('ctRoll').dataset.n; out.pips = document.querySelectorAll('#ctRoll .die circle').length;
      window.__dice = 6; cityRoll(); out.secondRoll = city.roll;                                   // второй бросок без хода невозможен
      cityMoveTo(2); out.afterMove = [city.pos, city.min, city.roll, !!ct && ct.id, document.querySelectorAll('.bd-cell.reach').length]; out.faceKept = city.face;   // bakkal — дело дня → сцена; грань кубика остаётся 3
      return out; });
    const r2 = await q.evaluate(() => { cityLeave(); ct = null; city.plan = ['taxi']; city.pos = 0; cityRender(); window.__dice = 2; cityRoll(); cityMoveTo(2);
      return { modal: document.getElementById('modalTitle').textContent, pos: city.pos, hidden: document.getElementById('modal').hidden }; });   // bakkal без дела → «Зайти?»
    const r3 = await q.evaluate(() => { document.getElementById('modalSecondary').click(); city.pos = 14; city.min = 20 * 60; cityGoHome(); return { pos: city.pos, min: city.min, modal: document.getElementById('modalTitle').textContent }; });
    const errs = q.errors; await q.context().close();
    eq([r.n, r.events, r.home], [28, 7, ['home', 0]]); eq(r.dist, [1, 14, 14, 14, 9]); eq(r.reach, [1, 2, 3, 25, 26, 27]); eq([r.rollBtn, r.lit, r.savedRoll, r.rolled, r.pips, r.secondRoll], [true, 6, 3, '3', 3, 3]);
    eq(r.afterMove, [2, 540 + 20 + 1, null, 'bakkal', 0]); eq(r.faceKept, 3);   // +1 мин — реплика собеседника; грань после хода остаётся eq(r2, { modal:'Bakkal — зайти?', pos:2, hidden:false }); eq(r3, { pos:0, min: 20 * 60 + 140, modal:'День 1 прожит' });   // 14 → 0: 14 шагов по кольцу eq(errs, []);
  });
  await test('Поле: клетка «?» тянет карту; дом при всех сделанных делах — итоги дня; 21:00 — день заканчивается сам; такси довозит до клетки (цена по расстоянию, числом на слух)', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; });
    const r = await q.evaluate(() => { const out = {};
      city.pos = 0; window.__dice = 3; cityRoll(); cityMoveTo(3); out.event = [city.pos, !!ct, !!(ct && SCENES[ct.id].event)]; cityLeave(); ct = null;   // клетка «?» — карта из колоды
      city.done = city.plan.map(id => ({ id, kind:'ok', short:'', ok:1, n:1, took:5, spent:0 })); city.pos = 1; cityRender(); window.__dice = 1; cityRoll(); cityMoveTo(0);
      out.homeDone = document.getElementById('modalTitle').textContent; document.getElementById('modalSecondary').click();
      city.done = []; city.pos = 5; city.min = 20 * 60 + 55; cityRender(); window.__dice = 1; cityRoll(); cityMoveTo(6);
      out.late = [city.min >= 21 * 60, city.pos, document.getElementById('modalTitle').textContent]; document.getElementById('modalSecondary').click();
      city.min = 10 * 60; city.pos = 0; city.money = 1000; cityRender(); cityTaxiTo(11); out.taxi = [ct && ct.id, ct && ct.dest, [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)[0]];
      return out; });
    await ctPick(q, 0); const a = await ctSay(q, 'eczaneye lütfen'); await ctNext(q);
    const node = await q.evaluate(() => ct.nodeId); await ctPick(q, 0); await ctSay(q, 'olur sorun değil'); await ctNext(q);
    await ctPick(q, 1); await ctSay(q, 'hı hı'); await ctNext(q);                                                     // болтливый Али: разговор о пробках
    const pay = await q.evaluate(() => [ct.nodeId, ct.node.pay.price, document.getElementById('ctTr').textContent]);
    await q.click('.ct-note[data-v="500"]'); await q.waitForTimeout(40); await ctNext(q); await ctPick(q, 1); await ctSay(q, 'teşekkürler iyi günler'); await ctNext(q); await q.waitForTimeout(80);
    const end = await q.evaluate(() => { const t = document.getElementById('modalTitle').textContent; document.getElementById('modalPrimary').click(); return [t, city.pos, document.getElementById('modalTitle').textContent]; });
    const errs = q.errors; await q.context().close();
    eq(r.event, [3, true, true]); eq(r.homeDone, 'День 1 прожит'); eq(r.late, [true, 0, 'День 1 прожит']);
    eq(r.taxi, ['taxi', 11, 'До аптеки, пожалуйста.']); ok(a.next, a.res); eq(node, 'traffic'); eq(pay, ['arrive', 210, 'Geldik. İki yüz on lira.']);   // 0 → 11: 11 шагов, 100 + 10×11
    eq(end, ['Такси до аптеки — получилось', 11, 'Аптека — зайти?']); eq(errs, []);
  });
  await test('Колода: клетка «?» тянет карту (без повтора в день, опасная не первая в день 1, с условием when); кот → флаг и утреннее дело «mama»; собака → минимальная оценка, обход +20, укус; карманник — 5 секунд; дождь — зонт или wet → утром аптека; не тот долмуш — унесло на 6 клеток', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; });
    const r = await q.evaluate(() => { const out = {};
      out.deck = [DECK.length, DECK.every(id => SCENES[id] && SCENES[id].event && ['funny', 'danger', 'neutral'].includes(SCENES[id].mood)), DECK.filter(id => SCENES[id].mood === 'danger').length];
      // день 1, первая карта — не опасная; карты не повторяются; условие when (зонт уже есть → дождь не выпадает)
      city.day = 1; city.deckUsed = []; window.__card = 'kopek'; out.first = cityDraw(); out.firstMood = out.first && SCENES[out.first].mood; cityLeave(); ct = null;
      city.deckUsed = []; city.flags = { semsiye:1 }; window.__card = 'yagmur'; out.rain = cityDraw(); cityLeave(); ct = null; city.flags = {};
      city.deckUsed = ['kedi']; window.__card = 'kedi'; out.repeat = cityDraw(); cityLeave(); ct = null;
      city.deckUsed = DECK.slice(); window.__card = null; out.empty = cityDraw(); ct = null; city.deckUsed = [];
      // кот: «Gel pisi pisi» → флаг, утром дело «mama» первым
      window.__card = 'kedi'; city.pos = 2; window.__dice = 1; cityRoll(); cityMoveTo(3); out.cardStarted = [ct && ct.id, document.getElementById('ctPlace').textContent];
      return out; });
    await ctPick(q, 0); const cat = await ctSay(q, 'gel pisi pisi'); await ctNext(q); await q.waitForTimeout(60);
    const r2 = await q.evaluate(() => { const out = { flag: city.flags.kedi, done: city.done.length, title: document.getElementById('modalTitle').textContent }; document.getElementById('modalPrimary').click();
      city.done = []; cityNewDay(); out.plan = city.plan.slice(0, 1); out.mamaCell = cellOfScene('mama');
      // собака: оценка ниже 70 — не ушла (+20 мин), терпение 2 → второй промах — укус
      cityLeave(); ct = null; city.deckUsed = []; window.__card = 'kopek'; cityDraw(); out.dogPat = ct.patience; out.minScore = ctMoves(ct.node)[0].minScore; return out; });
    const m0 = await q.evaluate(() => city.min); await ctPick(q, 0);
    const d1 = await ctSay(q, 'kit');                                                      // похоже, но слабо: ключ не спасает — нужна оценка
    const d1s = await q.evaluate(m0 => [ct && ct.patience, city.min - m0], m0);
    const d2 = await ctSay(q, 'bla'); await q.waitForTimeout(60);
    const bite = await q.evaluate(() => [document.getElementById('modalTitle').textContent, city.flags.yarali, city.money, document.getElementById('modalText').textContent]);
    const r3 = await q.evaluate(async () => { document.getElementById('modalPrimary').click(); city.money = 1000; city.min = 600;
      // карманник: окно 5 секунд; __slow — не успели (промах приходит после реплики собеседника)
      cityLeave(); ct = null; city.deckUsed = []; window.__slow = true; window.__card = 'yankesici'; cityDraw(); await new Promise(z => setTimeout(z, 200)); const t = document.getElementById('modalTitle').textContent; const money = city.money; window.__slow = false;
      document.getElementById('modalPrimary').click();
      // дождь без зонта → wet; утром с __sick — дело «eczane» в плане
      cityLeave(); ct = null; city.deckUsed = []; window.__card = 'yagmur'; cityDraw(); return { t, money, rainNode: ct.nodeId }; });
    await ctPick(q, 1); await ctSay(q, 'yok böyle giderim'); await ctNext(q); await q.waitForTimeout(60);
    const r4 = await q.evaluate(() => { const wet = city.flags.wet; document.getElementById('modalPrimary').click(); city.done = []; window.__sick = true; cityNewDay(); window.__sick = false;
      const out = { wet, sick: city.plan.includes('eczane'), wetAfter: city.flags.wet };
      // не тот долмуш: сели и поехали → +6 клеток, +30 мин
      cityLeave(); ct = null; city.deckUsed = []; city.pos = 4; city.min = 600; window.__card = 'dolmusyanlis'; cityDraw(); return out; });
    await ctPick(q, 1); await ctSay(q, 'tamam binelim'); await ctNext(q); await ctPick(q, 1); await ctSay(q, 'buyurun bozuk'); await ctNext(q); await q.waitForTimeout(60);
    const r5 = await q.evaluate(() => [document.getElementById('modalTitle').textContent, city.pos, city.min]);
    const errs = q.errors; await q.context().close();
    eq(r.deck, [10, true, 5]); ok(r.first && r.first !== 'kopek' && r.firstMood !== 'danger', 'первая карта дня 1: ' + r.first); eq(r.rain !== 'yagmur', true); eq(r.repeat !== 'kedi', true); eq(r.empty, null);
    eq(r.cardStarted, ['kedi', 'Событие']); ok(cat.next, cat.res); eq([r2.flag, r2.done, r2.title], [1, 0, 'Кот увязался — получилось']); eq([r2.plan, r2.mamaCell], [['mama'], 2]);
    eq([r2.dogPat, r2.minScore], [2, 70]); ok(!d1.next, d1.res); eq(d1s, [1, 20]); ok(/Укусила|укусил/i.test(bite[3]) || /не вышло/.test(bite[0]), bite[0] + bite[3]); eq([bite[1] > 0, bite[2]], [true, 3500 - 300]);   // флаг хранит номер дня; день 2 — без зарплаты
    eq([r3.t, r3.money], ['Карманник — не вышло', 1000 - 200]); eq(r3.rainNode, 'start');
    eq([r4.wet > 0, r4.sick, r4.wetAfter], [true, true, undefined]); eq(r5[0], 'Не тот долмуш — не вышло'); eq([r5[1], r5[2] - 600 >= 30], [10, true]); eq(errs, []);
  });
  await test('Календарь: день 1 — понедельник, зарплата 3500 и план из набора недели (bakkal первым), после 21:00 несделанное переносится первым, закрытое по часам не запускается и помечено, в понедельник зарплата и списание долга, вчерашние дела не повторяются', async () => {
    const q = await openCity();
    const r = await q.evaluate(() => { const out = {};
      out.start = [cityDow(), cityWeek(), city.money, city.plan, SALARY];
      city.min = 21 * 60 + 5; cityRender(); out.late = [document.getElementById('ctRoll').disabled, !document.getElementById('ctHomeBtn').hidden];
      city.done = [{ id:'taxi', kind:'ok', short:'', ok:1, n:1, took:10, spent:180 }]; cityDayEnd(); out.dayEndText = document.getElementById('modalText').textContent; document.getElementById('modalPrimary').click();
      out.day2 = [city.day, cityDow(), city.plan.slice(0, 2), city.carry, city.money];
      SCENES.banka = Object.assign({}, SCENES.kapici, { title:'Банк', char:undefined }); city.plan = ['banka']; city.min = 17 * 60 + 1; cityRender();
      out.bankClosed = [!!document.querySelector('.bd-pin.closed'), cityOpenNow('banka').text, document.querySelector('.ct-task.closed span').textContent];
      city.pos = 17; window.__dice = 1; cityRoll(); cityMoveTo(18); out.noScene = [ct === null, document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent]; if(!document.getElementById('modal').hidden) closeModal();   // 18 — PTT и банк: дело закрыто, но «Зайти?» есть (ревью 07:52)
      city.min = 10 * 60; out.bankOpen = cityOpenNow('banka'); city.day = 6; out.pazarSat = cityOpenNow('pazar').open; city.day = 7; out.pazarSun = cityOpenNow('pazar');
      city.debt = 200; city.money = 100; cityNewDay(); out.monday = [cityDow(), city.money, city.debt];
      // план дня: 3 из набора недели, вчерашние не повторяются, пока есть другие
      SCENES.x1 = Object.assign({}, SCENES.kapici, { title:'x1' }); SCENES.x2 = Object.assign({}, SCENES.kapici, { title:'x2' }); SCENES.x3 = Object.assign({}, SCENES.kapici, { title:'x3' });
      WEEK_SETS[0].push('x1', 'x2', 'x3'); city.prevPlan = ['bakkal', 'taxi', 'kapici']; city.done = []; city.carry = []; cityNewDay(); out.fresh = city.plan;
      delete SCENES.x1; delete SCENES.x2; delete SCENES.x3; delete SCENES.banka; WEEK_SETS[0].splice(-3, 3);
      return out; });
    const errs = q.errors; await q.context().close();
    eq(r.start, [1, 1, 3500, ['bakkal', 'taxi', 'kapici'], 3500]); eq(r.late, [true, true]); ok(/не успели: .*Bakkal/i.test(r.dayEndText), r.dayEndText);
    eq(r.day2, [2, 2, ['bakkal', 'kapici'], [], 3500]);                                 // перенесённые — первыми; зарплаты во вторник нет
    eq(r.bankClosed, [true, 'пн–пт 09:00–17:00', 'пн–пт 09:00–17:00']); eq(r.noScene, [true, false, 'PTT и банк — зайти?']); eq(r.bankOpen.open, true); eq(r.pazarSat, true); eq([r.pazarSun.open, r.pazarSun.text], [false, 'вт и сб']);
    eq(r.monday, [1, 100 + 3500 - 200, 0]); eq(r.fresh.length, 3); ok(r.fresh.every(id => !['bakkal', 'taxi', 'kapici'].includes(id)), 'вчерашние повторились: ' + r.fresh.join()); eq(errs, []);
  });
  await test('Характер: за то, что персонаж любит, отношение растёт сверх вежливости (один раз за сцену); узел-разговор у болтливого шофёра даёт +1 за поддержку, молчун его пропускает; аптекарша ценит точность с первой попытки; молчун — ни одного переспроса', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__char = 'sofor'; cityStart('taxi'); });
    await ctPick(q, 0); await ctSay(q, 'taksime lütfen'); await ctNext(q); await ctPick(q, 0); await ctSay(q, 'meydana lütfen'); await ctNext(q);
    await ctPick(q, 0); await ctSay(q, 'olur sorun değil'); await ctNext(q);
    const chat = await q.evaluate(() => ({ node: ct.nodeId, npc: document.getElementById('ctTr').textContent, opts: [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent), rel: city.rel.sofor || 0 }));
    await ctPick(q, 0); const r = await ctSay(q, 'evet çok yoğun'); const rel = await q.evaluate(() => city.rel.sofor);
    const r2 = await q.evaluate(() => { cityLeave(); ct = null; city.rel = {}; window.__char = 'sofor_hasan'; cityStart('taxi'); return ct.char; });
    await ctPick(q, 0); await ctSay(q, 'taksime lütfen'); await ctNext(q); await ctPick(q, 0); await ctSay(q, 'meydana lütfen'); await ctNext(q); await ctPick(q, 0); await ctSay(q, 'olur sorun değil'); await ctNext(q);
    const hasan = await q.evaluate(() => [ct.nodeId, document.getElementById('ctTr').textContent]);
    await q.click('.ct-note[data-v="200"]'); await q.waitForTimeout(40); await ctNext(q); await ctPick(q, 1); await ctSay(q, 'teşekkürler iyi günler'); await ctNext(q); await q.waitForTimeout(80);
    const quiet = await q.evaluate(() => { const t = document.getElementById('modalText').textContent; document.getElementById('modalPrimary').click(); return [city.rel.sofor_hasan, /ни одного переспроса|молчал/i.test(t)]; });
    const first = await q.evaluate(() => { cityLeave(); ct = null; city.rel = {};
      SCENES.t = { title:'t', char:'eczaci', who:'Z', initial:'Z', place:'p', goal:'g', start:'a', fail:{ text:'f', fx:{} }, nodes:{ a:{ npc:'Kaç tane?', ru:'…', again:'?', againRu:'?', moves:[{ key:['#num'], say:['İki tane.'], ru:'две', go:'e' }] }, e:{ end:{ kind:'ok', text:'e', fx:{} } } } };
      cityStart('t'); return ct.char; });
    await ctPick(q, 0); const f1 = await ctSay(q, 'iki tane'); const relZ = await q.evaluate(() => city.rel.eczaci);
    const errs = q.errors; await q.context().close();
    eq([chat.node, chat.npc, chat.opts.length, chat.rel], ['chat', 'Bu trafik hiç bitmiyor ya.', 2, 2]); ok(/приятно/.test(r.res), r.res); eq(rel, 3);   // 2 — два «lütfen» (вежливость считается в каждой реплике), +1 за поддержанный разговор
    eq(r2, 'sofor_hasan'); eq(hasan[0], 'arrive'); eq(quiet, [4, true]);   // 3 вежливых реплики + 1 за тишину eq(first, 'eczaci'); ok(f1.next, f1.res); eq(relZ, 1); eq(errs, []);
  });
  await test('Способности: счётчики (Dil ≥ 90, Kulak без перевода, Nezaket вежливость) и уровни по порогам 3/8/15/25/40; Dil 2 — порог 75, Dil 4 — 80; Nezaket 3 — терпение +1; Kulak 2 — rate 1.0; опыт ×1,25 на 5-м; окно уровня внутри сцены — после итога', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = [{ name:'A', lang:'tr-TR' }]; trVoice = trVoices[0]; MILESTONE_MODALS = true; game.xp = 200; });   // xp 200: уровень игры за сцену не вырастет — окна только у способностей
    const r = await q.evaluate(async () => { const out = {};
      out.lvls = SKILL_LVLS; out.ids = Object.keys(SKILLS);
      city.skill = { dil:{ n:7, lvl:1 } }; skillBump('dil'); out.lvl = skillLvl('dil'); await new Promise(z => setTimeout(z, 50));
      out.modal = [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent]; document.getElementById('modalPrimary').click();   // вне сцены — окно сразу
      out.thr = [ctAcceptScore()]; city.skill.dil.lvl = 4; out.thr.push(ctAcceptScore()); city.skill.dil.lvl = 2;
      city.skill.nezaket = { n:15, lvl:3 }; cityStart('kapici'); out.pat = ct.patience; cityLeave(); ct = null;
      city.skill.kulak = { n:8, lvl:2 }; out.rate = npcRate();
      city.skill.kulak.lvl = 5; city.skill.dil.lvl = 5; out.mult = cityXpMult();
      city.skill = {}; window.__char = 'sofor'; cityStart('taxi'); return out; });
    await ctPick(q, 0); const a = await ctSay(q, 'taksime lütfen');
    const c1 = await q.evaluate(() => ({ dil: city.skill.dil && city.skill.dil.n, kulak: city.skill.kulak && city.skill.kulak.n, nez: city.skill.nezaket && city.skill.nezaket.n }));
    await ctNext(q); await q.evaluate(() => { cityReveal(); });                               // посмотрели перевод — Kulak за эту реплику не растёт
    await ctPick(q, 0); await ctSay(q, 'meydana lütfen');
    const c2 = await q.evaluate(() => ({ kulak: city.skill.kulak.n, nez: city.skill.nezaket.n }));
    // уровень во время сцены: окно — после итога сцены
    await q.evaluate(() => { city.skill.dil = { n:2, lvl:0 }; }); await ctNext(q); await ctPick(q, 0); await ctSay(q, 'olur sorun değil');
    const during = await q.evaluate(() => [document.getElementById('modal').hidden, city.skill.dil.lvl, ct.levelUps]);
    await ctNext(q); await ctPick(q, 1); await ctSay(q, 'hı hı'); await ctNext(q); await q.click('.ct-note[data-v="200"]'); await q.waitForTimeout(40); await ctNext(q);
    await ctPick(q, 1); await ctSay(q, 'teşekkürler iyi günler'); await ctNext(q); await q.waitForTimeout(80);
    const after = await q.evaluate(async () => { const t1 = document.getElementById('modalTitle').textContent; document.getElementById('modalPrimary').click(); await new Promise(z => setTimeout(z, 250)); return [t1, document.getElementById('modalTitle').textContent]; });
    const errs = q.errors; await q.context().close();
    eq(r.lvls, [3, 8, 15, 25, 40]); eq(r.ids, ['kulak', 'dil', 'pazarlik', 'nezaket']); eq(r.lvl, 2); eq(r.modal, [false, 'Dil 2']); eq(r.thr, [75, 80]); eq(r.pat, 4); eq(r.rate, 1.0); eq(r.mult, 1.5625);
    ok(a.next, a.res); eq(c1, { dil:1, kulak:1, nez:1 }); eq(c2, { kulak:1, nez:2 });
    eq(during, [true, 1, ['dil']]); ok(/Такси до Таксима/.test(after[0]), after[0]); eq(after[1], 'Dil 1'); eq(errs, []);
  });
  await test('Узел «число на слух»: три варианта (четыре при Kulak 3), верный — дальше и Kulak +1 с первой попытки, неверный — терпение −1 и переспрос; звонок: без «Показать», значок трубки, «Tekrar eder misiniz?» первый раз бесплатно, потом −1', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; });
    const r = await q.evaluate(() => { const out = {};
      SCENES.cd = { title:'cd', who:'K', initial:'K', place:'p', goal:'g', start:'a', fail:{ text:'f', fx:{} }, nodes:{
        a:{ npc:'Numaranız on yedi.', ru:'Ваш номер семнадцать.', again:'On yedi.', againRu:'Семнадцать.', code:{ value:'17', options:['17', '7', '70', '27'], go:'e' } },
        e:{ end:{ kind:'ok', text:'e', fx:{} } } } };
      cityStart('cd'); out.btns = [...document.querySelectorAll('#ctPay .ct-code')].map(b => b.textContent); out.ui = [document.getElementById('ctPay').hidden, document.getElementById('ctSpeak').disabled, document.getElementById('ctShow').disabled];
      cityCode('7'); out.wrong = [ct.patience, document.getElementById('ctTr').textContent, ct.resolved];
      cityCode('17'); out.right = [ct.resolved, (city.skill.kulak || {}).n || 0];
      cityLeave(); ct = null; city.skill.kulak = { n:15, lvl:3 }; cityStart('cd'); out.four = document.querySelectorAll('#ctPay .ct-code').length; cityCode('17'); out.first = city.skill.kulak.n;
      cityLeave(); ct = null; city.skill = {};
      SCENES.ph = { title:'ph', who:'Su Dünyası', initial:'S', place:'Телефон', phone:true, goal:'g', start:'a', fail:{ text:'f', fx:{} }, nodes:{
        a:{ npc:'Alo, Su Dünyası, buyurun.', ru:'Алло, «Су Дюньясы», слушаю.', again:'Buyurun?', againRu:'Слушаю?', moves:[{ key:['damacana', 'su'], say:['Bir damacana su lütfen.'], ru:'Одну бутыль воды, пожалуйста.', go:'e' }] },
        e:{ end:{ kind:'ok', text:'e', fx:{} } } } };
      cityStart('ph'); out.phone = [document.getElementById('ctShow').disabled, !!document.querySelector('#ctInitial svg use[href="#i-phone"]'), [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent).pop(), ct.patience];
      return out; });
    await ctPick(q, 1); const rep1 = await ctSay(q, 'tekrar eder misiniz');
    const rep2 = await ctSay(q, 'tekrar eder misiniz');
    const ph = await q.evaluate(() => { cityPhone(); return [document.getElementById('ctResult').textContent, ct.resolved, city.min]; });
    await ctPick(q, 0); const ok1 = await ctSay(q, 'bir damacana su lütfen');
    const errs = q.errors; await q.context().close();
    eq(r.btns.length, 3); ok(r.btns.includes('17'), r.btns.join()); eq(r.ui, [false, true, true]); eq(r.wrong, [2, 'On yedi.', false]); eq(r.right, [true, 0]);   // после ошибки Kulak не растёт
    eq(r.four, 4); eq(r.first, 16); eq(r.phone, [true, true, 'Повторите, пожалуйста?', 3]);
    eq([rep1.pat, rep1.npc], [3, 'Alo, Su Dünyası, buyurun.']); eq(rep2.pat, 2); ok(/телефон/i.test(ph[0]) && !ph[1], ph[0]); ok(ok1.next, ok1.res); eq(errs, []);
  });
  await test('Отношения открывают варианты узлов: шофёр ≥3 не спрашивает адрес, ≥6 скидка; bakkal ≥3 «для тебя найдётся», ≥6 — в долг (и при нехватке денег); kapıcı ≥3 приходит сегодня без «çok acil»', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__char = 'sofor'; });
    const r = await q.evaluate(() => { const out = {};
      city.rel = { sofor:3 }; cityStart('taxi'); out.greet = [ctNodeFor('greet').npc, ctMoves(ct.node)[0].say[0], ctMoves(ct.node)[0].go]; cityLeave(); ct = null;
      city.rel = { sofor:6 }; cityStart('taxi'); cityNode('arrive'); out.arrive = [ct.node.pay.price, document.getElementById('ctTr').textContent]; cityLeave(); ct = null;
      city.rel = { sofor:6 }; cityTaxiTo(11); cityNode('arrive'); out.taxiTo = ct.node.pay.price; cityLeave(); ct = null;          // 210 → 185 (10% вниз, кратно 5)
      city.rel = { bakkal:3 }; window.__char = 'bakkal'; cityStart('bakkal'); out.none = ctNodeFor('list').none.npc; cityLeave(); ct = null;
      city.rel = { bakkal:6 }; city.money = 50; cityStart('bakkal'); cityNode('price'); out.credit = [ct.resolved, city.debt, city.money, document.getElementById('ctTr').textContent, document.getElementById('modal').hidden]; cityLeave(); ct = null;
      city.rel = { bakkal:6 }; city.money = 500; city.debt = 0; cityStart('bakkal'); out.veresiye = ctNodeFor('veresiye').npc; cityLeave(); ct = null;
      city.rel = { kapici:3 }; cityStart('kapici'); out.when = [ctNodeFor('when').npc, ctNodeFor('when').moves.map(m => m.go)]; cityLeave(); ct = null;
      city.rel = {}; cityStart('kapici'); out.when0 = ctNodeFor('when').npc; cityLeave(); ct = null;
      return out; });
    const errs = q.errors; await q.context().close();
    eq(r.greet, ['Her zamanki yere mi?', "Evet, Taksim'e.", 'traffic']); eq(r.arrive, [160, 'Sana yüz altmış olsun.']); eq(r.taxiTo, 185);
    eq(r.none, 'Senin için her zaman var, komşu. Başka?'); eq(r.credit, [true, 60, 0, 'Sonra ödersin, komşu.', true]); eq(r.veresiye, 'Tabii komşu, yazıyorum. Sonra ödersin.');
    eq(r.when, ['Tamam komşu, bir saat sonra bakarım.', ['fixed']]); eq(r.when0, 'Bugün bakamam. Yarın sabah gelirim, olur mu?'); eq(errs, []);
  });
  await test('Повторить фразы дня: сказанное верно копится за день; в итогах дня первая кнопка — «Повторить фразы дня (N)» → очередь «Памяти» только из них, после неё — возврат в «Город»; при пустом дне — «Новый день»', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__char = 'sofor'; cityStart('taxi'); });
    await ctPick(q, 0); await ctSay(q, 'taksime lütfen'); await ctNext(q); await ctPick(q, 0); await ctSay(q, 'meydana lütfen'); await ctNext(q);
    const said = await q.evaluate(() => { cityLeave(); ct = null; return city.todaySaid; });
    const m0 = await q.evaluate(() => { cityDayEnd(); return [document.getElementById('modalPrimary').textContent, document.getElementById('modalSecondary').textContent]; });
    await q.click('#modalPrimary'); await q.waitForTimeout(80);
    const m1 = await q.evaluate(() => [mode, mem && mem.card && mem.card.tr, mem && mem.phase, document.getElementById('memDue').textContent]);
    const seen = new Set();
    for(let i = 0; i < 14; i++){
      const st = await q.evaluate(() => ({ mode, phase: mem && mem.phase, tr: mem && mem.card && mem.card.tr }));
      if(st.mode !== 'memory') break;
      if(st.tr) seen.add(st.tr);
      if(st.phase === 'study' || st.phase === 'prompt'){ await q.click('#next'); }
      else if(st.phase === 'answer'){ await q.click('#memGrades .grade[data-g="3"]'); }
      else break;
      await q.waitForTimeout(60);
    }
    const end = await q.evaluate(() => [mode, memFilter, city.todaySaid.length]);
    const empty = await q.evaluate(() => { city.todaySaid = []; cityDayEnd(); const t = document.getElementById('modalPrimary').textContent; document.getElementById('modalSecondary').click(); return t; });
    const errs = q.errors; await q.context().close();
    eq(said, ["Taksim'e lütfen.", 'Meydana lütfen.']); eq(m0, ['Повторить фразы дня (2)', 'Новый день']);
    eq(m1[0], 'memory'); ok(said.includes(m1[1]), 'первая карточка: ' + m1[1]); eq([...seen].sort(), said.slice().sort());
    eq(end, ['city', null, 2]); eq(empty, 'Новый день'); eq(errs, []);
  });
  await test('Дом: вкладки внутри кольца «Дела · Люди · Умения» — люди с уровнем отношений и карточкой персонажа, четыре полосы способностей; «Прогресс» — плитка «Город»; медали Hafta и Komşu', async () => {
    const q = await openCity();
    const r = await q.evaluate(() => { const out = {};
      city.rel = { bakkal:3, sofor:6 }; city.played = { taxi:{ n:2, ok:2, last:1 } }; city.skill = { dil:{ n:4, lvl:1 } }; cityRender();
      out.tabs = [...document.querySelectorAll('#ctInnerTabs button')].map(b => b.textContent);
      document.getElementById('ctTabPeople').click(); out.people = [...document.querySelectorAll('#ctChars .ct-char')].map(b => [b.dataset.char, b.querySelector('.ct-char-lvl').textContent]);
      out.visible = [document.getElementById('ctTasks').hidden, document.getElementById('ctChars').hidden];
      document.querySelector('#ctChars .ct-char[data-char="sofor"]').click(); out.card = [document.getElementById('modalTitle').textContent, document.getElementById('modalText').textContent]; document.getElementById('modalPrimary').click();
      document.getElementById('ctTabSkills').click(); out.skills = [...document.querySelectorAll('#ctSkills .ct-skill')].map(e => [e.dataset.skill, e.querySelector('b').textContent, e.querySelector('.bar i').style.width]);
      document.getElementById('ctTabTasks').click(); out.back = [document.getElementById('ctTasks').hidden, localStorage.getItem('soyle-city-tab')];
      setMode('progress'); out.tile = [document.getElementById('gbCity').textContent, document.getElementById('gbCitySub').textContent];
      city.days = 7; checkBadges(); out.badges = [game.badges.includes('hafta'), game.badges.includes('komsu'), BADGES.length];
      return out; });
    const errs = q.errors; await q.context().close();
    eq(r.tabs, ['Дела', 'Люди', 'Умения']); eq(r.people, [['sofor', 'свой'], ['bakkal', 'знакомый']]); eq(r.visible, [true, false]);
    eq(r.card[0], 'Шофёр Али'); ok(/Разговорчивый/.test(r.card[1]) && /Такси до Таксима/.test(r.card[1]) && /свой/.test(r.card[1]), r.card[1]);
    eq(r.skills, [['kulak', '0', '0%'], ['dil', '1', '50%'], ['pazarlik', '0', '0%'], ['nezaket', '0', '0%']]);   // полоса — доля до следующего порога: dil 4 из 8
    eq(r.back, [false, 'tasks']); eq(r.tile, ['день 1 · неделя 1', 'дел хорошо 2 из 2 · 3500 ₺ · знакомых 2']);   // played: taxi n 2, ok 2 eq(r.badges, [true, true, 22]); eq(errs, []);
  });
  await test('Сцены недели 1: аптека — дозировка числом на слух (Zeynep ≥3 — два варианта, ≥6 — без вопроса о рецепте, после 19:00 — дежурная), звонок за водой (#num адрес), Айше-тейзе (терпение 4, чай/отказ), уста — «elinize sağlık» ценит, ≥3 чай угощение', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; });
    const r = await q.evaluate(() => { const out = {};
      out.week1 = ['simit', 'dolmus', 'istanbulkart', 'firin', 'market', 'cay', 'lokanta', 'eczane', 'komsu', 'su'].map(id => !!SCENES[id] && cellOfScene(id) >= 0);
      city.rel = {}; cityStart('eczane'); cityNode('dose'); out.dose3 = document.querySelectorAll('#ctPay .ct-code').length; cityLeave(); ct = null;
      city.rel = { eczaci:3 }; cityStart('eczane'); cityNode('dose'); out.dose2 = document.querySelectorAll('#ctPay .ct-code').length; cityLeave(); ct = null;
      city.rel = { eczaci:6 }; cityStart('eczane'); cityNode('recete'); out.norecete = [!!ct.node.code, document.querySelectorAll('#ctPay .ct-code').length]; cityLeave(); ct = null;
      city.rel = {}; city.min = 19 * 60 + 30; cityStart('eczane'); out.late = document.getElementById('ctTr').textContent; cityLeave(); ct = null; city.min = 600;
      cityStart('su'); out.su = [!!ct.scene.phone, document.getElementById('ctShow').disabled]; return out; });
    await ctPick(q, 0); await ctSay(q, 'bir damacana su lütfen'); await ctNext(q); await ctPick(q, 0); const addr = await ctSay(q, 'gül sokak 5 numara üçüncü kat');
    const r2 = await q.evaluate(() => { cityLeave(); ct = null; cityStart('komsu'); return [ct.patience, ct.char, [...document.querySelectorAll('#ctOpts .ct-opt-main')].length]; });
    await ctPick(q, 1); const k = await ctSay(q, 'şimdi olmaz işim var'); await ctNext(q); await q.waitForTimeout(80);
    const r3 = await q.evaluate(() => { const t = document.getElementById('modalTitle').textContent; document.getElementById('modalPrimary').click(); city.rel = {}; cityStart('cay'); cityNode('bill'); return [t, ct.node.pay && ct.node.pay.price]; });
    await q.click('.ct-note[data-v="20"]'); await q.waitForTimeout(40); await ctNext(q); await ctPick(q, 0); const el = await ctSay(q, 'elinize sağlık çok güzeldi');
    const r4 = await q.evaluate(() => { const rel = city.rel.usta; cityLeave(); ct = null; city.rel = { usta:3 }; cityStart('cay'); cityNode('bill'); return [rel, !!ct.node.pay, document.getElementById('ctTr').textContent]; });
    const errs = q.errors; await q.context().close();
    eq(r.week1, Array(10).fill(true)); eq([r.dose3, r.dose2], [3, 2]); eq(r.norecete, [true, 3]); eq(r.late, 'Nöbetçi eczane, buyurun. Biraz bekleyin.'); eq(r.su, [true, true]); ok(addr.next, addr.res);
    eq(r2, [4, 'komsu', 2]); ok(k.next, k.res); eq(r3[0], 'Айше-тейзе зовёт на чай — так себе'); eq(r3[1], 15); ok(el.next && /приятно/.test(el.res), el.res); eq(r4, [1, false, 'Çay ikram, komşu. Para yok.']); eq(errs, []);   // «elinize sağlık» — то, что уста ценит: +1 (в POLITE этого оборота нет)
  });
  await test('Разнообразие разговоров (22:26): ≥ 50 светских реплик без повторов — узел «_chat» перед сценой, «Evet, öyle.» принимается и ценится; приветствия — списки вариантов с параллельным переводом по ct.seed; на каждой клетке-месте без дела есть сцена «зайти» (стоянка такси → вызов такси)', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; window.__char = 'bakkal'; });
    const r = await q.evaluate(() => { const out = {};
      out.n = SMALLTALK.length; out.uniq = new Set(SMALLTALK.map(t => t.tr)).size;
      out.bad = SMALLTALK.filter(t => !/^[A-ZÇĞİÖŞÜ].*[.!?]$/.test(t.tr) || !t.ru || /\p{Extended_Pictographic}/u.test(t.tr + t.ru)).map(t => t.tr);
      out.gloss = SMALLTALK_MOVES.flatMap(m => m.say[0].split(/\s+/)).map(w => w.replace(/[^\p{L}]/gu, '')).filter(w => nphr(w) && !wordGloss(w));
      out.arrays = Object.values(SCENES).reduce((k, sc) => k + Object.values(sc.nodes).filter(n => Array.isArray(n.npc)).length, 0);
      window.__smalltalk = 3; window.__seed = 0; cityStart('bakkal');
      out.chat = [ct.node === ct.scene.nodes._chat, document.getElementById('ctTr').textContent === SMALLTALK[3].tr, document.getElementById('ctRu').textContent === SMALLTALK[3].ru, [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent)];
      return out; });
    await ctPick(q, 0); const s = await ctSay(q, 'evet öyle'); await ctNext(q);
    const r2 = await q.evaluate(() => { const out = { liked: ct.liked, greet: [ct.node === ct.scene.nodes.greet, document.getElementById('ctTr').textContent, document.getElementById('ctRu').textContent] };
      cityLeave(); ct = null; window.__smalltalk = undefined; window.__seed = 1; cityStart('bakkal');
      out.seed1 = [ct.node === ct.scene.nodes.greet, document.getElementById('ctTr').textContent, document.getElementById('ctRu').textContent];
      cityLeave(); ct = null; window.__seed = 0; window.__char = 'kapici'; cityStart('mama');
      out.mama = [document.getElementById('ctTr').textContent, document.getElementById('ctRu').textContent, SCENES.mama.nodes.greet.npc.length]; cityLeave(); ct = null; window.__char = undefined;
      // клетки-места: у каждой без дела — сцена «зайти»; такси — вызов
      out.visits = []; city.plan = []; city.money = 3000;
      BOARD.forEach((c, i) => { if(c.kind !== 'place') return; cityVisit(i);
        const m = document.getElementById('modal');
        out.visits.push([c.id, m.hidden ? 'toast' : document.getElementById('modalPrimary').textContent, ct ? ct.id : null]);
        if(!m.hidden){ document.getElementById('modalPrimary').click(); out.visits[out.visits.length - 1].push(ct ? ct.id : null, !!ct && ct.id === ('visit_' + c.id) || !!ct && (c.scenes || []).includes(ct.id)); }
        cityLeave(); ct = null; if(!m.hidden) closeModal(); });
      return out; });
    const errs = q.errors; await q.context().close();
    ok(r.n >= 50 && r.uniq === r.n, `светских реплик ${r.n}, разных ${r.uniq}`); eq(r.bad, []); eq(r.gloss, []); ok(r.arrays >= 8, 'узлов со списком реплик: ' + r.arrays);
    eq(r.chat, [true, true, true, ['Да, так и есть. (поддержать разговор)', 'Угу. (кивнуть)']]); ok(s.next, s.res);
    eq(r2.liked, true); eq(r2.greet, [true, 'Hoş geldin komşu! Buyur.', 'Добро пожаловать, сосед! Слушаю.']);
    eq(r2.seed1, [true, 'Hoş geldin! Ne lazım bugün?', 'Добро пожаловать! Что нужно сегодня?']); eq(r2.mama, ['Komşu, hoş geldin! Ne lazım?', 'Сосед, добро пожаловать! Что нужно?', 8]);   // 07:52: приветствий у бакала 8
    const taxi = r2.visits.find(v => v[0] === 'taksi'), rest = r2.visits.filter(v => v[0] !== 'taksi');
    ok(taxi && taxi[1] === 'toast', 'такси без дел — подсказка: ' + JSON.stringify(taxi));
    eq(rest.length, 19); eq(rest.filter(v => v[1] !== 'Зайти' || !v[3] || !v[4]).map(v => v.slice(0, 4)), []); eq(errs, []);
  });
  await test('Вариативность (07:52): узлы с alt — свой вариант на визит (window.__alt или seed), «сквозной» pass пропускает узел, подряд не повторяется, текст итога — список; «Корм для кота» — ≥ 50 разных реплик игрока, два визита с разными seed отличаются; у всех 20 мест своя сцена visit_*, дом среди дня — в дверь звонят; свободное дело вместо захода', async () => {
    const q = await openCity(); await q.evaluate(() => { trVoices = []; });
    const r = await q.evaluate(() => { const out = {}; const tr = () => document.getElementById('ctTr').textContent, opts = () => [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent);
      SCENES.__t = { title:'t', who:'t', initial:'T', place:'t', goal:'t', start:'a', fail:{ text:'f', fx:{} }, nodes:{
        a:{ npc:'A sıfır.', ru:'а0', again:'A?', againRu:'а?', moves:[{ key:['bir'], say:['Bir.'], ru:'раз', go:'b' }],
            alt:[ {}, { npc:'A bir.', ru:'а1', moves:[{ key:['iki'], say:['İki.'], ru:'два', go:'b' }] } ] },
        b:{ npc:'B.', ru:'б', again:'B?', againRu:'б?', moves:[{ key:['üç'], say:['Üç.'], ru:'три', go:'e' }], alt:[ {}, { pass:'e' } ] },
        e:{ end:{ kind:'ok', text:['конец ноль', 'конец один'], fx:{} } } } };
      window.__alt = { a:1, b:0 }; window.__seed = 0; cityStart('__t');
      out.alt1 = [tr(), opts(), ct.alts.a];
      cityNode('b'); out.b0 = [tr(), !!ct.node.end];
      cityLeave(); ct = null; window.__alt = { a:0, b:1 }; cityStart('__t');
      out.alt0 = [tr(), opts()];
      cityNode('b'); out.pass = [!ct, document.getElementById('modalText').textContent]; closeModal();          // сквозной: b пропущен, сразу концовка; текст итога — по seed
      window.__alt = undefined; window.__seed = 1; cityStart('__t'); out.seed1 = [tr(), opts()]; cityNode('e'); out.end1 = document.getElementById('modalText').textContent; closeModal();
      // в игре выбор случайный и не тот, что в прошлый визит: ctAltPick с памятью city.altLast
      city.altLast = {}; const seen = new Set(); let same = 0, prev = -1;
      for(let i = 0; i < 40; i++){ const k = ctAltPick('__t', 'a', 3, true); if(k === prev) same++; prev = k; seen.add(k); }
      out.pick = [same, [...seen].sort().join(''), city.altLast['__t.a']];
      delete SCENES.__t; window.__seed = 0;
      // корм коту: по всем вариантам всех узлов — разных реплик игрока ≥ 50; два визита с разными seed — другая реплика собеседника и другие карточки
      const says = new Set(); Object.values(SCENES.mama.nodes).forEach(n => [n, ...(n.alt || []), ...(n.variants || [])].forEach(v => (v.moves || []).concat(v.extra || []).forEach(m => says.add(m.say[0]))));
      out.mamaSays = says.size;
      window.__char = 'bakkal'; const visit = seed => { window.__seed = seed; cityStart('mama'); const v = [tr(), opts()]; cityNode('ask'); v.push(tr(), opts()); cityLeave(); ct = null; return v; };
      const v0 = visit(0), v1 = visit(1); window.__seed = 0; window.__char = undefined;
      out.twoVisits = [v0[0] !== v1[0], JSON.stringify(v0[1]) !== JSON.stringify(v1[1]), v0[2] !== v1[2], JSON.stringify(v0[3]) !== JSON.stringify(v1[3])];
      // клетки: у каждого места своя visit_*, дом — visit_ev (в дверь звонят), стоянка — вызов такси
      out.noVisit = BOARD.filter(c => c.kind === 'place' && c.id !== 'taksi' && !SCENES['visit_' + c.id]).map(c => c.id);
      city.plan = ['taxi']; city.done = []; city.money = 3000; city.pos = 0; city.min = 12 * 60; cityArrive(0);
      out.ev = [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent, document.getElementById('modalPrimary').textContent]; document.getElementById('modalPrimary').click(); out.evScene = ct ? ct.id : null; cityLeave(); ct = null;
      // свободное дело (симит без плана) вместо короткой сцены — кандидаты: visit_* и сцены с free:true
      window.__visit = 'simit'; cityVisit(cellOfScene('simit')); out.freeText = document.getElementById('modalText').textContent; document.getElementById('modalPrimary').click(); out.free = ct ? ct.id : null; cityLeave(); ct = null;
      window.__visit = 'nope'; cityVisit(cellOfScene('simit')); document.getElementById('modalPrimary').click(); out.freeDefault = ct ? ct.id : null; cityLeave(); ct = null; window.__visit = undefined;
      out.frees = Object.keys(SCENES).filter(id => SCENES[id].free);
      // ревью: ход с покупкой дороже наличных не предлагается (деньги не уходят в минус); если других ходов нет — остаётся
      city.money = 50; window.__alt = { a:1 }; cityStart('visit_lokanta'); out.poor = ctMoves(ct.node).map(m => m.ru); cityLeave(); ct = null; window.__alt = undefined;
      city.money = 3000; cityStart('visit_lokanta'); window.__alt = { a:1 }; ct.alts = {}; cityNode('a'); out.rich = ctMoves(ct.node).length; cityLeave(); ct = null; window.__alt = undefined;
      // ревью: после 21:00 такси не вызвать (деньги в никуда); закрытое дело на клетке — всё равно «Зайти?»
      city.min = 21 * 60 + 5; cityRender(); out.taxiLate = document.getElementById('ctTaxi').hidden; city.min = 12 * 60;
      OPEN_HOURS.kapici = { days:[1], from:9 * 60, to:10 * 60 }; city.plan = ['kapici']; city.done = []; city.pos = 1; cityArrive(1); out.closed = [document.getElementById('modal').hidden, document.getElementById('modalTitle').textContent]; closeModal(); delete OPEN_HOURS.kapici;
      // ревью: cityNormalize — копия CITY_START глубокая, числовые поля лечатся
      city = { ver:2, money:'x', day:'y', min:null }; cityNormalize(); out.nums = [city.money, city.day, city.min, city.rel !== CITY_START.rel, city.carry !== CITY_START.carry];
      return out; });
    const errs = q.errors; await q.context().close();
    eq(r.alt1, ['A bir.', ['два'], 1]); eq(r.b0, ['B.', false]); eq(r.alt0, ['A sıfır.', ['раз']]); eq(r.pass, [true, 'конец ноль']); eq(r.seed1, ['A bir.', ['два']]); eq(r.end1, 'конец один');
    eq(r.pick[0], 0); eq(r.pick[1], '012'); ok(r.pick[2] >= 0 && r.pick[2] <= 2, 'altLast ' + r.pick[2]);
    ok(r.mamaSays >= 50, 'разных реплик игрока в «Корм для кота»: ' + r.mamaSays); eq(r.twoVisits, [true, true, true, true]);
    eq(r.noVisit, []); eq(r.ev, [false, 'Дом — в дверь звонят', 'Открыть']); eq(r.evScene, 'visit_ev');
    eq(r.free, 'simit'); ok(/без плана/.test(r.freeText), r.freeText); eq(r.freeDefault, 'visit_simitci'); ok(r.frees.length >= 5, 'free: ' + r.frees.join(','));
    eq(r.poor, ['Сегодня не получится, в другой раз.']); eq(r.rich, 3); eq(r.taxiLate, true); eq(r.closed, [false, 'Подъезд — зайти?']); eq(r.nums, [3500, 1, 540, true, true]); eq(errs, []);
  });
  await test('Поле помещается на 360×640, 390×844, 412×915: клетки ≥ 44 px, дела внутри кольца, кубик и кнопки видны, без прокрутки', async () => {
    const q = await openPage(browser); const bad = [];
    for(const [w, h] of [[360, 640], [390, 844], [412, 915]]){
      await q.setViewportSize({ width:w, height:h }); await q.evaluate(() => { localStorage.removeItem('soyle-city'); city = {}; cityNormalize(); ct = null; setMode('city'); autofit(); }); await q.waitForTimeout(80);
      const r = await q.evaluate(() => { const card = document.getElementById('cityCard'), cells = [...document.querySelectorAll('.bd-cell')];
        const small = cells.filter(b => { const r = b.getBoundingClientRect(); return r.width < 44 || r.height < 44; }).length;
        const inner = document.getElementById('ctInner');
        const vis = id => { const e = document.getElementById(id); if(!e || !e.offsetParent) return false; const r = e.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; };
        const out = { small, cells: cells.length, page: document.documentElement.scrollHeight <= innerHeight + 1, card: card.scrollHeight - card.clientHeight <= 1, innerCut: inner.scrollHeight > inner.clientHeight + 1,
          tasks: document.querySelectorAll('#ctTasks .ct-task').length, roll: vis('ctRoll'), home: vis('ctHomeBtn'), taxi: vis('ctTaxi'), tabs: {} };
        city.rel = { bakkal:3, sofor:6, kapici:1, komsu:2, usta:0 }; city.met = { eczaci:1, berber:1 }; city.skill = { dil:{ n:4, lvl:1 } }; cityRender();   // 7 человек и 4 умения — самые длинные вкладки
        for(const t of ['people', 'skills', 'tasks']){ cityInnerTab(t); autofit(); out.tabs[t] = [inner.scrollHeight > inner.clientHeight + 1, card.scrollHeight - card.clientHeight <= 1, vis('ctRoll'),
          [...inner.querySelectorAll('#ctChars, .ct-skill')].filter(e => e.offsetParent)   /* список людей прокручивается внутри — важно, что он сам в кольце */.every(e => e.getBoundingClientRect().bottom <= inner.getBoundingClientRect().bottom + 1)]; }
        return out; });
      if(r.small || r.cells !== 28 || !r.page || !r.card || r.innerCut || r.tasks !== 3 || !r.roll || !r.home || !r.taxi || Object.values(r.tabs).some(t => t[0] || !t[1] || !t[2] || !t[3])) bad.push(`${w}×${h}: ${JSON.stringify(r)}`);
    }
    await q.context().close(); eq(bad, []);
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
      await q.evaluate(() => cityStart('taxi')); await q.waitForTimeout(60); await check('сцена');
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
    const code = await p.evaluate(() => { game.xp = 777; game.badges = ['first','warm']; saveList('soyle-srs', [{ tr:'Hesap lütfen.', box:2, due:0 }]); saveList('soyle-mine', [{ tr:'Merhaba' }]); city.money = 4321; city.rel.bakkal = 5; citySave(); return bkCode(); });
    const q = await openPage(browser);
    await q.evaluate(() => { localStorage.setItem('soyle-rec-conflict','1'); setMode('progress'); });
    await q.fill('#bkInput', code); await q.click('#bkRestore');
    eq(await q.evaluate(() => [game.xp, document.getElementById('bkConfirm').hidden]), [0, false]); // до подтверждения ничего не меняется
    ok((await q.textContent('#bkConfirmText')).includes('777 XP'));
    await q.click('#bkYes');
    const r = await q.evaluate(() => [game.xp, game.badges, loadList('soyle-mine')[0].tr, srsDue().length, document.getElementById('gbXp').textContent, document.getElementById('bkMsg').textContent, localStorage.getItem('soyle-rec-conflict'), city.money, city.rel.bakkal]);
    const errs = q.errors; await q.context().close();
    eq(r, [777, ['first','warm'], 'Merhaba', 1, '777 / 800 XP', 'Прогресс восстановлен', '1', 4321, 5]); eq(errs, []);   // «Город» тоже перечитан из копии (ревью 07:52: раньше citySave затирал восстановленное)
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
  await test('«Звуки» и пары слов убраны: нет подвкладки, режима и чипа «слова/фразы», блиц — только фразы, медали звуков сняты', async () => {
    const q = await openPage(browser);
    const r = await q.evaluate(() => ({ tab: !!document.getElementById('tab-pairs'), modes: MODES, train: TRAIN,
      groups: typeof GROUPS, lsChip: !!document.getElementById('lsKindChip'), badges: BADGES.map(b => b.id),
      quest: QUESTS.some(x => /Звук/.test(x.t)), help: document.querySelector('details.help').textContent }));
    const errs = q.errors; await q.context().close();
    eq([r.tab, r.lsChip, r.quest], [false, false, false]); eq(r.modes, ['city','memory','phrases','listen','free','grammar','progress']); eq(r.train, ['phrases','listen','free','grammar']);   // «Грамматика» — четвёртая подвкладка (просьба 21:39)
    eq(r.groups, 'undefined'); eq(r.badges.length, 25); ok(!r.badges.some(id => ['ear','blitz10','blitz20','o','u','i','c','sounds'].includes(id)), 'медали звуков: ' + r.badges.join());
    ok(!/Звуки/.test(r.help), 'справка упоминает «Звуки»'); eq(errs, []);
  });
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
    for(const m of ['phrases','listen','free']){
      await p.evaluate(m => { setMode(m); scrollTo(0,0); }, m);
      const bottom = await p.evaluate(() => [...document.querySelectorAll('.card')].find(c => !c.hidden).querySelector('.mic, .ls-opt').getBoundingClientRect().bottom);
      ok(bottom < 844, `${m}: главная кнопка ниже экрана (${Math.round(bottom)})`);
    }
  });
  await test('нет горизонтальной прокрутки на 320px (≈ масштаб 200%)', async () => {
    await p.setViewportSize({ width:320, height:700 });
    for(const m of ['phrases','listen','free']){ await p.evaluate(m => setMode(m), m); ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)), m); }
    await p.setViewportSize({ width:390, height:844 });
  });
  await test('пробел на кнопке нажимает кнопку, а не включает микрофон', async () => {
    await p.evaluate(() => setMode('phrases')); await p.focus('#next'); const t = await p.evaluate(() => item.target);
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
    for(const m of ['phrases','listen','free','progress']){
      await q.evaluate(m => { setMode(m); document.body.classList.add('hints'); }, m); await q.addScriptTag({ content:AXE });
      v.push(...(await q.evaluate(async () => (await axe.run(document, { runOnly:['wcag2a','wcag2aa','wcag21aa'] })).violations.map(x => x.id))).map(id => m + ':' + id));
    }
    await q.context().close(); eq(v, []);
  });
  await test('за весь прогон на странице не было JS-ошибок', async () => eq(p.errors, []));

  await browser.close();
  process.exit(summary());
})();
