// Генератор проверок сцен «Города» (спек §14 п. 1–4): граф, содержимое, бот трёх путей, помещается на трёх размерах.
// Запуск: node tests/city.test.js [путь к index.html]. Каждая новая сцена и карта события проверяется автоматически.
const { chromium, test, eq, ok, openPage, summary } = require('./harness');

// Формы узла: без alt — сам узел; с alt — каждый вариант, слитый поверх узла (спек §6а). Форма с pass — «сквозная»: узел пропускается.
function nodeForms(n){ return n.alt && n.alt.length ? n.alt.map(a => Object.assign({}, n, a, { alt:undefined })) : [n]; }
// Чистая проверка графа сцены — выполняется в странице (сцены определены там), поэтому передаётся текстом.
function cityGraphCheck(sc, nodeForms){
  const errs = [], nodes = sc.nodes || {}, ids = Object.keys(nodes);
  if(!sc.start || !nodes[sc.start]) errs.push('нет узла start');
  const text = v => typeof v === 'string' ? !!v : Array.isArray(v) && v.length > 0 && v.every(s => typeof s === 'string' && s);
  if(!sc.fail || !text(sc.fail.text)) errs.push('нет fail.text');
  const formEdges = n => { const out = [], add = g => { if(g) out.push(g); };
    [...(n.moves || []), ...(n.extra || [])].forEach(m => add(m.go)); if(n.pay) add(n.pay.go); if(n.code) add(n.code.go); if(n.haggle) add(n.haggle.go); if(n.go) add(n.go); if(n.pass) add(n.pass);
    (n.variants || []).forEach(v => { add(v.go); (v.moves || []).forEach(m => add(m.go)); if(v.pay) add(v.pay.go); });
    return out; };
  const edges = id => nodeForms(nodes[id] || {}).flatMap(formEdges);
  ids.forEach(id => { const base = nodes[id];
    edges(id).forEach(g => { if(!nodes[g]) errs.push(`${id}: go → «${g}» не существует`); });
    if(base.end){ if(!['ok','near','bad'].includes(base.end.kind)) errs.push(`${id}: end.kind «${base.end.kind}»`); if(!text(base.end.text)) errs.push(`${id}: end без текста`); return; }
    if(base.alt && base.alt.length < 2) errs.push(`${id}: alt из одного варианта`);
    nodeForms(base).forEach((n, k) => { const tag = base.alt ? `${id}[${k}]` : id;
      if(n.pass){ if(Object.keys(n).some(x => x === 'moves' && n.moves !== base.moves)) errs.push(`${tag}: сквозной вариант с ходами`); return; }
      // реплика — строка или список строк-вариантов (в каждой сцене один из них, pickLine); список не пустой и без пустых строк
      if(!text(n.npc)) errs.push(`${tag}: нет npc`); if(!text(n.ru)) errs.push(`${tag}: нет ru`);
      if(Array.isArray(n.npc) && n.npc.length > 1 && new Set(n.npc).size !== n.npc.length) errs.push(`${tag}: варианты npc повторяются`);
      if(Array.isArray(n.ru) && (!Array.isArray(n.npc) || n.ru.length !== n.npc.length)) errs.push(`${tag}: ru — список другой длины, чем npc`);
      if(Array.isArray(n.againRu) && (!Array.isArray(n.again) || n.againRu.length !== n.again.length)) errs.push(`${tag}: againRu — список другой длины, чем again`);
      if(n.pay){ if(!n.pay.short || !n.pay.shortRu) errs.push(`${tag}: pay без short/shortRu`); }
      else if(!text(n.again) || !n.againRu) errs.push(`${tag}: нет again/againRu`);
      const vis = (n.moves || []).filter(m => !m.hide), visible = vis.length;
      if(!visible && !n.pay && !n.code && !n.haggle && !n.shop) errs.push(`${tag}: нет видимых ходов`);
      if(visible && vis.every(m => m.fx && m.fx.money < 0)) errs.push(`${tag}: все ходы платные — без денег не выйти`);   // ход дороже наличных не показывается (ctMoves)
      if(n.variants && base.alt) errs.push(`${tag}: variants вместе с alt — variants из alt не применяются (ctNodeFor)`);
      if(n.code && (!Array.isArray(n.code.options) || new Set(n.code.options).size !== 4 || !n.code.options.includes(n.code.value))) errs.push(`${tag}: code.options — 4 разных, среди них value`);
      if(n.haggle && !(n.haggle.floor < n.haggle.ask)) errs.push(`${tag}: haggle floor < ask`); }); });
  // сквозные варианты не зацикливаются (pass → pass → …): иначе cityNode уходит в бесконечную рекурсию
  const passEdges = id => nodeForms(nodes[id] || {}).map(n => n.pass).filter(Boolean);
  ids.forEach(id => { const seen = new Set([id]); let st = passEdges(id); while(st.length){ const x = st.pop(); if(x === id){ errs.push(`${id}: цикл по pass`); break; } if(!seen.has(x) && nodes[x]){ seen.add(x); st.push(...passEdges(x)); } } });
  // достижимость: все узлы из start; из каждого узла — хоть одна концовка
  const reach = (from) => { const seen = new Set([from]), st = [from]; while(st.length){ const x = st.pop(); edges(x).forEach(g => { if(nodes[g] && !seen.has(g)){ seen.add(g); st.push(g); } }); } return seen; };
  const fromStart = reach(sc.start);
  ids.filter(id => !fromStart.has(id)).forEach(id => errs.push(`${id}: недостижим из start`));
  const endsFrom = id => [...reach(id)].filter(x => nodes[x].end).map(x => x);
  ids.forEach(id => { if(!nodes[id].end && !endsFrom(id).length) errs.push(`${id}: из узла не достижима концовка`); });
  // концовки: ≥ 3 видов (fail сцены — «bad»); развилка по смыслу: два видимых хода одной формы узла ведут к разным концовкам
  const kinds = new Set([...fromStart].filter(x => nodes[x].end).map(x => nodes[x].end.kind).concat(sc.fail ? ['bad'] : []));
  if(kinds.size < 3) errs.push(`концовок видов ${kinds.size} (${[...kinds].join(',')}), нужно 3`);
  const fork = ids.some(id => { const base = nodes[id]; if(base.end) return false;
    return nodeForms(base).some(n => { const sets = [...(n.moves || []), ...(n.extra || [])].filter(m => !m.hide && m.go).map(m => endsFrom(m.go).sort().join('|'));
      return new Set(sets).size >= 2; }); });
  if(!fork) errs.push('нет развилки по смыслу (два видимых хода → разные концовки)');
  return errs;
}

const SIZES = [[360, 640], [390, 844], [412, 915]];
(async () => {
  const browser = await chromium.launch();
  const open = async (w = 360, h = 640) => { const q = await openPage(browser); await q.setViewportSize({ width:w, height:h }); await q.evaluate(() => { trVoices = []; trVoice = null; }); await q.click('#tab-city'); await q.waitForTimeout(80); return q; };

  console.log('Сцены «Города»: граф и содержимое');
  await test('граф каждой сцены (все формы узлов с alt): старт есть, все go ведут в узлы, у не-конечных again/ru, из каждого узла достижим end, концовок ≥ 3 видов, развилка по смыслу', async () => {
    const q = await open();
    const r = await q.evaluate(([src, forms]) => { const f = eval('(' + src + ')'), nf = eval('(' + forms + ')'); return Object.keys(SCENES).map(id => [id, f(SCENES[id], nf)]); }, [cityGraphCheck.toString(), nodeForms.toString()]);
    await q.context().close(); eq(r.filter(([, e]) => e.length), []);
  });
  await test('содержимое (все формы узлов): say[0] — одно предложение с конечным знаком, цены кратны 5, купюрами можно заплатить, нет эмодзи, каждое слово say покрыто wordGloss, персонаж есть в CHARS', async () => {
    const q = await open();
    const r = await q.evaluate(forms => { const bad = [], nf = eval('(' + forms + ')'); const pic = /\p{Extended_Pictographic}/u;
      Object.entries(SCENES).forEach(([id, sc]) => {
        if(typeof CHARS !== 'undefined'){ if(sc.char && !CHARS[sc.char]) bad.push(`${id}: char ${sc.char}`); (sc.pool || []).forEach(c => { if(!CHARS[c]) bad.push(`${id}: pool ${c}`); }); }
        const strings = []; JSON.stringify(sc, (k, v) => { if(typeof v === 'string') strings.push(v); return v; });
        strings.forEach(s => { if(pic.test(s)) bad.push(`${id}: эмодзи в «${s}»`); });
        Object.entries(sc.nodes).forEach(([nid, base]) => nf(base).forEach(n => {
          if(n.pay){ if(n.pay.price % 5) bad.push(`${id}.${nid}: цена ${n.pay.price}`); if(!n.pay.notes.some(v => v >= n.pay.price)) bad.push(`${id}.${nid}: купюрами не заплатить`); }
          const moves = [...(n.moves || []), ...(n.extra || []), ...(n.variants || []).flatMap(v => v.moves || []), ...(n.shop ? Object.keys(n.items).map(it => ({ say:[SHOP_LINES[it] ? SHOP_LINES[it][0] : ''] })) : []), ...(n.done ? [{ say:n.done.say }] : [])];
          moves.forEach(m => (m.say || []).forEach((line, i) => {
            if(i === 0 && !/^[A-ZÇĞİÖŞÜ0-9].*[.!?]$/.test(line)) bad.push(`${id}.${nid}: say «${line}»`);
            line.split(/\s+/).forEach(w => { const core = w.replace(/^[^\p{L}]+|[^\p{L}']+$/gu, '').replace(/['’].*$/u, ''); if(!nphr(core)) return; if(!wordGloss(core)) bad.push(`${id}.${nid}: нет глоссы «${core}»`); }); })); })); });
      return [...new Set(bad)]; }, nodeForms.toString());
    await q.context().close(); eq(r, []);
  });

  console.log('Сцены «Города»: бот проходит каждую сцену');
  // policy: happy — первый видимый ход сказан верно; last — последний видимый ход (другие ветки, крупная купюра); fail — тишина до конца терпения; phone — «Показать» в каждом узле
  async function playScene(q, id, policy, seed = 0){
    await q.evaluate(([id, seed]) => { cityLeave(); ct = null; if(!document.getElementById('modal').hidden) closeModal(); city = Object.assign({}, CITY_START, { money:3000 }); cityNormalize(); window.__silent = false; window.__seed = seed; cityStart(id); }, [id, seed]);
    const t0 = await q.evaluate(() => [city.money, city.min]);
    for(let i = 0; i < 60; i++){
      const st = await q.evaluate(() => ({ ended: !ct, modal: !document.getElementById('modal').hidden, resolved: !!(ct && ct.resolved), pay: !!(ct && ct.node && ct.node.pay), code: !!(ct && ct.node && ct.node.code),
        veil: !!document.querySelector('#ctTr.veil'), notes: [...document.querySelectorAll('#ctPay .ct-note:not([disabled])')].map(b => +b.dataset.v), price: ct && ct.node && ct.node.pay ? ct.node.pay.price : 0 }));
      if(st.modal){ await q.click('#modalPrimary'); await q.waitForTimeout(40); if(await q.evaluate(() => !ct)) break; continue; }
      if(st.ended) break;
      if(st.veil){ await q.waitForTimeout(60); continue; }
      if(st.resolved){ await q.click('#ctNext'); await q.waitForTimeout(40); continue; }
      if(st.pay){ const v = policy === 'fail' ? Math.min(...st.notes) : policy === 'last' ? Math.max(...st.notes) : Math.min(...st.notes.filter(n => n >= st.price)); await q.evaluate(v => cityPay(v), v); await q.waitForTimeout(40); continue; }
      if(st.code){ await q.evaluate(p => cityCode(p === 'fail' ? '__wrong__' : ct.node.code.value), policy); await q.waitForTimeout(40); continue; }
      if(policy === 'phone'){ await q.evaluate(() => { const b = document.querySelector('#ctOpts .ct-opt-main'); b && b.click(); cityPhone(); }); await q.waitForTimeout(40); continue; }
      await q.evaluate(p => { const all = document.querySelectorAll('#ctOpts .ct-opt-main'), b = p === 'last' ? all[all.length - 1] : all[0]; b && b.click(); const m = ct.pick || ctMoves(ct.node)[0]; window.__silent = p === 'fail'; window.__say = p === 'fail' ? '' : m.say[0]; }, policy);   // last — последний видимый ход (вторые ветки: «завтра приду», две штуки, самая крупная купюра)
      await q.click('#ctSpeak'); await q.waitForTimeout(140);
    }
    for(let k = 0; k < 4; k++){ await q.waitForTimeout(220); if(await q.evaluate(() => !document.getElementById('modal').hidden)) await q.click('#modalPrimary'); else break; }   // очередь окон после итога (новый контакт, уровни) — закрыть, иначе она перекроет следующую сцену
    const r = await q.evaluate(t0 => ({ ended: !ct && document.getElementById('modal').hidden, done: city.done.map(d => d.kind), money: t0[0] - city.money, min: city.min - t0[1] }), t0);
    r.errors = q.errors.splice(0); return r;
  }
  await test('бот проходит каждую сцену четырьмя путями (первый ход / последний ход / тишина / телефон), первый и последний — с каждым номером варианта (seed 0…максимум alt): сцена завершается, нет ошибок JS, деньги и время в пределах', async () => {
    const q = await open(); const bad = [];
    const ids = (await q.evaluate(() => Object.keys(SCENES))).filter(id => !process.env.SCENE_ONLY || id.startsWith(process.env.SCENE_ONLY));   // SCENE_ONLY=dm_ — прогнать часть сцен
    for(const id of ids){
      const sc = await q.evaluate(id => ({ phone: !!SCENES[id].phone, event: !!SCENES[id].event, alts: Math.max(1, ...Object.values(SCENES[id].nodes).map(n => (n.alt || []).length)) }), id);
      const runs = [['happy', 0], ['fail', 0], ['phone', 0], ['last', 0]]; for(let s = 1; s < sc.alts; s++) runs.push(['happy', s], ['last', s]);
      for(const [policy, seed] of runs){
        if(policy === 'phone' && sc.phone) continue;
        const tag = `${id}/${policy}${seed ? '#' + seed : ''}`; if(process.env.DEBUG_SCENES) console.log('   …', tag);
        const r = await playScene(q, id, policy, seed);
        if(!r.ended) bad.push(`${tag}: не завершилась`);
        if(r.errors.length) bad.push(`${tag}: ${r.errors.join(' ; ')}`);
        if(r.money > 600 || r.min > 180 || r.min < 0) bad.push(`${tag}: деньги −${r.money}, время +${r.min}`);
        if(sc.event) continue;                                                             // событие — не дело дня: в city.done не пишется
        if(policy === 'fail' && r.done[0] !== 'bad') bad.push(`${tag}: итог ${r.done[0]}`);
        if(policy === 'happy' && !r.done.length) bad.push(`${tag}: нет записи в city.done`);
      }
    }
    // озвучка Piper (спек 2026-10-08): всё, что сцены пытались сказать, есть в списке ttsInventory — иначе CI не озвучит это заранее
    const notInv = await q.evaluate(() => { const keys = new Set(ttsInventory().map(ttsKey)); return [...new Set((window.__ttsSeen || []).filter(t => !keys.has(ttsKey(t))))].slice(0, 15); });
    const seenN = await q.evaluate(() => (window.__ttsSeen || []).length);
    await q.evaluate(() => { window.__seed = 0; });
    await q.context().close(); eq(bad, []); ok(process.env.SCENE_ONLY || seenN > 100, 'журнал озвучки пуст: ' + seenN); eq(notInv, [], 'сказано, но нет в списке озвучки');
  });

  console.log('Сцены «Города»: помещаются на 360×640, 390×844, 412×915');
  await test('каждый узел каждой сцены (и каждый его вариант alt) помещается: без прокрутки страницы и карточки, без обрезки реплики, карточек ответов и пояснения', async () => {
    const bad = [];
    for(const [w, h] of SIZES){
      const q = await open(w, h);
      const r = await q.evaluate(() => { const out = [];
        Object.entries(SCENES).forEach(([id, sc]) => { ct = null; city = Object.assign({}, CITY_START, { money:3000 }); cityNormalize(); cityStart(id);
          Object.keys(sc.nodes).forEach(nid => { const base = sc.nodes[nid]; if(base.end) return;
            (base.alt || [null]).forEach((a, k) => { if(a && a.pass) return; window.__alt = a ? { [nid]:k } : undefined; ct.alts = {}; cityNode(nid); const first = document.querySelector('#ctOpts .ct-opt-main'); if(first) first.click(); autofit();
              const card = document.getElementById('cityCard');
              const cut = [...card.querySelectorAll('.result, .ct-tr, .ct-opt-main, .ct-say, .ct-goal')].filter(e => e.offsetParent && e.scrollHeight > e.clientHeight + 1).map(e => e.className);
              const pageOver = document.documentElement.scrollHeight > innerHeight + 1, cardOver = card.scrollHeight - card.clientHeight > 1;
              if(cut.length || pageOver || cardOver) out.push(`${id}.${nid}${a ? '[' + k + ']' : ''}: ${JSON.stringify({ cut, pageOver, cardOver })}`); }); });
          cityLeave(); ct = null; window.__alt = undefined; });
        return out; });
      bad.push(...r.map(x => `${w}×${h} ${x}`)); await q.context().close();
    }
    eq(bad, []);
  });

  await browser.close();
  process.exit(summary());
})();
