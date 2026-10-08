// Выгрузить список всего, что сайт может произнести (ttsInventory в index.html) → tests/tts-texts.json.
// Его читает генератор озвучки tests/tts-build.py (CI озвучивает Piper только недостающее). Спек: docs/superpowers/specs/2026-10-08-piper-tts-design.md
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  await p.addInitScript(() => { window.SOYLE_TEST = true; });
  await p.route(u => /^https?:/.test(u.href), r => r.abort());
  await p.goto('file://' + path.join(__dirname, '..', 'index.html')); await p.waitForTimeout(500);
  const list = await p.evaluate(() => ttsInventory().map(t => ({ key:ttsKey(t), text:t })));
  fs.writeFileSync(path.join(__dirname, 'tts-texts.json'), JSON.stringify(list, null, 0)); console.log(list.length, 'текстов'); await b.close(); })();
