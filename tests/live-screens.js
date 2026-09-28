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
    log.push({ size:name, ...info, errors: errs });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(`${OUT}/info.json`, JSON.stringify({ url: URL, taken: new Date().toISOString(), shots: log }, null, 2));
  console.log(JSON.stringify(log, null, 2));
})();
