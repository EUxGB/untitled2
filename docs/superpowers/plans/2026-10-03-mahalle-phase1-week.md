# «Неделя в квартале», фаза 1 — каркас недели. План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Превратить три сцены «Города» в первую неделю квартала-настолки: поле из 24 клеток с кубиком и выбором, колода из
10 событий (смешных и опасных), календарь с зарплатой и часами работы, персонажи с характером (разные люди на одном месте),
способности игрока, типы узлов `call` и `code`, повтор фраз дня, плитка и медали, генератор проверок всех сцен и 10 новых сцен;
одновременно убрать «Звуки» и пары слов в «На слух».

**Architecture:** Всё — в `index.html` (один файл, правило проекта), блок «Город» (сейчас строки ~3212–3600) расширяется
константами (`BOARD`, `DECK`, `CHARS`, `WEEK_PLAN`, `SKILLS`) и функциями с префиксом `city*`/`ct*`; дом `#ctHome` становится
полем (SVG-кольцо 8×6, внутри — дела дня, кубик, карта события); сцены и карты событий — один движок (`SCENES`, узлы);
состояние — `city` (`soyle-city`, версия 2, нормализация `cityNormalize`). Проверки сцен и карт — новый файл `tests/city.test.js`
(генератор по `SCENES`), остальное — в `tests/soyle.test.js`. Код — только после падающего теста.

**Tech Stack:** vanilla JS в одном файле, Web Speech API, `localStorage`; тесты Playwright 1.56 (`npm test` = `tests/soyle.test.js` + `tests/real-media.test.js`).

**Spec:** `docs/superpowers/specs/2026-10-03-mahalle-world-design.md` (§1–§17; эта фаза — §15 «Фаза 1»; поле — §4а, колода — §9а).

## Global Constraints

- Один файл `index.html`; новые ключи `localStorage` — только с префиксом `soyle-`.
- Никаких эмодзи и символов-картинок; иконки — SVG-спрайт; надписи кнопок с иконкой — только `setLbl`/`setIc`.
- Всё помещается на 360×640, 390×844, 412×915 без прокрутки страницы; новые крупные элементы — через `var(--fit)`; круглые кнопки `border-radius:50%`.
- Любая новая кнопка/экран проходит monkey-тест (`STUCK` в `tests/soyle.test.js`) и тест «прохождение по нажатиям».
- Опыт: `count("city", 1)` за понятую реплику, вес `XP_WEIGHT.city = 1.5`; новые источники XP — только с учётом трудности.
- «Носитель» — только живые записи; синтез — голос персонажа `npcSay`.
- Машинный перевод на экране — только с «≈» и пометкой; в сценах машинного перевода нет вообще.
- Тексты по-русски, турецкие реплики короткие и разговорные; у каждого узла `again`/`againRu`/`ru`; цены кратны 5 ₺.
- `tests/approved/phrases-360.png` обновлять только после согласия пользователя на новый вид.
- Перед «готово/опубликовано»: `npm test` зелёный → push → CI `test`/`deploy`/`verify` success → ссылки полностью.

## Review Focus

Проверки, которых спек не называет, но которые встретит игрок; каждая закреплена тестом в указанной задаче:

1. Старое сохранение `soyle-city` v1 (без `ver`, `rel` по сценам, `money` 120) открывается без ошибок и не теряет день — задача 3.
2. Игрок вернулся в «Город» на следующий календарный день с незаконченной сценой: сцена продолжается, зарплата/перенос считаются по `city.day`, а не по дате — задача 6.
3. 21:00 наступило посреди сцены: сцена доигрывается, перенос — только для не начатых дел — задача 6.
4. Способность повысилась во время сцены (окно `milestone`): окно не перекрывает выбор ответа — показывается после итога сцены (`deferred`, как медали в блице) — задача 8.
5. «Повторить фразы дня» при пустом списке (все реплики провалены) — кнопки нет; при ≥ 1 — очередь только из них, после — возврат в «Город» — задача 11.
6. Бросили кубик и ушли из раздела / закрыли приложение: бросок сохранён (`city.roll`), подсветка восстанавливается, второй бросок без хода невозможен — задача 4.
7. Все дела сделаны, фишка далеко от дома: «Eve dön» считает время по расстоянию, и если 21:00 наступает по дороге — день всё равно заканчивается дома без провала — задача 4.
8. Клетка «?» выпала, когда колода дня исчерпана (10 карт, условия `when` не выполнены): клетка ведёт себя как пустая, без ошибки — задача 5.

---

### Task 1: Убрать «Звуки» и пары слов в «На слух» (спек §12)

**Files:**
- Modify: `index.html` — разметка `#tab-pairs` (строка ~742), `GROUPS` (~948), `mode = "pairs"`, `groupId` (~1151), `renderChips`/`pickPair` (~1290–1320), `next()` ветка `pairs` (~1743–1773), строки статистики (~1786), `GAME_DEFAULTS.blitzBest` (~1816), `renderGame` (`gbBlitz`, ~1889), `QUESTS` «10 верных в «Звуках»» (~1992), `BADGES` `ear, blitz10, blitz20, o, u, i, c, sounds` (~2024–2052), `evalPair` (~2446), `lsKind`/`setLsKind`/чип `lsKindChip` (~2943–2990), `startBlitz` (~3036–3060), `MODES`/`TRAIN` (~3700), обработчик `tab-pairs` (~3941), старт (~3995); текст «Как пользоваться».
- Modify: `tests/soyle.test.js` — 47 упоминаний `pairs` (grep 2026-10-03), тесты блица слов, медалей звуков, `setMode('pairs')` в тестах шрифтов/уровня/эха → `setMode('phrases')`.
- Modify: `tests/real-media.test.js` — тест шрифтов: `setMode('pairs')` → `setMode('phrases')`.
- Modify: `tests/live-screens.js` — список разделов без `pairs`.

**Interfaces:**
- Produces: `MODES = ["city","memory","phrases","listen","free","progress"]`, `TRAIN = ["phrases","listen","free"]`; `lastTrain` по умолчанию `"phrases"`; `#listen` всегда фразы (`pickPhrasePair`), блиц — только `blitzBestPh`; `BADGES.length === 20`.
- Остаётся: `DIA`, `diaHtml`, `markDiff` (подсветка трудной буквы во фразах и «На слух»), `pronScore`, `errsHtml`.

- [ ] **Step 1: Написать падающий тест** в `tests/soyle.test.js` (раздел «Интерфейс»):

```js
await test('«Звуки» и пары слов убраны: нет подвкладки, режима и чипа «слова/фразы», блиц — только фразы, медали звуков сняты', async () => {
  const q = await openPage(browser);
  const r = await q.evaluate(() => ({ tab: !!document.getElementById('tab-pairs'), modes: MODES, train: TRAIN,
    groups: typeof GROUPS, lsChip: !!document.getElementById('lsKindChip'), badges: BADGES.map(b => b.id),
    quest: QUESTS.some(x => /Звук/.test(x.t)), blitzKey: typeof blitzBest, help: document.getElementById('help').textContent }));
  const errs = q.errors; await q.context().close();
  eq([r.tab, r.lsChip, r.quest], [false, false, false]); eq(r.modes, ['city','memory','phrases','listen','free','progress']); eq(r.train, ['phrases','listen','free']);
  eq(r.groups, 'undefined'); eq(r.badges.length, 20); ok(!r.badges.some(id => ['ear','blitz10','blitz20','o','u','i','c','sounds'].includes(id)));
  ok(!/Звуки/.test(r.help)); eq(errs, []);
});
```

- [ ] **Step 2: Прогнать — убедиться, что падает:** `ONLY="Звуки» и пары" node tests/soyle.test.js` → ✗ («tab» true).
- [ ] **Step 3: Удалить код** по списку в Files. Правило проекта: ничего не удалять, не проверив, что заменяет другое — `markDiff`/`diaHtml`/`DIA` остаются (используются во «Фразах» и «На слух»). Строка подвкладок: 3 кнопки. «На слух»: чипы тем — только `lsTopic`; `pickPhrasePair` всегда. Блиц: `blitz.kind` убрать, рекорд — `blitzBestPh`, плитка «Рекорд блица» — «фраз за минуту». В `#help` — убрать упоминания «Звуки».
- [ ] **Step 4: Поправить тесты**, которые опирались на `pairs` (список по `grep -n pairs tests/soyle.test.js`): тесты оценки произношения слов пар переписать на слова из `WORD_SEEDS` (режим «слова» во «Фразах», `setKind(true)`), тесты блица — только фразы, тест медалей — 20 штук.
- [ ] **Step 5: Прогнать всё:** `npm test`. Ожидается: все зелёные, КРОМЕ «вид совпадает с одобренным эталоном» (строка подвкладок стала короче: > 2% пикселей). Снимок падения — `tests/approved/phrases-360.actual.png`.
- [ ] **Step 6: Показать пользователю** `tests/approved/phrases-360.actual.png` (SendUserFile) с одной фразой: «Звуки» убраны, строка подвкладок — три кнопки; согласны на новый эталон?» **Ждать ответа.** Без согласия — не обновлять эталон и не пушить; остальные задачи делать локально.
- [ ] **Step 7: После «да»:** `UPDATE_APPROVED=1 npm test` → 10 пройдено; обычный `npm test` → всё зелёное.
- [ ] **Step 8: Commit:** `git add index.html tests/ && git commit -m "«Звуки» и пары слов в «На слух» убраны (решение пользователя 2026-10-03): подвкладок три, блиц только фразы, медалей 20; эталон вида обновлён по согласию"`.

---

### Task 2: Генератор проверок сцен `tests/city.test.js` (спек §14 п. 1–4, 6) на трёх существующих сценах

**Files:**
- Create: `tests/city.test.js` — запуск `node tests/city.test.js [index.html]`, тот же каркас, что в `soyle.test.js` (`test`, `eq`, `ok`, `openPage` с заглушками — вынести общие части в `tests/harness.js` и подключить из обоих файлов).
- Create: `tests/harness.js` — экспорт `{ test, eq, ok, tap, INIT, openPage, summary }` (перенос из `soyle.test.js`, без дублирования).
- Modify: `package.json` — `"test": "AXE=tests/axe.min.js node tests/soyle.test.js index.html && node tests/city.test.js index.html && node tests/real-media.test.js"`.
- Modify: `index.html` — глоссы для слов реплик игрока трёх сцен в `FORM_GLOSS`/`FUNC_GLOSS`/`PHRASE_DICT` (например `taksime`, `meydana`, `üstü`, `kalsın`, `kombi`, `dairedesiniz` — список даст тест).

**Interfaces:**
- Produces: в `tests/harness.js` — `openPage(browser, opts)` как сейчас; в `tests/city.test.js` — `cityGraphCheck(scene)` (чистая функция над объектом сцены, возвращает массив строк-ошибок), бот `playScene(q, id, policy)` где `policy ∈ {"happy","fail","phone"}`, возвращает `{ ended:boolean, kind, money, min, errors }`.
- Consumes: `SCENES`, `city`, `ct`, `ctMoves`, `wordGloss`, `nphr` из страницы.

- [ ] **Step 1: Падающие тесты** (в `tests/city.test.js`):

```js
await test('граф каждой сцены: старт есть, все go ведут в узлы, у не-конечных again/ru, из каждого узла достижим end, концовок ≥ 3 видов, развилка по смыслу', async () => {
  const q = await openPage(browser); const r = await q.evaluate(() => Object.keys(SCENES).map(id => [id, cityGraphCheckSrc(SCENES[id])]));
  await q.context().close(); eq(r.filter(([, e]) => e.length), []);
});
await test('содержимое: say[0] — одно предложение со знаком, цены кратны 5, купюрами можно заплатить, нет эмодзи, каждое слово say покрыто wordGloss', …);
await test('бот проходит каждую сцену: счастливый путь, провал по терпению, «телефон»; сцена завершается, нет ошибок JS, деньги и время в пределах', …);
await test('каждая сцена помещается на 360×640, 390×844, 412×915: самая длинная реплика собеседника и самый длинный набор карточек', …);
```
   `cityGraphCheck` живёт в тесте (не в приложении): проверяет §14 п. 1 целиком, включая «≥ 3 разных `end.kind`» и «есть узел, у которого два видимых хода ведут (транзитивно) к разным `end.kind`».
   Бот `happy`: в каждом узле — первый видимый ход, `window.__say = say[0]`, клик `#ctSpeak`, затем `#ctNext`; `pay` — минимальная купюра ≥ цены; `fail`: `__silent = true` до `ct === null`; `phone`: клик `#ctShow` в каждом узле. Пределы: `money` после сцены ≥ `до − 600`, `min` прирост ≤ 180.
- [ ] **Step 2: Прогнать:** `node tests/city.test.js` → падает содержимое (глоссы не покрыты) и, возможно, граф (у `taxi` концовки `ok/bad/ok` — проверить, что есть `near`: у taxi нет → это реальная находка: добавить концовку `near` в taxi, например `tomorrow`-подобную для «metro» → `kind:"near"`).
- [ ] **Step 3: Довести сцены и глоссы** до зелёного: недостающие глоссы — вручную (перевод формы в контексте), `taxi.metro` → `kind:"near"`.
- [ ] **Step 4: Прогнать всё:** `npm test` → зелёное (включая новый файл).
- [ ] **Step 5: Commit:** `"Тесты «Города»: генератор проверок по всем сценам (граф, содержимое, бот трёх путей, помещается); harness общий"`.

---

### Task 3: `cityNormalize` v2, персонажи `CHARS`, отношения по персонажам (спек §8 таблица персонажей, §13)

**Files:**
- Modify: `index.html` — перед `const SCENES`: `CHARS`; после `let city = …`: `cityNormalize()`; `SCENES[*].char`; `cityFx` (rel по `char`); `npcSay` (голос по `CHARS[char].voice`); `cityStart` (терпение `CHARS[char].patience`); `cityRender`/`cityDayEnd` (имена из `CHARS`).
- Test: `tests/soyle.test.js` (раздел «Город»).

**Interfaces:**
- Produces: `const CHARS = { sofor:{ name:"Шофёр Али", initial:"A", voice:0, patience:3, trait:"…", likes:{ words:["üstü kalsın"], firstTry:false } }, sofor_hasan:{ name:"Хасан-амджа", patience:2, likes:{ quiet:true } }, sofor_emre:{ name:"Эмре", likes:{ words:["kısa yoldan"] } }, bakkal:{…}, bakkal_emre:{ name:"Эмре, сын Хасана", when: city => city.min >= 18*60 }, kapici:{…}, komsu:{ …patience:4 }, pazarci:{ …patience:2 }, berber:{…}, eczaci:{ …likes:{ words:["teşekkür ederim"], firstTry:true } }, usta:{…} }` — значения из таблицы §8 и пулов §4а; `SCENES.taxi.pool = ["sofor","sofor_hasan","sofor_emre"]`, `SCENES.bakkal.pool = ["bakkal","bakkal_emre"]`, `SCENES.kapici.char = "kapici"`.
- `function pickChar(scene) → string` — `scene.char`, либо из `scene.pool` с весом `1 + (city.rel[c] || 0)` среди тех, у кого `when` не ложно (`TESTMODE`: `window.__char || pool[0]`); результат — `ct.char`; `npcSay`, терпение, `likes`, имя (`#ctWho`), инициал — по `ct.char`. Узел может иметь `npcBy:{ [charId]: "реплика" }` — замена `npc` для этого персонажа (и `againBy`).
- `function cityNormalize()` — `city = Object.assign({}, CITY_START, city)`; `ver:2`; переносит `rel` со сцен на персонажей (`taxi→sofor`), `money = Math.max(money, 1500)` при миграции с v1; гарантирует объекты `rel, mastery, seen, flags, played, skill`, массивы `done, carry, todaySaid`, числа `debt, haggleWins`.
- `city.rel[charId]`; `cityFx({rel})` пишет в `city.rel[ct.char]` (сцена без персонажа — отношения не копятся).
- `CITY_START` дополняется: `ver:2, played:{}, skill:{}, carry:[], todaySaid:[], debt:0, haggleWins:0, money:3500`.

- [ ] **Step 1: Падающий тест:**

```js
await test('Город: сохранение v1 переносится (rel сцен → персонажи, деньги ≥ 1500), персонажи: голос и терпение по CHARS', async () => {
  const q = await openCity({ storage:{ 'soyle-city': JSON.stringify({ day:3, money:120, min:600, rel:{ taxi:2, bakkal:5 }, done:[], said:4, ok:3, days:2 }) } });
  const r = await q.evaluate(() => { trVoices = [{name:'A',lang:'tr-TR'},{name:'B',lang:'tr-TR'},{name:'C',lang:'tr-TR'}];
    SCENES.t = { title:'t', who:'Айше', char:'komsu', place:'p', goal:'g', start:'a', fail:{ text:'f', fx:{} }, nodes:{ a:{ npc:'Buyur.', ru:'…', again:'?', againRu:'?', moves:[{ key:['*'], say:['Tamam.'], ru:'ок', go:'e' }] }, e:{ end:{ kind:'ok', text:'e', fx:{} } } } };
    cityStart('t'); return { ver: city.ver, rel: city.rel, money: city.money, day: city.day, pat: ct.patience, voice: window.__lastVoice }; });
  await q.context().close();
  eq([r.ver, r.day, r.money], [2, 3, 1500]); eq(r.rel, { sofor:2, bakkal:5 }); eq(r.pat, 4); eq(r.voice, 'D'.replace('D', trVoicesNameFor('komsu')));
});
```
   (`openPage` принимает `opts.storage` — добавить в harness: `addInitScript` кладёт пары в `localStorage` до загрузки; заглушка `speechSynthesis.speak` пишет `window.__lastVoice = u.voice && u.voice.name`; ожидание голоса — `trVoices[CHARS.komsu.voice % 3].name`.)
- [ ] **Step 2: Прогнать — падает** (`ver` undefined).
- [ ] **Step 3: Реализовать** `CHARS`, `cityNormalize`, `pickChar`/`pool`/`npcBy` (у такси — три водителя с разными `greet`/`again`: Хасан-амджа «Nereye.» / «Hı?», Эмре «Abi nereye? Kısa yoldan mı gidelim?»), терпение и голос по персонажу, `cityFx` по `ct.char`; дом и итоги дня показывают имена из `CHARS`. Тест: `window.__char = 'sofor_hasan'` → `#ctWho` «Хасан-амджа», `#ctTr` «Nereye.», `ct.patience === 2`.
- [ ] **Step 4: Прогнать** `ONLY="Город" node tests/soyle.test.js` и `node tests/city.test.js` → зелёные (существующие тесты города могут ссылаться на `city.rel.taxi` — обновить на `sofor`).
- [ ] **Step 5: Commit:** `"Город: персонажи CHARS (голос, терпение, характер), отношения по персонажам, сохранение v2 с переносом"`.

---

### Task 4: Поле и ход — `BOARD`, кубик, переходы, визит, «Eve dön», такси (спек §4а)

**Files:**
- Modify: `index.html` — разметка `#ctHome`: `<svg id="ctBoard">` (кольцо 8×6), внутри кольца `#ctInner` (дела дня `#ctTasks`, кубик `#ctDice`, текст), кнопки `#ctRoll` («Zar at»), `#ctHomeBtn` («Eve dön»), `#ctTaxi` («Taksi çağır»); константы `BOARD` (24 клетки по таблице §4а), `SHORTCUTS = [[3,10],[14,21]]`, `STEP_MIN = 10`; функции `boardDist(a, b)`, `boardReach(from, n)`, `cityRoll()`, `cityMoveTo(i)`, `cityArrive(i)`, `cityVisit(i)`, `cityGoHome()`, `cityTaxiTo(i)`; `cityRender` рисует поле; `cityStart(id)` вызывается только из `cityArrive`; CSS `.bd-cell`, `.bd-cell.reach`, `.bd-pin`, `.bd-token`, `.bd-cell.place/.event/.home` (палитра проекта: вода Босфора — места, тюльпан — только опасность/запись, песочный — события), всё через `var(--fit)`; `STUCK` в тестах.
- Test: `tests/soyle.test.js` (новый блок «Поле»), `tests/city.test.js` (граф поля).

**Interfaces:**
- `const BOARD = [{ id:"ev", kind:"home", title:"Дом", scenes:["su","cilingir","kargo","goc","tesisatci","elektrikci"] }, { id:"kapici", kind:"place", title:"Подъезд", scenes:["kapici","aidat"] }, { id:"bakkal", … }, { id:"q3", kind:"event" }, …]` — ровно 24, порядок §4а; `BOARD[i].xy` — координаты клетки на сетке 8×6 по периметру по часовой стрелке от (0,0).
- `function boardDist(a, b) → number` — кратчайший путь по кольцу (в обе стороны) с учётом `SHORTCUTS` (вес 2); `function boardReach(from, n) → number[]` — индексы с `0 < boardDist ≤ n`.
- `function cityRoll()` — если `city.roll` уже есть — ничего; иначе `city.roll = TESTMODE ? (window.__dice || 1) : 1 + Math.floor(Math.random() * 6)`; подсветка `boardReach(city.pos, city.roll)`; `citySave()`.
- `function cityMoveTo(i)` — только если `i ∈ boardReach(city.pos, city.roll)`: `city.min += STEP_MIN * boardDist(city.pos, i)`, `city.pos = i`, `city.roll = null`, `city.visited.push(i)`, затем `cityArrive(i)`.
- `function cityArrive(i)` — `kind:"place"`: дело дня на этой клетке (`city.plan` ∩ `BOARD[i].scenes`, не в `done`, открыто по часам) → `cityStart(id)`; иначе `cityVisit(i)` (окно «Зайти?»: «Зайти» → мини-сцена `visit_<place>` из `SCENES` если есть, иначе +5 мин и +0; «Дальше»); `kind:"event"` → `cityDraw()` (задача 5; до неё — как пустая); `kind:"home"` → если `city.min >= 18*60` или все дела сделаны — предложение «Итоги дня», иначе ничего; `kind:"empty"` — ничего.
- `function cityGoHome()` — `city.min += STEP_MIN * boardDist(city.pos, 0)`, `city.pos = 0`, `cityDayEnd()`; при `city.min >= 21*60` в любой момент после хода — `cityGoHome()` автоматически (сцена, если идёт, доигрывается).
- `function cityTaxiTo(i)` — сцена `taxi` с целью «до <BOARD[i].title>» (параметр `ct.dest = i`); по `end.kind !== "bad"` фишка переносится в `i` без шагов; цена сцены (`pay`) — как в сцене.
- Дом (`cityRender`): дела дня — булавки `.bd-pin` на клетках и список в `#ctInner`; закрытое по часам — серая булавка с `title` часов; `#ctRoll` выключена, пока есть `city.roll`; подсвеченные клетки — кнопки (`<g role="button" tabindex="0">`, зона нажатия ≥ 44 px через прозрачный `rect`).
- Monkey `STUCK` для дома: есть `#ctRoll:not([disabled])` или `.bd-cell.reach` или `#ctHomeBtn` или окно.

- [ ] **Step 1: Падающие тесты:**

```js
await test('Поле: 24 клетки кольцом, срезки, расстояния в обе стороны; бросок подсвечивает клетки ≤ N, остановка раньше, шаг 10 мин; место с делом — сцена, без дела — «Зайти?»; бросок сохраняется; «Eve dön» и 21:00', async () => {
  const q = await openCity();
  const r = await q.evaluate(() => { const out = {};
    out.n = BOARD.length; out.kinds = BOARD.filter(b => b.kind === 'event').length;
    out.dist = [boardDist(0, 23), boardDist(0, 12), boardDist(3, 10), boardDist(2, 11)];     // 1 (назад), 12, 2 (срезка), 9 → через срезку 3→10: 1+2+1 = 4
    window.__dice = 3; cityRoll(); out.reach = boardReach(0, 3); out.rollBtn = document.getElementById('ctRoll').disabled;
    out.lit = [...document.querySelectorAll('.bd-cell.reach')].length; out.savedRoll = JSON.parse(localStorage.getItem('soyle-city')).roll;
    cityMoveTo(2); out.afterMove = [city.pos, city.min, city.roll, !!ct && ct.id];                 // bakkal — дело дня → сцена
    return out; });
  const r2 = await q.evaluate(() => { cityLeave(); ct = null; city.plan = ['taxi']; city.pos = 0; window.__dice = 2; cityRoll(); cityMoveTo(2);
    return { modal: document.getElementById('modalTitle').textContent, pos: city.pos }; });                               // bakkal без дела → «Зайти?»
  const r3 = await q.evaluate(() => { document.getElementById('modalSecondary').click(); city.pos = 12; city.min = 20 * 60; cityGoHome(); return { pos: city.pos, min: city.min, modal: document.getElementById('modalTitle').textContent }; });
  await q.context().close();
  eq([r.n, r.kinds], [24, 6]); eq(r.dist, [1, 12, 2, 4]); eq(r.reach.sort((a, b) => a - b), [1, 2, 3, 21, 22, 23]); eq([r.rollBtn, r.lit, r.savedRoll], [true, 6, 3]);
  eq(r.afterMove, [2, 540 + 20, null, 'bakkal']); eq([r2.modal, r2.pos], ['Лавка на углу — зайти?', 2]); eq(r3, { pos:0, min: 20 * 60 + 120, modal: 'День 1 прожит' });
});
await test('Поле помещается на 360×640, 390×844, 412×915: зоны нажатия клеток ≥ 44 px, дела внутри кольца, кнопки видны', …);   // по образцу «Город помещается»
```
   В `tests/city.test.js`: граф поля связный, срезки в существующие клетки, каждая сцена §5 недели 1 привязана хотя бы к одной клетке (`BOARD.some(b => b.scenes.includes(id))`, кроме `event:true`).
- [ ] **Step 2: Прогнать — падает** (`BOARD` не определён).
- [ ] **Step 3: Реализовать** по Interfaces. Поле — SVG `viewBox="0 0 328 246"` (8×41 × 6×41), клетка 36×36 с зоной 41×41 (+ внешний отступ карточки = ≥ 44 на экране при `--fit ≥ 1`; при `--fit < 1` на 360×640 зона всё равно ≥ 44 px — проверить тестом, иначе уменьшить `#ctInner`). Фишка — круг с инициалом «S». Движение — без анимации при `prefers-reduced-motion`, иначе переход 200 мс.
- [ ] **Step 4: Прогнать** «Поле», «Город», monkey, `city.test.js` → зелёные. Существующие тесты города, которые запускали сцену кнопкой `.ct-task` — переписать на `cityStart(id)` из страницы (сцена всё ещё запускается напрямую в тестах) или на бросок с `window.__dice`.
- [ ] **Step 5: Снимки** дома на трёх размерах — глазами (frontend-design: не шаблонная «монополия»; формы клеток — скруглённые, значки мест из спрайта, подписи 10–11 px).
- [ ] **Step 6: Commit:** `"Город: поле-настолка — 24 клетки, кубик с выбором (остановка раньше, срезки), булавки дел, «Зайти?», «Eve dön», такси-переезд"`.

---

### Task 5: Колода событий `DECK` — 10 карт фазы 1 (спек §9а)

**Files:**
- Modify: `index.html` — `DECK = ["kedi","balkon","kopek","yankesici","yagmur","dugun","simitci","mac","dolmusyanlis","kimlik"]` (id мини-сцен в `SCENES` с `event:true`, `mood`, `when(city)`), `cityDraw()`, `cityArrive` (ветка `event`), флаги `flags.kedi/wet/semsiye/yarali` и их утренние следствия в `cityNewDay` (задача 6: `kedi` → дело «mama» в bakkal: ход `shop` с товаром `kedi maması`; `wet` → с вероятностью 0,5 (`TESTMODE`: по `window.__sick`) дело `doktor` — пока сцены doktor нет (фаза 3) → `eczane`); узел `timed:{ sec:5 }` для карманника (микрофон открывается сразу, не успели — промах); узел с `minScore:70` для «Git!».
- Test: `tests/soyle.test.js` (по одному сценарию на карту с особой механикой: kedi → флаг и дело утром; kopek → минимальная оценка и укус; yankesici → таймер; yagmur → зонт/`wet`; dolmusyanlis → перенос на 6 клеток), `tests/city.test.js` (все карты проходят генератор; `mood` ∈ множества; опасная карта не первая в день 1).

**Interfaces:**
- `function cityDraw() → string|null` — карты из `DECK`, не в `city.deckUsed`, с `when(city) !== false`; день 1 и `deckUsed.length === 0` → только `mood !== "danger"`; `TESTMODE`: `window.__card || первая подходящая`; нет карт → `null` (клетка как пустая). Вытянутая → `city.deckUsed.push(id)`, `cityStart(id)` (сцена-событие: `#ctPlace` = «Событие», без цели, `fail` карты — её «плохой» исход).
- Узел `timed:{ sec }` — `cityNode` сам нажимает «Сказать» (микрофон открыт), по истечении `sec` без ответа — `cityMiss("time")`; `TESTMODE`: `window.__slow` имитирует просрочку.
- Ход с `minScore:70` — принимается только при `pronScore ≥ minScore` (ключевые слова недостаточно); Dil ≥ 3 → `minScore − 10`.
- Флаги: `cityFx({ flag })` уже пишет `city.flags[flag] = city.day`; добавить `unflag` для «зонт купили».

- [ ] **Step 1: Падающие тесты** (сценарии из Files; у каждого ожидания по таблице §9а: `kedi` → `city.flags.kedi === 1`, утром `city.plan` содержит `"mama"`; `kopek` при `__say = 'git'` с оценкой < 70 → «обход» `min + 20`, второй провал → `pos` = клетка 8? нет — hastane вне поля: `money − 300`, `min + 120`, флаг `yarali`; `yankesici` при `__slow` → `money − 200`; `yagmur` без «şemsiye» → `flags.wet`; `dolmusyanlis` без вопроса → `pos` сдвинут на 6 по кольцу, `min + 30`; граф/содержимое всех 10 — генератор).
- [ ] **Step 2: Прогнать — падает.**
- [ ] **Step 3: Реализовать** карты (турецкий короткий, смешное — в тексте исхода по-русски и в реплике персонажа) и механики `timed`/`minScore`.
- [ ] **Step 4: Прогнать** «Город», `city.test.js`, monkey → зелёные.
- [ ] **Step 5: Commit:** `"Город: колода событий — 10 карт (кот, чай с балкона, собака, карманник, дождь, свадьба, симитчи, матч, не тот долмуш, kimlik), таймер и минимальная оценка"`.

---

### Task 6: Календарь: неделя, зарплата, часы работы, перенос дел (спек §7)

**Files:**
- Modify: `index.html` — константы `SALARY = 3500`, `DAY_START = 9*60`, `DAY_END = 21*60`, `WEEK_PLAN` (таблица §7, недели 1–3; id сцен, которых ещё нет, допустимы — `cityPlanFor` пропускает неизвестные), `SCENES[*].open`; функции `cityDow()`, `cityWeek()`, `cityPlanFor(day)`, `cityOpenNow(id)`, `cityNewDay()`; `cityRender` (булавки закрытых дел — серые, с часами), `cityDayEnd` (перенос, зарплата через `cityNewDay`), `cityArrive` (закрытое место → «Закрыто: пн–пт 09:00–17:00», без сцены).
- Test: `tests/soyle.test.js`.

**Interfaces:**
- `const cityDow = () => (city.day - 1) % 7 + 1` (1 = пн), `const cityWeek = () => Math.ceil(city.day / 7)`.
- `function cityPlanFor(day) → string[]` — недели 1–3 из `WEEK_PLAN[week-1][dow-1]`, с 4-й: `[давно не игранное по played.last, случайное из SCENES, случайное из остальных]` без повторов и без закрытых в этот день; в тестах (`SOYLE_TEST`) — детерминированно (первые подходящие). Результат хранится в `city.plan` (считается при смене дня); `CITY_PLAN` удаляется, все места читают `city.plan`.
- `function cityOpenNow(id) → { open:boolean, text:string }` по `SCENES[id].open = { days:[1..7], from, to }` (минуты); без `open` — `{ open:true }`; после `DAY_END` всё закрыто (`text: "после 21:00 — завтра"`).
- `function cityNewDay()` — `day++`, `days++`, `done = []`, `min = DAY_START`, `plan = [...carry, ...cityPlanFor(day)]` без дублей, `carry = []`, `todaySaid = []`; если `cityDow() === 1`: `money += SALARY`, затем `debt` списывается (`money -= debt; debt = 0`), `toast("Maaş: +3500 ₺")`.
- `cityDayEnd()` — `carry = plan.filter(не в done)`; в окне: «не успели: …» если `carry.length`.
- Часы по спеку: banka, ptt, noter, muhtar, goc — `{days:[1,2,3,4,5], from:540, to:1020}`; pazar — `{days:[2,6]}`; kuafor — `{days:[1,2,3,4,5,6]}`; eczane — без `open`, после 19:00 узел-вариант «nöbetçi» (+20 мин) — делается в задаче 11 вместе со сценой.

- [ ] **Step 1: Падающий тест:**

```js
await test('Город: календарь — день 1 понедельник с зарплатой 3500, план из WEEK_PLAN, после 21:00 несделанное переносится, закрытое по часам не запускается, в понедельник зарплата и списание долга', async () => {
  const q = await openCity();
  const r = await q.evaluate(() => { const out = {};
    out.start = [cityDow(), cityWeek(), city.money, city.plan];
    city.min = 21 * 60 + 5; cityRender(); out.lateDisabled = document.getElementById('ctRoll').disabled && !!document.getElementById('ctHomeBtn');
    city.done = [{ id:'taxi', kind:'ok', short:'', ok:1, n:1, took:10, spent:180 }]; cityDayEnd(); document.getElementById('modalPrimary').click();
    out.day2 = [city.day, cityDow(), city.plan.slice(0, 2), city.carry, city.money];
    SCENES.banka = Object.assign({}, SCENES.kapici, { title:'Банк', char:undefined, open:{ days:[1,2,3,4,5], from:540, to:1020 } }); city.plan = ['banka']; city.min = 17 * 60 + 1; cityRender();
    out.bankClosed = [!!document.querySelector('.bd-pin.closed'), cityOpenNow('banka').text]; city.pos = 16; window.__dice = 1; cityRoll(); cityMoveTo(17); out.noScene = ct === null;
    city.day = 7; city.debt = 200; city.money = 100; cityNewDay(); out.monday = [cityDow(), city.money, city.debt];
    return out; });
  await q.context().close();
  eq(r.start, [1, 1, 3500, ['taxi', 'bakkal', 'kapici']]); eq(r.lateDisabled, true);
  eq(r.day2, [2, 2, ['bakkal', 'kapici'], [], 3500 - 180]);   // перенесённые дела — первыми, зарплаты во вторник нет
  eq(r.bankClosed, [true, 'пн–пт 09:00–17:00']); eq(r.noScene, true); eq(r.monday, [1, 100 + 3500 - 200, 0]);
});
```
- [ ] **Step 2: Прогнать — падает** (`cityDow` не определена).
- [ ] **Step 3: Реализовать** по Interfaces; `CITY_START.money = 3500`; существующие тесты, ожидающие `500`/`+500 ₺` — обновить (новый день без зарплаты: `toast("Новый день")`).
- [ ] **Step 4: Прогнать** «Город» и `city.test.js` → зелёные.
- [ ] **Step 5: Commit:** `"Город: календарь недели — WEEK_PLAN, зарплата 3500 по понедельникам, часы работы, перенос несделанного после 21:00"`.

---

### Task 7: Характер персонажа в игре: `likes`, узел `chat` (спек §8 таблица)

**Files:**
- Modify: `index.html` — `cityAccept` (бонус `likes`), `SCENES.taxi` (узел `chat` после `traffic`: Али жалуется на пробки: «Bu trafik hiç bitmiyor ya.» → ходы «Evet, çok yoğun.» (+1 rel, `go:"arrive"`) / «Hı hı.» (`go:"arrive"`)); `SCENES.bakkal.greet` ход «Hoş bulduk!» уже даёт +1 — через `likes.words` вместо `fx.rel`.
- Test: `tests/soyle.test.js`.

**Interfaces:**
- `CHARS[c].likes = { words:[...нормализованные фразы или слова], firstTry:boolean }`; `function cityLikes(m, alts, firstTry) → number` — +1, если `ctHas(heardN, w)` для любого `w` из `likes.words` (один раз на сцену, `ct.liked`), ещё +1 за `firstTry && ct.tries === 0` у персонажей с `firstTry:true` (один раз на сцену). Вызывается из `cityAccept` до `cityResolve`; текст результата дополняется «Собеседнику приятно.» (уже есть для `fx.rel`).

- [ ] **Step 1: Падающий тест:**

```js
await test('Город: характер — за то, что персонаж любит, отношение растёт сверх вежливости; узел-разговор у шофёра даёт +1 за поддержку', async () => {
  const q = await openCity(); await q.evaluate(() => { trVoices = []; });
  await ctPick(q, 0); await ctSay(q, 'taksime lütfen'); await ctNext(q); await ctPick(q, 0); await ctSay(q, 'meydana lütfen'); await ctNext(q);
  await ctPick(q, 0); await ctSay(q, 'olur sorun değil'); await ctNext(q);
  const chat = await q.evaluate(() => ({ npc: document.getElementById('ctTr').textContent, opts: [...document.querySelectorAll('#ctOpts .ct-opt-main')].map(b => b.textContent) }));
  await ctPick(q, 0); const r = await ctSay(q, 'evet çok yoğun'); const rel = await q.evaluate(() => city.rel.sofor);
  await q.context().close();
  eq(chat.npc, 'Bu trafik hiç bitmiyor ya.'); eq(chat.opts.length, 2); ok(/приятно/.test(r.res)); eq(rel, 1);
});
```
- [ ] **Step 2: Прогнать — падает.**
- [ ] **Step 3: Реализовать** `cityLikes`, узел `chat` в такси (граф-тест задачи 2 проверит `again`/`ru` и достижимость), `bakkal.likes.words = ["hoş bulduk", "kolay gelsin"]` (убрать дубль `fx.rel` там, где его заменяет `likes`; существующий тест bakkal ожидает `rel` — пересчитать по новой логике и обновить ожидание осознанно).
- [ ] **Step 4: Прогнать** «Город» + `city.test.js` → зелёные.
- [ ] **Step 5: Commit:** `"Город: характер персонажей — likes (+1 за то, что он ценит), разговор о пробках у шофёра"`.

---

### Task 8: Способности игрока `kulak`, `dil`, `nezaket` (спек §8а; `pazarlik` — фаза 2)

**Files:**
- Modify: `index.html` — `SKILLS`, `SKILL_LVLS`, `skillLvl`, `skillBump`, `cityXpMult`, `ctAcceptScore`, `npcRate`; хуки в `cityAccept` (dil ≥ 90, kulak без перевода, nezaket вежливость), `cityAnswer` (порог), `ctBump` (dil 3), `cityStart` (nezaket 3: терпение +1), `cityReveal` (nezaket 4: бесплатно), `cityFx` (nezaket 5: rel ×2), `cityNode` (nezaket 2: `greetAlt`), `npcSay` (rate), `award` (множитель для `gid === "city"`), `cityEnd` (отложенные окна уровней).
- Test: `tests/soyle.test.js`.

**Interfaces:**
- `const SKILLS = { kulak:{ name:"Kulak", ru:"слух", lv:["", "", "собеседники говорят естественнее", "в числах на слух четыре варианта", "говорят ещё быстрее", "опыт за «Город» ×1,25"] }, dil:{…}, nezaket:{…}, pazarlik:{…} }` (тексты уровней — из таблицы §8а, `pazarlik` пока без хуков); `const SKILL_LVLS = [3, 8, 15, 25, 40]`.
- `const skillLvl = id => (city.skill[id] || {}).lvl || 0`; `function skillBump(id)` — `n++`, пересчёт `lvl` по `SKILL_LVLS`; при росте — `ct ? ct.levelUps.push(id) : citySkillModal(id)`; `cityEnd` после окна итога показывает накопленные `citySkillModal` (`milestone({ ic:"Seviye!", title:"Kulak 2", text: SKILLS.kulak.lv[2] })`).
- `const cityXpMult = () => (skillLvl("kulak") >= 5 ? 1.25 : 1) * (skillLvl("dil") >= 5 ? 1.25 : 1)` — в `award`: `gain = Math.max(2, Math.round(gain * (XP_WEIGHT[gid] ?? 1) * (gid === "city" ? cityXpMult() : 1)))`.
- `const ctAcceptScore = () => skillLvl("dil") >= 4 ? 80 : skillLvl("dil") >= 2 ? 75 : 70` — в `cityAnswer` вместо `70` (ключевые слова — как раньше).
- `const npcRate = () => skillLvl("kulak") >= 4 ? 1.1 : skillLvl("kulak") >= 2 ? 1.0 : 0.9` — в `npcSay` (`u.rate`); `call`-сцены (задача 7) — не ниже 1.0.
- `ctBump(line, allowed, big)` — при `big` (dil ≥ 3 и score ≥ 90) +2.
- `cityStart`: `patience = CHARS[char].patience + (skillLvl("nezaket") >= 3 ? 1 : 0)`; `cityReveal`: при nezaket ≥ 4 терпение не тратится; `cityFx`: `rel * (skillLvl("nezaket") >= 5 ? 2 : 1)`; `cityNode`: если nezaket ≥ 2 и `n.greetAlt` — `npc = n.greetAlt` (строка-приветствие по имени, добавляется в `greet`-узлы трёх сцен: «Merhaba komşu! Buyurun, nereye?» и т. п.).
- Счётчики: kulak — в `cityAccept`, если `!ct.revealed`; dil — `score >= 90`; nezaket — `polite` (слово из `POLITE` или `likes.words`).

- [ ] **Step 1: Падающий тест:**

```js
await test('Город: способности — счётчики и уровни (3, 8, 15, 25, 40); Dil 2 поднимает порог до 75, Nezaket 3 даёт терпение +1, Kulak 2 — rate 1.0; окно уровня — после итога сцены; XP ×1.25 на 5-м', async () => {
  const q = await openCity(); await q.evaluate(() => { trVoices = [{ name:'A', lang:'tr-TR' }]; MILESTONE_MODALS = true; });
  const r = await q.evaluate(async () => { const out = {};
    city.skill = { dil:{ n:2, lvl:0 } }; skillBump('dil'); out.lvl = skillLvl('dil'); out.modalHidden = document.getElementById('modal').hidden;   // вне сцены — окно сразу
    document.getElementById('modalPrimary').click();
    out.thr = [ctAcceptScore(), (city.skill.dil.lvl = 4, ctAcceptScore())]; city.skill.dil.lvl = 2;
    city.skill.nezaket = { n:15, lvl:3 }; cityStart('kapici'); out.pat = ct.patience;
    city.skill.kulak = { n:8, lvl:2 }; out.rate = npcRate();
    city.skill.kulak.lvl = 5; city.skill.dil.lvl = 5; out.mult = cityXpMult();
    return out; });
  await q.context().close();
  eq([r.lvl, r.modalHidden], [1, false]); eq(r.thr, [75, 80]); eq(r.pat, 4); eq(r.rate, 1.0); eq(r.mult, 1.5625);
});
```
   Плюс в тесте «карточки ответов»: после ответа на 90+ — `city.skill.dil.n === 1`; после ответа без перевода — `city.skill.kulak.n === 1`; с «lütfen» — `city.skill.nezaket.n === 1`.
- [ ] **Step 2: Прогнать — падает.**
- [ ] **Step 3: Реализовать** по Interfaces. Окно уровня внутри сцены — через `ct.levelUps`, показывается в `cityEnd` после окна итога (очередь `showModal` уже есть).
- [ ] **Step 4: Прогнать** «Город», `city.test.js`, monkey (`ONLY="случайные нажатия"`) → зелёные.
- [ ] **Step 5: Commit:** `"Город: способности игрока Kulak/Dil/Nezaket — уровни по успехам, порог речи, терпение, скорость речи, множитель опыта"`.

---

### Task 9: Типы узлов `code` (число на слух) и сцены-звонки `call` (спек §6)

**Files:**
- Modify: `index.html` — `cityNode` (ветка `n.code`), `cityCode(v)`, `ctButtons` (`code` как `pay`), `ctMoves` (ход «Tekrar eder misiniz?» в `phone` сценах), `cityAnswer` (ход `repeat`), `cityPhone` (запрет в `phone`), `npcSay` (rate ≥ 1.0 в `phone`), `#ctInitial` (значок `i-phone`), CSS `.ct-code` (как `.ct-note`, `min-height:44px`), `STUCK` в тестах.
- Test: `tests/soyle.test.js`, `tests/city.test.js` (бот: для `code` — верный и неверный варианты; `phone`-путь пропускается у `phone` сцен).

**Interfaces:**
- Узел `{ npc, ru, again, againRu, code:{ value, options:[4], go } }`; `function cityCode(v)`: `v === value` → `ct.n++, ct.ok++, count("city",1)`, `skillBump("kulak")` если `ct.tries === 0`, `cityResolve(go, "ok", …)`; иначе `ct.tries++`, терпение −1, `npcSay(again)`, при 0 → `cityEnd(fail, true)`. На экран — `options.slice(0, skillLvl("kulak") >= 3 ? 4 : 3)` с `value` внутри (если `value` не в первых трёх — заменить последний), перемешать детерминированно (`SOYLE_TEST` — без перемешивания).
- Сцена `phone:true`: `ctMoves(n)` добавляет в конец `{ key:["tekrar", "tekrar eder misiniz", "anlamadım"], say:["Tekrar eder misiniz?"], ru:"Повторите, пожалуйста?", repeat:true, xp:false }`; `cityAnswer` при `repeat`: первый раз бесплатно, дальше терпение −1; `cityReplay(npc)`; `cityPhone` → `ctResult("info", "По телефону экран не покажешь — попросите повторить.")` без эффекта; `#ctShow` `disabled`; `#ctInitial` — `<svg class="ic"><use href="#i-phone"/></svg>`.
- `STUCK` (monkey): для `code` — есть `.ct-code:not([disabled])`; для `phone` — `#ctShow` может быть выключен, путь дальше — микрофон/повтор.

- [ ] **Step 1: Падающие тесты** (сцены-заглушки добавляются в `SCENES` из теста, как в задаче 3):

```js
await test('Город: узел «число на слух» — три варианта (четыре при Kulak 3), верный — дальше и Kulak +1, неверный — терпение −1 и переспрос; звонок — без «Показать», «Tekrar eder misiniz?» первый раз бесплатно', …);
```
   Ожидания: `document.querySelectorAll('.ct-code').length === 3`, после `city.skill.kulak = {n:15, lvl:3}` и повторного `cityNode` — 4; клик по неверному → `ct.patience === 2`, `#ctTr` = `again`; клик по верному → `ct.resolved`, `city.skill.kulak.n === 1`; в `phone`-сцене `#ctShow.disabled === true`, последний вариант ответа — «Повторите, пожалуйста?», после него `ct.patience === 3`, второй раз — `2`.
- [ ] **Step 2: Прогнать — падает.**
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Прогнать** «Город», `city.test.js`, monkey → зелёные. Проверить «помещается»: узел `code` с четырьмя кнопками на 360×640 (добавить в тест «Город помещается»).
- [ ] **Step 5: Commit:** `"Город: узел «число на слух» (code) и сцены-звонки (call: без телефона, «Tekrar eder misiniz?»)"`.

---

### Task 10: Эффекты отношений (спек §8: sofor, bakkal, kapici, usta, eczaci — пороги 3 и 6)

**Files:**
- Modify: `index.html` — `ctNodeFor(id)` (варианты узла по условию), `cityPrice(price)` (скидки), ветка `pay` в `cityNode` (veresiye), `SCENES.taxi` (`greet` → при sofor ≥ 3 `go:"traffic"` минуя `where`: вариант узла с `npc:"Her zamanki yere mi?"`), `SCENES.bakkal.list` (при ≥ 3 `none` пуст), `SCENES.kapici.when` (при ≥ 3 сразу `today`).
- Test: `tests/soyle.test.js`.

**Interfaces:**
- Узел может иметь `variants:[{ if:{ rel:{ char, min } }, ...поля узла }]`; `function ctNodeFor(id) → node` — первый подходящий вариант, слитый поверх узла (`Object.assign({}, n, v)` без поля `variants`); `cityNode` и бот тестов используют `ctNodeFor`.
- `function cityPrice(price) → number` — sofor ≥ 6 в сценах `char:"sofor"`, usta ≥ 6 в `char:"usta"`: `Math.floor(price * 0.9 / 5) * 5`; иначе `price`. `pay.price` везде проходит через `cityPrice` (реплика цены собеседника остаётся прежней — «Yüz seksen lira» — но при скидке узел-вариант даёт другую реплику: `variants` со своим `npc` и `pay.price`; проще и честнее: скидка — отдельный вариант узла с собственной ценой и репликой «Sana yüz altmış olsun.»). Решение: **скидки — варианты узлов**, `cityPrice` не нужен (YAGNI); удалить из Files.
- Veresiye: в `cityNode` ветка `pay`: если `city.money < price` и `ct.scene.char === "bakkal"` и `city.rel.bakkal >= 6` → `city.debt += price - city.money; ct.spent += city.money; city.money = 0`; реплика «Sonra ödersin, komşu.»; `cityResolve(p.go, "ok", …)`. Долг гасится в `cityNewDay` по понедельникам (задача 6).

- [ ] **Step 1: Падающий тест:**

```js
await test('Город: отношения открывают варианты — шофёр ≥3 не спрашивает адрес, ≥6 даёт скидку; bakkal ≥3 всё в наличии, ≥6 — в долг; kapıcı ≥3 приходит сегодня', …);
```
   Ожидания: `city.rel = { sofor:3 }` → после `greet` узел `traffic` (`ct.nodeId`); `sofor:6` → в `arrive` `ct.node.pay.price === 160` и `#ctTr` «Sana yüz altmış olsun.»; `bakkal:3` → `ctNodeFor('list').none` отсутствует; `bakkal:6, money:50` → после оплаты `city.debt === 60`, `city.money === 0`, сцена не провалена; `kapici:3` → после `flat` сразу `today`.
- [ ] **Step 2: Прогнать — падает.**
- [ ] **Step 3: Реализовать** варианты узлов, veresiye; граф-тест задачи 2 должен обходить и варианты (`variants[].go`).
- [ ] **Step 4: Прогнать** «Город», `city.test.js` → зелёные.
- [ ] **Step 5: Commit:** `"Город: отношения меняют сцены — варианты узлов по порогам 3/6 (адрес, скидка, наличие, veresiye, kapıcı сегодня)"`.

---

### Task 11: Повтор фраз дня (спек §10)

**Files:**
- Modify: `index.html` — `cityEnd` (накопление `city.todaySaid`), `cityDayEnd` (кнопка `secondary` «Повторить фразы дня (N)»), `memFilter` и `memPlan` (очередь только из фильтра), `memEmpty` (при фильтре — возврат в «Город»), `memRender` (подпись «Фразы дня»).
- Test: `tests/soyle.test.js` («Память» и «Город»).

**Interfaces:**
- `city.todaySaid: string[]` — `tr` реплик с `ok` за день (без повторов), сбрасывается в `cityNewDay`.
- `let memFilter = null` — `Set<string>` турецких фраз; `memPlan` при фильтре: `due`, `fresh`, `ahead` — только карточки из фильтра (`fresh` берутся из `loadCards()`, не из тем), без ограничения `room`; `function cityReview()` — `memFilter = new Set(city.todaySaid.slice(-5))`; `setMode("memory")`; `memEmpty` при `memFilter`: `memFilter = null; toast("Фразы дня повторены"); setMode("city")`.
- Кнопка в окне итогов дня: `secondary:{ label:\`Повторить фразы дня (${n})\`, fn:cityReview }` только при `n ≥ 1` (вместо «Остаться»; «Остаться» — закрытие окна крестиком/Escape уже есть? — нет: оставить `secondary` «Остаться», а повтор — ПЕРВОЙ кнопкой `primary` при `n ≥ 1`, «Новый день» — `secondary`; при `n = 0` — как сейчас).

- [ ] **Step 1: Падающий тест:**

```js
await test('Город: «Повторить фразы дня» — очередь «Памяти» только из сказанного сегодня (≤ 5), после неё — возврат в «Город»; при пустом дне кнопки нет', …);
```
   Ожидания: после двух верных реплик в такси `city.todaySaid.length === 2`; `cityDayEnd()` → `#modalPrimary` «Повторить фразы дня (2)»; клик → `mode === 'memory'`, `mem.card.tr` ∈ `todaySaid`; две оценки → `mode === 'city'`; с `city.todaySaid = []` → `#modalPrimary` «Новый день».
- [ ] **Step 2: Прогнать — падает.**
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Прогнать** «Память», «Город», monkey → зелёные.
- [ ] **Step 5: Commit:** `"Город: повтор фраз дня через «Память» (очередь из сказанного сегодня, до 5)"`.

---

### Task 12: Дом, персонажи, способности, плитка «Прогресс», медали (спек §8 «дома», §8а «видны дома», §11)

**Files:**
- Modify: `index.html` — разметка `#ctInner` (внутри кольца поля): вкладки-чипы «Дела · Люди · Умения» → `#ctTasks` / `#ctChars` (ряд персонажей) / `#ctSkills` (четыре полосы); `openChar(id)` (окно: имя, характер, где встречали, уровень, следующий порог); «Прогресс»: плитка `#gbCity` (`день N · неделя W`, `дел хорошо / всего`, `₺`, `знакомых`), `openCityStats()`; `BADGES` += `hafta` (tier 2, `v: () => city.days, n:7`), `komsu` (tier 2, `v: () => Math.max(0, ...Object.values(city.rel)), n:6`); CSS `.ct-char`, `.ct-skill` (через `var(--fit)`); `renderGame` заполняет плитку.
- Test: `tests/soyle.test.js` (тест «Город помещается» + дом с персонажами на 3 размерах; `openChar`; медали; monkey).

**Interfaces:**
- `function cityCharsHtml() → string` — для `CHARS`, с которыми встречались (`city.rel[id] !== undefined` или сцена с `char` в `played`): кнопка `.ct-char[data-char]` с инициалом и подписью `знакомый`/`свой`/пусто; `function openChar(id)` → `showModal({ ic: CHARS[id].initial, title: name, text: trait + " " + (где встречали: названия сцен с этим `char` из `played`) + " " + (следующий порог: «до „знакомый“ ещё 2»), primary:{label:"Закрыть"} })`.
- `function citySkillsHtml() → string` — четыре `.ct-skill` с названием, уровнем и полосой `n / следующий порог`.
- Плитка: `<div class="pv-tile"><span>Город</span><b id="gbCity">день 1</b><span id="gbCitySub">…</span></div>` вместо плитки «Рекорд блица» (рекорд блица переезжает в статистику) — чтобы не ломать сетку 3 плиток на 360.

- [ ] **Step 1: Падающий тест:**

```js
await test('Город: дома — персонажи с уровнем отношений и карточка персонажа, полосы способностей; «Прогресс» — плитка «Город»; медали Hafta и Komşu', …);
```
   Ожидания: при `city.rel = { bakkal:3, sofor:6 }` дома 2 `.ct-char`, подписи `знакомый`/`свой`; клик → `#modalTitle` «Шофёр Али»; `.ct-skill` 4; в «Прогрессе» `#gbCity` «день 1 · неделя 1»; `city.days = 7` → медаль `hafta` получена после `checkBadges()`; `sofor:6` → `komsu`.
- [ ] **Step 2: Прогнать — падает.**
- [ ] **Step 3: Реализовать.** Снимки трёх размеров дома и «Прогресса» — глазами (frontend-design: не шаблонно; палитра проекта) и тестом «помещается».
- [ ] **Step 4: Прогнать** `npm test` → зелёное (включая monkey и «нажать все кнопки»).
- [ ] **Step 5: Commit:** `"Город: дом с персонажами и способностями, карточка персонажа, плитка «Город» в «Прогрессе», медали Hafta и Komşu"`.

---

### Task 13: Десять сцен недели 1 (спек §5, таблица «Неделя 1»)

**Files:**
- Modify: `index.html` — `SCENES` += `simit, dolmus, istanbulkart, firin, market, cay, lokanta, eczane, komsu, su`; `PHRASE_DICT`/`FORM_GLOSS`/`FUNC_GLOSS` — слова всех новых `say`; `WEEK_PLAN` недели 1 уже ссылается на них (задача 6); каждая сцена привязана к клетке `BOARD` (задача 4).
- Test: `tests/city.test.js` покрывает автоматически (граф, содержимое, бот, помещается); `tests/soyle.test.js` — по одному сценарному тесту на особые механики: `eczane` (узел `code`: «Günde iki kez» → варианты `1×/2×/3×/4×`; после 19:00 вариант `nöbetçi` +20 мин), `su` (`phone:true`, `#num` адрес), `komsu` (`patience 4`, ходы «согласиться на чай» / «вежливо отказаться» → разные `end.kind`, «ellerinize sağlık» в `likes`), `lokanta`/`cay` (`char:"usta"`, «afiyet olsun» → ответ «Elinize sağlık»).

**Interfaces:** формат сцены — как у существующих (§3 спека) плюс поля этой фазы: `char`, `open`, `phone`, `pool`, `npcBy`, узлы `code`, `variants`, `chat`, `greetAlt`; сцены дома (`su`) запускаются с клетки 0 кнопкой «Telefon» (список звонков дня).

Для каждой сцены (делать по одной, коммит на каждую или на пары):
- [ ] **Step 1: Граф и содержимое на бумаге** — в комментарии над сценой: цель, узлы (5–9), ≥ 3 концовок (`ok/near/bad`), развилка по смыслу, цены кратны 5, где `pay`/`code`/`chat`.
- [ ] **Step 2: Написать сцену** в `SCENES` — турецкий короткий и разговорный (проверить формы: «Hoş geldiniz» раздельно, вежливое «siz» к незнакомым, «sen» у bakkal/komsu); `say[0]` — естественная фраза для «Памяти».
- [ ] **Step 3: Прогнать** `node tests/city.test.js` → падает на глоссах → добавить глоссы вручную → зелёное.
- [ ] **Step 4: Для особых механик** — сценарный тест в `soyle.test.js` (см. Files), прогнать.
- [ ] **Step 5: Commit** по сцене: `"Город: сцена «Симитчи у метро» (simit) — pay, 3 концовки"` и т. д.

Содержание сцен (решения, которые нельзя оставить на усмотрение):
- `simit`: симитчи у метро, без `char`; «Bir simit lütfen» → «Susamlı mı, sade mi?» (развилка: любой ответ ok) → цена «on beş lira» `pay` 15 (купюры 20/50/100) → `bad`: промолчать трижды; `near`: уйти без покупки «Kalsın, teşekkürler».
- `dolmus`: водитель, без `char`; «Nereye?» → «Kadıköy'e» / «Beşiktaş'a» (оба ok, разная цена 25/30) → передать деньги «Bir kişi, Kadıköy» `pay` → «Müsait bir yerde inebilir miyim?» → `ok`; `near`: проехать остановку («Dur!» поздно) +10 мин; `bad`: терпение.
- `istanbulkart`: киоск «Büfe»; «Yüz lira yükler misiniz?» → «Kartı okutun» → `pay` 100 (+ комиссия? нет) → `ok`; развилка: «Elli lira» → `near` (хватит на 2 дня, пояснение).
- `firin`: пекарня, без `char`; `shop`: ekmek, poğaça, simit; «Taze mi?» → «Yeni çıktı» → `pay` → `ok`/`near` (забыли из списка)/`bad`.
- `market`: касса; «Poşet ister misiniz?» (evet/hayır — развилка: evet +5 ₺) → «Kart mı nakit mi?» → «Kart» → «Temassız okutun» (`ok`) / «Nakit» → `pay` 85 → `ok`; `bad`: терпение.
- `cay`: `char:"usta"`; «Hoş geldiniz, ne içersiniz?» → «Bir çay lütfen» → «Şekerli mi?» → «Sade» / «Şekerli» → `chat` усты о погоде (поддержать +1) → «Hesap lütfen» → `pay` 15 → «Afiyet olsun» → «Elinize sağlık» (`likes`) → `ok`; `near`: уйти не заплатив? нет — `near`: заказать «kahve» (нет, «Kahve yok, çay var») и согласиться на чай; `bad`: терпение.
- `lokanta`: `char:"usta"`; «Buyurun, ne yersiniz?» → «Bugün ne var?» → «Kuru fasulye, pilav, mercimek çorbası» (`code`: цена набора «yüz yirmi» → варианты 100/120/150/220) → выбрать блюдо (развилка: суп дешевле) → `pay` → «Afiyet olsun» → «Elinize sağlık» → `ok`; `near`: заказали то, чего нет («O bitti»), взяли другое.
- `eczane`: `char:"eczaci"`; «Buyurun» → «Baş ağrısı için bir şey var mı?» → «Reçete var mı?» → «Yok» → «Parol vereyim. Günde iki kez, tok karna.» → `code` «сколько раз в день»: варианты 1/2/3/4 (verno 2; eczaci `likes.firstTry`) → `pay` 60 → `ok`; `variants`: eczaci ≥ 3 → `code.options` две; ≥ 6 → узел `reçete` пропущен; `open`: после 19:00 вариант узла-входа «Nöbetçi eczane» +20 мин; `bad`: терпение.
- `komsu`: `char:"komsu"`, `patience 4`; «Hoş geldin komşu! Buyur çaya.» → «Çok teşekkür ederim, gelirim» (`ok`, +1 rel, +30 мин) / «Şimdi olmaz, işim var. Başka zaman.» (`near`, 0) → при согласии: «Börek de var, ye!» → «Ellerinize sağlık, çok güzel» (`likes`) → `ok`; `bad`: терпение (тётя обиделась, −1 rel).
- `su`: `phone:true`, `char:"kapici"` не ставить (фирма воды — без `char`); «Alo, Su Dünyası, buyurun» → «Bir damacana su lütfen» → «Adres?» → «… Sokak, beş numara» (`#num`) → «Yarım saate gelir» → «Tamam, teşekkürler» → `pay` 80 при доставке → `ok`; `near`: «Bugün gelemeyiz, yarın» согласиться; `bad`: терпение (бросили трубку).

---

### Task 14: Документация, экраны CI, публикация фазы

**Files:**
- Modify: `CLAUDE.md` — разделы «Что уже реализовано» (Город: неделя, персонажи, способности, типы узлов, повтор фраз дня, плитка; «Звуки» убраны; `tests/city.test.js`), таблица навыков (писать, что применено), «Что сломалось» — только если было.
- Modify: `index.html` — `#help` («Как пользоваться»: Город — неделя, зарплата, персонажи, способности).
- Modify: `tests/live-screens.js` — снимки живого сайта: дом с персонажами, сцена `code`, звонок `su`; `info.json` → `city:{ scenes:Object.keys(SCENES).length }`.

- [ ] **Step 1:** Обновить `CLAUDE.md` и `#help`; тест «нет стандартных эмодзи» и «тексты ссылаются на существующие элементы» — прогнать.
- [ ] **Step 2:** `npm test` целиком — вывод и числа в ответ пользователю (verification-before-completion).
- [ ] **Step 3:** `requesting-code-review`: отдельный агент читает диф фазы против спека §5–§11, §13–§14; замечания — исправить до публикации.
- [ ] **Step 4:** Push → CI `test`/`deploy`/`verify` — success (api.github.com check-runs) → ветка `screens` (`git fetch origin screens`) → снимки пользователю.
- [ ] **Step 5: Commit** docs: `"Фаза 1 «Неделя в квартале» завершена: документация, экраны CI"`.

---

## Ход выполнения (ветка `phase1-mahalle`)

- Задачи 1–13 — сделаны и закоммичены (f3b7e0f … a28cb2e); решения по ходу: план дня случайный («начало всегда разное», 20:00), поле 28 клеток 7×9
  с подписями и значками (20:43), срезки убраны и крест снят (21:53), кубик — сама кнопка с точками, тряской и звуком, грань помнится (22:07),
  карточка товара в лавке (22:59), 50 светских реплик и visit_* на 9 клетках (22:26).
- Дополнение к фазе (просьба 2026-10-04 07:52: «на все клетки действия; корм коту — фразы должны отличаться, от 50 вариантов») — спек §6а,
  коммит 4d54e03: узлы с `alt`/`pass`, «Корм для кота» на 50 реплик, visit_* на всех 20 местах и дом «в дверь звонят», `free:true`.
- Задача 14 — в работе: CLAUDE.md, `#help`, `tests/live-screens.js` (сцена города и поле), ревью отдельным агентом, слияние в `main`, CI.

## Самопроверка плана (выполнена при написании)

- Покрытие спека для фазы 1: §4а поле, кубик, визиты, такси, пулы → 4, 3; §9а колода (10 карт) → 5; §5 неделя 1 → 13; §6 `call`/`code` → 9; §7 → 6; §8 персонажи, характер, пороги → 3, 7, 10, 12; §8а → 8 (кроме `pazarlik` — фаза 2); §10 → 11; §11 → 12 (`hafta`, `komsu`; `pazarlikci`, `mahalleli` — фазы 2–3); §12 → 1; §13 → 3, 4; §14 → 2, 4 (+ сценарные тесты в каждой задаче); §16 риск голосов и невезения — проверка на устройстве пользователя и по `info.json` после публикации (задача 14).
- Имена сквозные: `BOARD`, `SHORTCUTS`, `STEP_MIN`, `boardDist`, `boardReach`, `cityRoll`, `cityMoveTo`, `cityArrive`, `cityVisit`, `cityGoHome`, `cityTaxiTo`, `DECK`, `cityDraw`, `pickChar`, `CHARS`, `cityNormalize`, `cityDow`, `cityWeek`, `cityPlanFor`, `cityOpenNow`, `cityNewDay`, `cityLikes`, `SKILLS`, `SKILL_LVLS`, `skillLvl`, `skillBump`, `cityXpMult`, `ctAcceptScore`, `npcRate`, `cityCode`, `ctNodeFor`, `memFilter`, `cityReview`, `cityCharsHtml`, `citySkillsHtml`, `openChar`, `openCityStats`.
- Не делаем в этой фазе: `haggle`, `pazarlik`, утренние события `EVENTS`, карты колоды 11–30, итоги недели, сцены недель 2–3, медали `pazarlikci`/`mahalleli`.
