// Снимки ЖИВОГО сайта (как видит пользователь): запускается в CI после публикации и проверки verify.
// Результат уходит в ветку `screens` — оттуда его можно посмотреть, не имея доступа к github.io.
const { chromium } = require('playwright');
const fs = require('fs');
const URL = process.argv[2], OUT = process.argv[3];
(async () => {
  fs.mkdirSync(OUT, { recursive:true });
  const b = await chromium.launch();
  const log = [];
  for(const [w, h, name] of [[360, 640, 'android-360x640'], [390, 844, 'iphone-390x844'], [412, 915, 'android-412x915']]){
    const ctx = await b.newContext({ viewport:{ width:w, height:h }, deviceScaleFactor:2, isMobile:true, hasTouch:true, locale:'ru-RU' });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(URL, { waitUntil:'load' }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500);
    const info = await p.evaluate(() => ({ version: (document.getElementById('appVersion') || {}).textContent,
      fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight) }));
    for(const tab of ['pairs', 'phrases', 'listen', 'free', 'progress']){
      await p.click('#tab-' + tab); await p.waitForTimeout(1200);
      if(await p.isVisible('#modal')) await p.keyboard.press('Escape');
      await p.screenshot({ path:`${OUT}/${name}-${tab}.png` });
    }
    // на одном размере — проверить на живом сайте окна «Видео», «Перевод» и набор «живые фразы» (настоящая сеть)
    if(w === 390){
      const live = {};
      try {
        await p.click('#tab-phrases'); await p.waitForTimeout(800);
        await p.click('#yg'); await p.waitForSelector('#sheet:not([hidden]) iframe', { timeout:20000 }).catch(() => {});
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
          if(r.audio){ const a = new Audio(r.audio); r.audioOk = await new Promise(z => { a.oncanplaythrough = () => z(true); a.onerror = () => z(false); setTimeout(() => z('timeout'), 10000); a.load(); }); }
          const m = await findRecordings('Merhaba.'); r.merhaba = m && m.map(x => x.who);
          return r; });
        await p.screenshot({ path:`${OUT}/${name}-live-phrases.png` });
        live.pagesOpened = ctx.pages().length;
      } catch(e){ live.error = String(e); }
      info.live = live;
    }
    log.push({ size:name, ...info, errors: errs });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/info.json`, JSON.stringify({ url: URL, taken: new Date().toISOString(), shots: log }, null, 2));
  console.log(JSON.stringify(log, null, 2));
})();
