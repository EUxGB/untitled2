// Собирает PNG-иконки из icon-source.svg: node tests/make-icons.js
// icon-192/512 — скруглённые, прозрачные углы; icon-maskable-512 — фон до края, рисунок уменьшен до безопасной зоны;
// icon-apple-180 — непрозрачный квадрат (iPhone закрашивает прозрачное чёрным и скругляет сам).
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'icon-source.svg'), 'utf8');
const inner = src.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<!--[\s\S]*?-->/g, '');
const art = inner.replace(/<rect[^>]*\/>/, '');            // кольцо и фишка без фона
const svg = (size, { rounded, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 192 192">` +
  `<rect width="192" height="192" ${rounded ? 'rx="42"' : ''} fill="#0F5C5A"/>` +
  `<g transform="translate(96 96) scale(${scale}) translate(-96 -96)">${art}</g></svg>`;
const OUT = [
  ['icon-192.png', 192, { rounded:true, scale:1 }],
  ['icon-512.png', 512, { rounded:true, scale:1 }],
  ['icon-maskable-512.png', 512, { rounded:false, scale:0.86 }],   // крайняя точка рисунка 0,72 радиуса × 0,86 = 0,62 < 0,8 (безопасная зона)
  ['icon-apple-180.png', 180, { rounded:false, scale:1 }],
];
(async () => {
  const b = await chromium.launch();
  for(const [file, size, opt] of OUT){
    const pg = await b.newPage({ viewport:{ width:size, height:size } });
    await pg.setContent(`<html><body style="margin:0;background:transparent">${svg(size, opt)}</body></html>`);
    await pg.locator('svg').screenshot({ path:path.join(root, file), omitBackground:true });
    await pg.close(); console.log(file, size);
  }
  await b.close();
})();
