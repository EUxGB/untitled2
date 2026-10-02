// Снимки ЖИВОГО сайта (как видит пользователь): запускается в CI после публикации и проверки verify.
// Результат уходит в ветку `screens` — оттуда его можно посмотреть, не имея доступа к github.io.
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.argv[2], OUT = process.argv[3];
(async () => {
  fs.mkdirSync(OUT, { recursive:true });
  const b = await chromium.launch();
  const log = [];
  // общий предел 25 минут: сохранить то, что успели снять, и выйти
  const save = () => fs.writeFileSync(`${OUT}/info.json`, JSON.stringify({ url: URL, taken: new Date().toISOString(), shots: log }, null, 2));
  setTimeout(() => { log.push({ size:'—', error:'общий предел 25 минут: внешние базы не отвечают, снято не всё' }); save(); process.exit(0); }, 25 * 60e3).unref();
  for(const [w, h, name] of [[360, 640, 'android-360x640'], [390, 844, 'iphone-390x844'], [412, 915, 'android-412x915']]){
    const ctx = await b.newContext({ viewport:{ width:w, height:h }, deviceScaleFactor:2, isMobile:true, hasTouch:true, locale:'ru-RU' });
    const p = await ctx.newPage(); const errs = [];
    // внешние базы могут не отвечать — ни одна проверка не ждёт дольше 5 минут (было: задача висела 35 минут, снимки не сохранились)
    const ev0 = p.evaluate.bind(p);
    p.evaluate = (fn, arg) => { let t; return Promise.race([ev0(fn, arg), new Promise((_, no) => { t = setTimeout(() => no(new Error('проверка дольше 5 минут: внешняя база не отвечает')), 300000); })]).finally(() => clearTimeout(t)); };
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL, { waitUntil:'load' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500);
    const info = await p.evaluate(() => ({ version: (document.getElementById('appVersion') || {}).textContent,
      fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight) }));
    for(const tab of ['memory', 'pairs', 'phrases', 'listen', 'free', 'progress']){
      await p.click('#tab-' + tab); await p.waitForTimeout(1200);
      if(await p.isVisible('#modal')) await p.keyboard.press('Escape');
      await p.screenshot({ path:`${OUT}/${name}-${tab}.png` });
      // обрезанный текст или наложение частей — записываем (пользователь жаловался, что перевод не помещается)
      const cut = await p.evaluate(() => { const card = [...document.querySelectorAll('.screen > .card')].find(c => !c.hidden && c.offsetParent); if(!card) return [];
        const out = [...card.querySelectorAll('#target, #meaning, #partner, .result, .ls-opt')].filter(e => e.offsetParent && e.scrollHeight > e.clientHeight + 1).map(e => e.id || e.className);
        if(card.scrollHeight > card.clientHeight + 1) out.push('card-scroll'); return out; });
      if(cut.length) (info.cuts = info.cuts || []).push(tab + ': ' + cut.join(','));
    }
    // «На слух» → фразы (выбор между похожими фразами) и медали достижений — на каждом размере
    try {
      await p.evaluate(() => { setMode('listen'); setLsKind('phrases'); }); await p.waitForTimeout(2500);
      const lp = await p.evaluate(() => ({ answer: ls.answer, a: document.querySelector('#lsA b').textContent, b: document.querySelector('#lsB b').textContent,
        src: (document.getElementById('nativeAudio').src || '').split('/').slice(-2).join('/'),
        cut: [...document.querySelectorAll('#listenCard .ls-opt')].some(o => o.scrollHeight > o.clientHeight + 1) }));
      (info.listenPhrases = info.listenPhrases || {})[name] = lp;
      await p.screenshot({ path:`${OUT}/${name}-listen-phrases.png` });
      await p.evaluate(() => { setLsKind('words'); setMode('progress'); document.getElementById('badgeGrid').scrollIntoView(); }); await p.waitForTimeout(400);
      await p.screenshot({ path:`${OUT}/${name}-badges.png` });
    } catch(e){ info.listenPhrasesError = String(e); }
    // на одном размере — проверить на живом сайте окна «Видео», «Перевод» и набор «живые фразы» (настоящая сеть)
    if(w === 390){
      const live = {};
      try {
        await p.click('#tab-phrases'); await p.waitForTimeout(800);
        await p.click('#yg'); await p.waitForSelector('#exList li, #exMsg', { timeout:20000 }).catch(() => {});
        await p.waitForFunction(() => !/Ищу/.test((document.getElementById('exMsg') || {}).textContent || ''), null, { timeout:20000 }).catch(() => {});
        live.examples = await p.evaluate(() => ({ word: item && item.target, msg: document.getElementById('exMsg').textContent, n: document.querySelectorAll('#exList li').length, audio: document.querySelectorAll('#exList .ex-play[data-i]').length }));
        await p.screenshot({ path:`${OUT}/${name}-examples-sheet.png` });
        await p.click('#exVideo'); await p.waitForSelector('#sheet:not([hidden]) iframe', { timeout:20000 }).catch(() => {});
        await p.waitForTimeout(6000);
        live.video = await p.evaluate(() => ({ word: item && item.target, msg: (document.getElementById('ygMsg') || {}).textContent, iframes: document.querySelectorAll('#sheet iframe').length }));
        await p.screenshot({ path:`${OUT}/${name}-video-sheet.png` });
        await p.click('#sheetClose');
        await p.evaluate(() => openTranslate('Hesabı alabilir miyim?'));
        await p.waitForFunction(() => document.getElementById('trOut') && document.getElementById('trOut').textContent !== 'Перевожу…', null, { timeout:15000 }).catch(() => {});
        live.translate = await p.evaluate(() => document.getElementById('trOut').textContent);
        await p.screenshot({ path:`${OUT}/${name}-translate-sheet.png` });
        await p.click('#sheetClose');
        await p.click('.chip[data-s="tatoeba"]');
        await p.waitForFunction(() => typeof tatoebaSet !== 'undefined' && tatoebaSet && tatoebaSet.length, null, { timeout:20000 }).catch(() => {});
        await p.waitForTimeout(2500);
        live.phrases = await p.evaluate(async () => { const r = { count: tatoebaSet ? tatoebaSet.length : 0, withRu: tatoebaSet ? tatoebaSet.filter(x => x.ru).length : 0, word: item && item.target, meaning: document.getElementById('meaning').textContent };
          const recs = item && nativeCache.get(clean(item.target)); r.audio = recs && recs[0] && recs[0].url;
          if(r.audio){ const a = new Audio(r.audio); r.audioOk = await new Promise(z => { a.oncanplaythrough = () => z(true); a.onerror = () => z('error ' + (a.error && a.error.code) + ' ' + (a.error && a.error.message)); setTimeout(() => z('timeout'), 10000); a.load(); });
            try { const f = await fetch(r.audio); const b = await f.blob(); r.fetchAudio = [f.status, f.headers.get('content-type'), b.size, b.size < 400 ? await b.text() : ''];
              const a2 = new Audio(URL.createObjectURL(b)); r.blobOk = await new Promise(z => { a2.oncanplaythrough = () => z(true); a2.onerror = () => z('error ' + (a2.error && a2.error.code)); setTimeout(() => z('timeout'), 10000); a2.load(); });
            } catch(e){ r.fetchAudio = String(e); }
            const cr = (await findRecordings('merhaba')) || []; r.commonsUrl = cr[0] && cr[0].url; const c = new Audio(r.commonsUrl); r.commonsOk = await new Promise(z => { c.oncanplaythrough = () => z(true); c.onerror = () => z('error ' + (c.error && c.error.code)); setTimeout(() => z('timeout'), 10000); c.load(); }); }
          const m = await findRecordings('Merhaba.'); r.merhaba = m && m.map(x => x.who);
          return r; });
        await p.screenshot({ path:`${OUT}/${name}-live-phrases.png` });
        live.pagesOpened = ctx.pages().length;
      } catch(e){ live.error = String(e); }
      // слова по темам: переключатель, тема «ресторан», пополнение из Викисловаря, русские значения
      try {
        await p.evaluate(() => { closeSheet(); setMode('phrases'); });
        await p.click('#kindChip'); await p.click('.chip[data-s="food"]'); await p.waitForTimeout(2500);
        live.words = await p.evaluate(async () => {
          const r = { word: item.target, meaning: document.getElementById('meaning').textContent, pool0: wordPool('food').items.length };
          r.added = await growWords('food', 20); r.pool1 = wordPool('food').items.length; r.sample = wordPool('food').items.slice(-8).map(x => x.tr);
          r.meanings = {}; for(const w of r.sample.slice(0, 5)) r.meanings[w] = await ruMeaning(w);
          r.examples = {}; for(const w of ['çay', 'oda', 'bilet', 'ilaç', 'hesap']){ const e = await tatoebaExamples(w); r.examples[w] = [e.list.length, e.list.filter(x => x.audio).length, e.list.filter(x => x.ru).length]; }
          const recs = await findRecordings(item.target); r.recs = recs && recs.length;
          return r; });
        await p.screenshot({ path:`${OUT}/${name}-words.png` });
      } catch(e){ live.wordsError = String(e); }
      // слово в контексте: у скольких слов есть примеры с переводом (фраза тренажёра и Tatoeba) — проверка, что функция полезна
      try {
        live.ctx = await p.evaluate(async () => {
          const lemmas = Object.keys(PHRASE_DICT), step = Math.max(1, Math.floor(lemmas.length / 40)), sample = lemmas.filter((_, i) => i % step === 0).slice(0, 40);
          const seeds = Object.values(WORD_SEEDS).flat().map(x => x[0]).filter(w => !PHRASE_DICT[w]).filter((_, i) => i % 6 === 0).slice(0, 15);
          const count = async (w, own) => { ctx = { word:w, forms:new Set([nphr(w), ...(PHRASE_DICT[w] ? PHRASE_DICT[w][1].split(' ') : [])]), list: own ? [{ tr:'-', ru:'-', own:true }] : [], i:0, loaded:false, loading:false, fallback:'' };
            const c = ctx; item = { target:'-' }; await ctxLoad(); return c.list.length - (own ? 1 : 0); };
          const a = {}, b = {}; for(const w of sample) a[w] = await count(w, true); for(const w of seeds) b[w] = await count(w, false);
          const stat = o => { const v = Object.values(o); return { words:v.length, withExamples:v.filter(n => n > 0).length, avg:+(v.reduce((x, y) => x + y, 0) / (v.length || 1)).toFixed(1) }; };
          return { dict:stat(a), seeds:stat(b), none:[...Object.entries(a), ...Object.entries(b)].filter(x => !x[1]).map(x => x[0]) }; });
        await p.evaluate(() => { setMode('phrases'); setKind(true); setId = 'hotel'; renderChips(); wordPool('hotel').items.forEach(x => x.seen = x.tr === 'istemek' ? 0 : 1); next(); });
        const t0 = Date.now();                                             // сколько ждать остальные примеры на живом сайте
        await p.waitForFunction(() => ctx && ctx.loaded, null, { timeout:30000 }).catch(() => {});
        const loadMs = Date.now() - t0; await p.click('#ctxMore').catch(() => {}); await p.waitForTimeout(300);
        live.ctxCard = await p.evaluate(() => ({ word:item.target, text:document.getElementById('partner').textContent, n:ctx && ctx.list.length, loaded:!!(ctx && ctx.loaded) }));
        live.ctxCard.loadMs = loadMs;
        await p.screenshot({ path:`${OUT}/${name}-word-context.png` });
        await p.evaluate(() => setKind(false));
      } catch(e){ live.ctxError = String(e); }
      // что слышит пользователь на «Носителе» для фраз (жалоба: «нет носителя с такой фразой и других фраз»)
      try {
        live.nativePhrases = await p.evaluate(async () => {
          const out = {};
          for(const ph of ['Teşekkürler, her şey çok güzeldi.', 'Hesabı alabilir miyim?', 'Hesap lütfen.', 'Merhaba.', 'Tuvalet nerede?']){
            item = { target: ph, gid:'ph-basic', meaning:'' }; nativeCache.delete(clean(ph)); await findRecordings(ph);
            window.__srcs = []; const a = document.getElementById('nativeAudio'); const orig = a.play.bind(a); a.play = function(){ window.__srcs.push(this.src.split('/').pop().slice(0, 40)); return Promise.resolve(); };
            playNative(); await new Promise(z => setTimeout(z, 8000)); a.play = orig;
            out[ph] = { status: document.getElementById('nativeStatus').textContent, played: window.__srcs };
          }
          return out; });
      } catch(e){ live.nativePhrasesError = String(e); }
      // все фразы тем (подобраны «оттуда, где есть озвучка»): у каждой запись находится и загружается на живом сайте
      try {
        live.voicedSets = await p.evaluate(async () => {
          await cvReady; const bad = []; let ok = 0;
          const loads = url => new Promise(res => { const a = new Audio(); const t = setTimeout(() => res('timeout'), 15000);
            a.oncanplaythrough = () => { clearTimeout(t); res('ok'); }; a.onerror = () => { clearTimeout(t); res('error'); }; a.preload = 'auto'; a.src = url; });
          for(const g of PHRASE_SETS) for(const ph of g.items){
            nativeCache.delete(clean(ph.tr)); const recs = await findRecordings(ph.tr);
            const st = recs && recs.length ? await loads(recs[0].url) : 'нет записи';
            if(st === 'ok') ok++; else bad.push(`${g.id}: ${ph.tr} — ${st}`);
          }
          return { ok, bad }; });
      } catch(e){ live.voicedSetsError = String(e); }
      // фразы с записью носителя по темам: Tatoeba (с лицензией, до 8 слов) и Lingua Libre (Commons, с пробелом в названии)
      try {
        live.topicPhrases = await p.evaluate(async () => {
          const KW = { hotel:['otel','oda','anahtar','rezervasyon','kahvaltı','havlu'], food:['yemek','hesap','çay','kahve','su','ekmek','restoran','menü'],
            transport:['otobüs','tren','bilet','taksi','istasyon','uçak','yol'], shop:['fiyat','para','ucuz','pahalı','kaç','satın'],
            health:['ilaç','doktor','hasta','ağrı','hastane','eczane'], greet:['merhaba','günaydın','teşekkür','lütfen','nasılsın','görüşürüz'] };
          const res = {};
          for(const [t, kws] of Object.entries(KW)){ const seen = new Set(); let n = 0, ru = 0;
            for(const k of kws){ const d = await fetch(`${TATOEBA}/unstable/sentences?lang=tur&has_audio=yes&include=audios&showtrans:lang=rus&sort=relevance&limit=50&q=${encodeURIComponent(k)}`).then(r => r.json()).catch(() => ({}));
              (d.data || []).forEach(x => { if(seen.has(x.id) || !(x.audios || []).some(a => a.license) || x.text.split(' ').length > 8) return; seen.add(x.id); n++; if(ruFrom(x)) ru++; }); }
            res[t] = { licensedAudio: n, withRu: ru }; }
          // Lingua Libre: турецкие записи с пробелом в названии (фразы, а не слова)
          let phrasesLL = 0, total = 0, cont = '', pages = 0, sample = [];
          do { const r = await fetch(`${API}&generator=categorymembers&gcmtype=file&gcmlimit=500&gcmtitle=${encodeURIComponent('Category:Lingua Libre pronunciation-tur')}${cont}`).then(x => x.json());
            Object.values(r.query && r.query.pages || {}).forEach(pg => { total++; const w = wordFromTitle(pg.title); if(w && /\s/.test(w.word.trim())){ phrasesLL++; if(sample.length < 15) sample.push(w.word); } });
            cont = r.continue ? '&' + new URLSearchParams(r.continue).toString() : ''; } while(cont && ++pages < 30);
          res.linguaLibre = { total, phrases: phrasesLL, sample };
          return res; });
      } catch(e){ live.topicPhrasesError = String(e); }
      // покрытие записями носителей: слова фраз (Commons) и фразы Tatoeba с лицензией — без лимитов, в отличие от YouGlish
      try {
        live.coverage = await p.evaluate(async () => {
          const words = [...new Set(PHRASE_SETS.flatMap(g => g.items.flatMap(i => normPhrase(i.tr).split(' '))).filter(Boolean))];
          const has = {}; let i = 0;
          await Promise.all(Array.from({ length:4 }, async () => { while(i < words.length){ const w = words[i++]; const r = await findRecordings(w); has[w] = r ? r.length : -1; } }));
          const phrases = PHRASE_SETS.flatMap(g => g.items.map(x => x.tr));
          const full = phrases.filter(ph => normPhrase(ph).split(' ').every(w => has[w] > 0)).length;
          const part = phrases.map(ph => { const ws = normPhrase(ph).split(' '); return ws.filter(w => has[w] > 0).length / ws.length; });
          // Tatoeba: сколько турецких фраз с записью, из них с лицензией
          let total = 0, lic = 0, after = '', pages = 0;
          do { const u = `${TATOEBA}/unstable/sentences?lang=tur&has_audio=yes&include=audios&sort=created&limit=100${after}`;
            const d = await fetch(u).then(r => r.json()); (d.data || []).forEach(x => { total++; if((x.audios || []).some(a => a.license)) lic++; });
            after = d.paging && d.paging.has_next && d.paging.next ? '&after=' + new URL(d.paging.next).searchParams.get('after') : ''; } while(after && ++pages < 20);
          return { words: words.length, wordsWithAudio: Object.values(has).filter(v => v > 0).length, netErrors: Object.values(has).filter(v => v < 0).length,
            phrases: phrases.length, phrasesAllWords: full, avgWordShare: Math.round(part.reduce((a, b) => a + b, 0) / part.length * 100),
            tatoebaTotal: total, tatoebaLicensed: lic, missingSample: Object.keys(has).filter(w => has[w] === 0).slice(0, 40) };
        });
      } catch(e){ live.coverageError = String(e); }
      info.live = live;
    }
    log.push({ size:name, ...info, errors: errs });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/info.json`, JSON.stringify({ url: URL, taken: new Date().toISOString(), shots: log }, null, 2));
  console.log(JSON.stringify(log, null, 2));
})();
