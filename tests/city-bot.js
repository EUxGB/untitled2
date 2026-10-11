// Бот-замер экономики квартала (план этапа 1, шаг 4): N игровых дней тремя стратегиями — говорит верно (speak),
// всё через «Показать» (phone), между делами всегда на такси (taxi). Печатает деньги и опыт по дням и расход за неделю.
// Запуск: DAYS=14 node tests/city-bot.js   (без сети; страница — file://, как в тестах)
// Упрощения (честно): поле не проходится кубиком — бот сразу начинает дело дня; карты колоды не тянутся; у такси списывается
// цена поездки по формуле игры (100 + 10 × расстояние), без самой сцены такси.
const { chromium, openPage } = require('./harness');
const DAYS = +process.env.DAYS || 14;   // argv[2] занят каркасом (путь к index.html)

async function playScene(q, id, policy){
  await q.evaluate(([id]) => { cityLeave(); ct = null; if(!document.getElementById('modal').hidden) closeModal(); window.__silent = false; cityStart(id); }, [id]);
  for(let i = 0; i < 60; i++){
    const st = await q.evaluate(() => ({ ended:!ct, modal:!document.getElementById('modal').hidden, resolved:!!(ct && ct.resolved), pay:!!(ct && ct.node && ct.node.pay), code:!!(ct && ct.node && ct.node.code),
      veil:!!document.querySelector('#ctTr.veil'), notes:[...document.querySelectorAll('#ctPay .ct-note:not([disabled])')].map(b => +b.dataset.v), price:ct && ct.node && ct.node.pay ? ct.node.pay.price : 0 }));
    if(st.modal){ await q.click('#modalPrimary'); await q.waitForTimeout(30); if(await q.evaluate(() => !ct)) break; continue; }
    if(st.ended) break;
    if(st.veil){ await q.waitForTimeout(50); continue; }
    if(st.resolved){ await q.click('#ctNext'); await q.waitForTimeout(30); continue; }
    if(st.pay){ const ok = st.notes.filter(n => n >= st.price); await q.evaluate(v => cityPay(v), ok.length ? Math.min(...ok) : Math.max(...st.notes, 0)); await q.waitForTimeout(30); continue; }
    if(st.code){ await q.evaluate(() => cityCode(ct.node.code.value)); await q.waitForTimeout(30); continue; }
    if(policy === 'phone'){ await q.evaluate(() => { const b = document.querySelector('#ctOpts .ct-opt-main'); b && b.click(); cityPhone(); }); await q.waitForTimeout(30); continue; }
    await q.evaluate(() => { const b = document.querySelector('#ctOpts .ct-opt-main'); b && b.click(); const m = ct.pick || ctMoves(ct.node)[0]; window.__say = m ? m.say[0] : ''; });
    await q.click('#ctSpeak'); await q.waitForTimeout(120);
  }
  for(let k = 0; k < 4; k++){ await q.waitForTimeout(150); if(await q.evaluate(() => !document.getElementById('modal').hidden)) await q.click('#modalPrimary'); else break; }
}

async function run(browser, policy, seed = 0){
  const q = await openPage(browser); await q.setViewportSize({ width:390, height:844 }); await q.click('#tab-city'); await q.waitForTimeout(100);
  await q.evaluate(() => { trVoices = []; });
  const rows = [];
  for(let d = 1; d <= DAYS; d++){
    await q.evaluate(d => { window.__seed = d; }, d);
    // в тестовом режиме план дня не случаен (берётся первое из пула) — бот выбирает 3 дела сам, по правилу игры: из открытых, не вчерашние
    const plan = await q.evaluate(([d, seed]) => { let x = d * 7919 + seed * 104729; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const pool = WEEK_SETS[0].filter(id => SCENES[id] && !SCENES[id].event && !(city.prevPlan || []).includes(id)), plan = d === 1 ? ['bakkal'] : [];
      while(plan.length < PLAN_SIZE && pool.length){ const k = Math.floor(rnd() * pool.length); const id = pool.splice(k, 1)[0]; if(!plan.includes(id)) plan.push(id); }
      city.plan = plan.slice(); return plan; }, [d, seed]);
    const m0 = await q.evaluate(() => [city.money, game.xp]);
    for(const id of plan){
      if(policy === 'taxi') await q.evaluate(id => { const c = BOARD.findIndex(b => (b.scenes || []).includes(id)); if(c >= 0){ city.money -= 100 + 10 * boardDist(city.pos, c); city.pos = c; } }, id);
      await playScene(q, id, policy);
    }
    const r = await q.evaluate(() => ({ day:city.day, dow:cityDow(), money:city.money, debt:city.debt, xp:game.xp, done:city.done.map(x => x.id + ':' + x.kind) }));
    rows.push(Object.assign(r, { spentToday:m0[0] - r.money, xpToday:r.xp - m0[1] }));
    await q.evaluate(() => { cityLeave(); ct = null; if(!document.getElementById('modal').hidden) closeModal(); cityNewDay(); if(!document.getElementById('modal').hidden) closeModal(); });
    await q.waitForTimeout(40);
  }
  const errs = q.errors.splice(0); await q.context().close();
  return { policy, rows, errs };
}

(async () => {
  const browser = await chromium.launch();
  const runs = [['speak', 1], ['speak', 2], ['speak', 3], ['phone', 1], ['taxi', 1]];
  const weekly = [];
  for(const [policy, seed] of runs){
    const r = await run(browser, policy, seed); if(policy === 'speak') weekly.push(...[0, 7].filter(o => r.rows.length >= o + 7).map(o => r.rows.slice(o, o + 7).reduce((a, x) => a + x.spentToday, 0) - (o ? 0 : 0)));
    console.log(`\n== ${policy}, набор дел ${seed} ==`);
    r.rows.forEach(x => console.log(`день ${String(x.day).padStart(2)} (${['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][x.dow]})  деньги ${String(x.money).padStart(5)}  долг ${x.debt}  потрачено ${String(x.spentToday).padStart(5)}  опыт +${x.xpToday}  ${x.done.join(' ')}`));
    for(let w = 0; w * 7 < r.rows.length; w++){ const wk = r.rows.slice(w * 7, w * 7 + 7); console.log(`неделя ${w + 1}: потрачено ${wk.reduce((a, x) => a + x.spentToday, 0)} ₺ (без зарплаты и аренды), к воскресенью ${wk[wk.length - 1].money} ₺`); }
    if(r.errs.length) console.log('ошибки JS:', r.errs.slice(0, 3));
  }
  if(weekly.length) console.log(`\nговорит верно: расход за неделю ${weekly.join(', ')} ₺, в среднем ${Math.round(weekly.reduce((a, b) => a + b, 0) / weekly.length)} ₺ (без зарплаты)`);
  await browser.close();
})();
