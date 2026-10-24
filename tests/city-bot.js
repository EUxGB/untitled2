// Бот-замер экономики квартала (план этапа 1, шаг 4): N игровых дней тремя стратегиями — говорит верно (speak),
// всё через «Показать» (phone), между делами всегда на такси (taxi). Печатает деньги и опыт по дням и расход за неделю.
// Запуск: DAYS=14 node tests/city-bot.js   (без сети; страница — file://, как в тестах)
// Упрощения (честно): поле не проходится кубиком — бот сразу начинает дело дня; карты колоды не тянутся; у такси списывается
// цена поездки по формуле игры (100 + 10 × расстояние), без самой сцены такси.
// Дом с поломками (2026-10-23): кран ломается редко и в случайный день (с 2026-10-24: со 2-й недели, пауза 14 дней, 15 % в день); бот ставит поломку
// хуком window.__break на вторник недели 2 (день 9), чтобы замер сравнивался с прежним. Во ВСЕХ стратегиях бот в этот день сначала звонит
// мастеру (точно: «Mutfaktaki musluk damlıyor.»; у phone тоже голосом — в звонке «Показать» нет), стоит дома и ждёт (`cityWaitUsta`), платит, потом идёт дела дня.
// Сравнение вариантов во вторник ремонта (раздел «вторник ремонта» в конце вывода): `wait` — позвонил и сразу ждать; `away` — позвонил,
// AWAY_N (2) дела, потом домой (`cityArrive0(0)`: мастер у двери / ушёл; ушёл или пришли раньше — снова звонок и ждать). Время дел — по часам игры
// (`city.min`: сцены сами тратят минуты); поле бот не проходит, поэтому дорога по кольцу пешком добавляется как 10 мин × расстояние
// (`boardDist`, без кубика и событий — НИЖНЯЯ оценка дороги, реально дольше). Очередь дня = дела плана, затем остальные дела недели 1
// (в порядке WEEK_SETS) — «сколько дел помещается до 21:00»; часы работы мест бот не учитывает.
const { chromium, openPage } = require('./harness');
const AWAY_N = +process.env.AWAY_N || 2;   // сколько дел сделать, прежде чем идти домой в варианте away
const DAYS = +process.env.DAYS || 14;   // argv[2] занят каркасом (путь к index.html)

async function playScene(q, id, policy, started){
  if(!started) await q.evaluate(([id]) => { cityLeave(); ct = null; if(!document.getElementById('modal').hidden) closeModal(); window.__silent = false; cityStart(id); }, [id]);
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

// Ремонт: звонок (дома) → ждать мастера → сцена прихода. Возвращает true, если мастер записан.
// Звонок — телефонная сцена: «Показать» в ней нет (phone:true), поэтому и у стратегии phone звонок говорится голосом (иначе кран не починить вовсе).
async function callUsta(q, policy){
  await playScene(q, 'tesisatci', 'speak');
  return q.evaluate(() => !!(city.home.visit && city.home.visit.day === city.day));
}
async function waitUsta(q, policy){
  await q.evaluate(() => { cityLeave(); ct = null; if(!document.getElementById('modal').hidden) closeModal(); window.__silent = false; cityWaitUsta(); });
  if(await q.evaluate(() => !!ct)) await playScene(q, 'tesisatci_gel', policy, true);
}
async function repairWait(q, policy){ if(await callUsta(q, policy)) await waitUsta(q, policy); }

async function run(browser, policy, seed = 0, opts = {}){
  const variant = opts.variant || 'wait', cap = !!opts.capacity, repairLog = [];
  const q = await openPage(browser); await q.setViewportSize({ width:390, height:844 }); await q.click('#tab-city'); await q.waitForTimeout(100);
  await q.evaluate(() => { trVoices = []; });
  const rows = [];
  for(let d = 1; d <= (opts.days || DAYS); d++){
    await q.evaluate(d => { window.__seed = d; }, d);
    // в тестовом режиме план дня не случаен (берётся первое из пула) — бот выбирает 3 дела сам, по правилу игры: из открытых, не вчерашние
    const plan = await q.evaluate(([d, seed]) => { let x = d * 7919 + seed * 104729; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
      const pool = WEEK_SETS[0].filter(id => SCENES[id] && !SCENES[id].event && !(city.prevPlan || []).includes(id)), plan = d === 1 ? ['bakkal'] : [];
      while(plan.length < PLAN_SIZE && pool.length){ const k = Math.floor(rnd() * pool.length); const id = pool.splice(k, 1)[0]; if(!plan.includes(id)) plan.push(id); }
      city.plan = plan.slice(); return plan; }, [d, seed]);
    const m0 = await q.evaluate(() => [city.money, game.xp]);
    const broken = await q.evaluate(() => homeBroken('musluk'));
    let queue = plan.slice(), tCall = null, tPick = null;
    if(broken && cap){ const extra = await q.evaluate(() => WEEK_SETS[0].filter(id => SCENES[id] && !SCENES[id].event && !city.plan.includes(id))); queue = plan.concat(extra); }
    if(broken && cap && variant === 'away' && process.env.AWAY_PICK){   // AWAY_PICK=near|far: первым делом идёт ближайшее / самое дальнее от дома дело очереди
      const dist = await q.evaluate(ids => ids.map(id => { const c = BOARD.findIndex(b => (b.scenes || []).includes(id)); return c < 0 ? 0 : boardDist(0, c); }), queue);
      const k = dist.reduce((bi, d, i) => (process.env.AWAY_PICK === 'far' ? d > dist[bi] : d < dist[bi]) ? i : bi, 0);
      queue = [queue[k], ...queue.filter((_, i) => i !== k)]; tPick = queue[0] + ' (' + dist[k] + ' кл.)'; }
    if(broken && variant === 'wait') await repairWait(q, policy);
    if(broken && variant === 'away') tCall = await callUsta(q, policy);
    let nPlan = 0, nAll = 0, tEnd = null, away = null; const trace = []; if(broken) trace.push('после звонка ' + await q.evaluate(() => [city.min, city.home.visit && city.home.visit.at]));
    for(let qi = 0; qi < queue.length; qi++){
      const id = queue[qi];
      if(broken && variant === 'away' && qi === AWAY_N && tCall && !away){   // 2 дела сделаны — домой; мастер: у двери / ушёл / ещё не пришёл
        away = { backAt:null, outcome:null };
        await q.evaluate(() => { cityLeave(); ct = null; if(!document.getElementById('modal').hidden) closeModal(); city.min += STEP_MIN * boardDist(city.pos, 0); city.pos = 0; });
        away.backAt = await q.evaluate(() => [city.min, city.home.visit && city.home.visit.at, homeUstaState()]);
        await q.evaluate(() => { window.__silent = false; cityArrive0(0); });
        const st = await q.evaluate(() => ({ ct:!!ct, modal:!document.getElementById('modal').hidden }));
        if(st.ct){ away.outcome = 'door'; await playScene(q, 'tesisatci_gel', policy, true); }
        else if(st.modal && away.backAt[2] === 'wait'){ away.outcome = 'early (пришли раньше мастера — ждём дома)'; await q.evaluate(() => closeModal()); await waitUsta(q, policy); }
        else if(st.modal){ away.outcome = 'missed'; await q.click('#modalPrimary'); await q.waitForTimeout(30); await repairWait(q, policy); }
        else { away.outcome = 'early'; await waitUsta(q, policy); }
      }
      if(cap){ const fit = await q.evaluate(id => { const c = BOARD.findIndex(b => (b.scenes || []).includes(id)); if(c < 0) return true; const w = STEP_MIN * boardDist(city.pos, c); if(city.min + w >= DAY_END) return false; city.min += w; city.pos = c; return true; }, id);
        if(!fit) break; }
      if(policy === 'taxi') await q.evaluate(id => { const c = BOARD.findIndex(b => (b.scenes || []).includes(id)); if(c >= 0){ city.money -= 100 + 10 * boardDist(city.pos, c); city.pos = c; } }, id);
      await playScene(q, id, policy);
      if(broken && cap) trace.push(id + ' → ' + await q.evaluate(() => city.min));
      if(broken && cap){ nAll++; if(qi < plan.length){ nPlan++; tEnd = await q.evaluate(() => city.min); } }
    }
    if(broken && variant === 'away' && !away && tCall){ away = { outcome:'не дошли до дома (дел меньше, чем AWAY_N)' }; await waitUsta(q, policy); }
    if(broken) repairLog.push({ pick:tPick, trace, day:(await q.evaluate(() => city.day)), variant, plan:nPlan, all:nAll, planDone:tEnd, away, fixed:await q.evaluate(() => !homeBroken('musluk')), endMin:await q.evaluate(() => city.min), money:await q.evaluate(() => city.money) });
    const r = await q.evaluate(() => ({ day:city.day, dow:cityDow(), money:city.money, debt:city.debt, xp:game.xp, done:city.done.map(x => x.id + ':' + x.kind) }));
    rows.push(Object.assign(r, { spentToday:m0[0] - r.money, xpToday:r.xp - m0[1] }));
    await q.evaluate(() => { cityLeave(); ct = null; if(!document.getElementById('modal').hidden) closeModal(); window.__break = city.day + 1 === 9; cityNewDay(); window.__break = undefined; if(!document.getElementById('modal').hidden) closeModal(); });   // поломка — случайно (Ruling 13); бот ставит её на вторник недели 2 (день 9) хуком, как раньше
    await q.waitForTimeout(40);
  }
  const errs = q.errors.splice(0); await q.context().close();
  return { policy, rows, errs, repairLog };
}

(async () => {
  const browser = await chromium.launch();
  const runs = process.env.ONLY_CMP ? [] : [['speak', 1], ['speak', 2], ['speak', 3], ['phone', 1], ['taxi', 1]];
  const weekly = [];
  for(const [policy, seed] of runs){
    const r = await run(browser, policy, seed); if(policy === 'speak') weekly.push(...[0, 7].filter(o => r.rows.length >= o + 7).map(o => r.rows.slice(o, o + 7).reduce((a, x) => a + x.spentToday, 0) - (o ? 0 : 0)));
    console.log(`\n== ${policy}, набор дел ${seed} ==`);
    r.rows.forEach(x => console.log(`день ${String(x.day).padStart(2)} (${['', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'][x.dow]})  деньги ${String(x.money).padStart(5)}  долг ${x.debt}  потрачено ${String(x.spentToday).padStart(5)}  опыт +${x.xpToday}  ${x.done.join(' ')}`));
    for(let w = 0; w * 7 < r.rows.length; w++){ const wk = r.rows.slice(w * 7, w * 7 + 7); console.log(`неделя ${w + 1}: потрачено ${wk.reduce((a, x) => a + x.spentToday, 0)} ₺ (без зарплаты и аренды), к воскресенью ${wk[wk.length - 1].money} ₺`); }
    r.repairLog.forEach(x => console.log(`ремонт крана: день ${x.day}, починен ${x.fixed ? 'да' : 'нет'}, деньги после дня ${x.money}`));
    if(r.errs.length) console.log('ошибки JS:', r.errs.slice(0, 3));
  }
  if(weekly.length) console.log(`\nговорит верно: расход за неделю ${weekly.join(', ')} ₺, в среднем ${Math.round(weekly.reduce((a, b) => a + b, 0) / weekly.length)} ₺ (без зарплаты)`);
  // Вторник ремонта (день 9, пн–вс недели 2): wait против away, одинаковое начало (неделя 1 — «speak», набор дел 1), очередь дел — до 21:00
  const fmt = m => m == null ? '—' : `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
  console.log('\n== вторник ремонта: wait против away (speak, набор дел 1, дорога пешком по кольцу без кубика) ==');
  for(const variant of ['wait', 'away']){
    const r = await run(browser, 'speak', 1, { variant, capacity:true, days:9 });
    r.repairLog.forEach(x => console.log(`${variant.padEnd(4)}: из 3 дел плана ${x.plan}; всего дел до 21:00 ${x.all}; 3-е дело плана закончено в ${fmt(x.planDone)}; день кончился в ${fmt(x.endMin)}; кран починен ${x.fixed ? 'да' : 'нет'}; деньги ${x.money} ₺` + (x.away ? `; домой в ${x.away.backAt ? fmt(x.away.backAt[0]) : '—'} (мастер к ${x.away.backAt ? fmt(x.away.backAt[1]) : '—'}, ${x.away.backAt ? x.away.backAt[2] : ''}) → ${x.away.outcome}` : '')));
    r.repairLog.forEach(x => x.pick && console.log('   первое дело: ' + x.pick));
    r.repairLog.forEach(x => console.log('   часы игры: ' + x.trace.join('; ')));
    if(!r.repairLog.length) console.log(`${variant}: кран в день 9 не сломан!`);
    if(r.errs.length) console.log('ошибки JS:', r.errs.slice(0, 3));
  }
  await browser.close();
})();
