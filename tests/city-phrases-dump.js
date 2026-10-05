// Выгрузить все турецкие реплики города (реплики игрока say[0], реплики собеседников npc/again, светские SMALLTALK, итоги) в tests/city-phrases.json —
// список для поиска записей носителей в Common Voice (tests/cv-extract.py читает его вместе с фразами тренажёра).
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + path.join(__dirname, '..', 'index.html')); await p.waitForTimeout(500);
  const out = await p.evaluate(() => { const set = new Set(), add = t => { if(typeof t === 'string' && t.trim()) set.add(t.trim()); else if(Array.isArray(t)) t.forEach(add); };
    const node = n => { if(!n || typeof n !== 'object') return; add(n.npc); add(n.again); add(n.greetAlt); Object.values(n.npcBy || {}).forEach(add); Object.values(n.againBy || {}).forEach(add);
      (n.moves || []).forEach(m => add(m.say)); (n.extra || []).forEach(m => m && add(m.say)); (n.variants || []).forEach(v => { node(v); }); (n.alt || []).forEach(v => node(v)); if(n.pay){ add(n.pay.short); } };
    Object.values(SCENES).forEach(sc => Object.values(sc.nodes || {}).forEach(node));
    (typeof SMALLTALK !== 'undefined' ? SMALLTALK : []).forEach(t => add(t.tr));
    return [...set]; });
  const only = out.filter(t => /[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(t)).sort();
  fs.writeFileSync(path.join(__dirname, 'city-phrases.json'), JSON.stringify(only, null, 0)); console.log(only.length, 'реплик'); await b.close(); })();
