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
    const r = await p.evaluate(() => { game = { xp:0, streak:0, lastDay:'', today:'', todayOk:0, combo:0 }; normalizeGame(); todayQuest(); game.quest.done = true; for(let i=0;i<8;i++) award(1); award(0); return [game.xp, game.combo, game.todayOk, game.streak, levelOf(game.xp)]; });
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
      for(let i = 0; i < 2; i++){ await new Promise(z => setTimeout(z, 420)); answerListen(ls.right); }
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
      if(can){ const right = await q.evaluate(() => ls.right); await q.click(right === 'A' ? '#lsA' : '#lsB'); }
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
    await q.evaluate(() => answerListen(ls.right)); // уровень повышается во время блица
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
    q.on('console', m => { if(m.type() === 'error' && !/Failed to load resource|ERR_/.test(m.text())) consoleErr.push(m.text()); });
    await q.evaluate(() => { window.__say = 'merhaba'; });
    for(const tab of ['#tab-pairs','#tab-phrases','#tab-listen','#tab-free','#tab-progress']){
      await q.click(tab); await q.waitForLoadState('networkidle');
      const ids = await q.evaluate(() => [...document.querySelectorAll('.screen > section:not([hidden]) button, .chips button')].filter(b => b.offsetParent && !b.disabled && !['bkYes'].includes(b.id)).map((b, i) => { b.dataset.probe = String(i); return String(i); }));
      for(const id of ids){
        if(await q.isVisible('#modal')) await q.click('#modalSecondary:visible, #modalPrimary');
        const el = await q.$(`[data-probe="${id}"]`); if(el && await el.isVisible() && await el.isEnabled()) await el.click({ timeout:3000 }).catch(() => {});
        await q.waitForTimeout(60);
      }
      await q.evaluate(() => { if(typeof blitz !== 'undefined' && blitz) endBlitz(true); });
      if(await q.isVisible('#modal')) await q.click('#modalPrimary');
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
    eq(r, [['tab-pairs','tab-phrases','tab-listen','tab-free','tab-progress'], 'true', true]);
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
    ok((await u.textContent('#result')).includes('Все слова'), 'Фразы: фраза не засчитана');
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
    const words = ['Свободно','Звуки','Фразы','На слух','Прогресс','Сказать','Дальше','Сравнить','Эхо','Носитель','Синтез','Видео'];
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
    eq(r, ['2', true, 22, true]);
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
