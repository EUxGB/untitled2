# Дом с поломками, фаза 1 (кран и Нихат-уста) — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** дома ломается кран; игрок звонит сантехнику Нихату-уста, договаривается о цене и времени, ждёт его дома (или возвращается к часу), платит — кран на картинке кухни перестаёт капать; не починил — каждый вечер вода стоит денег.

**Architecture:** две обычные сцены `SCENES` («Город»): звонок `tesisatci` (phone) и приход мастера `tesisatci_gel`, обе на клетке `ev`. Состояние поломки — `city.home` в `soyle-city`. Появление поломки — в `cityNewDay`, в план она встаёт первой, как `ev_sahibi`. Картинка кухни — встроенный SVG в шапке сцены (поле сцены `room`).

**Tech Stack:** один файл `index.html` (ванильный JS), тесты Playwright (`tests/soyle.test.js`, `tests/city.test.js`), `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-22-home-repairs-design.md` (читать целиком; §2 цикл, §4 устройство, §5 реплики, §6 тесты, §8 решения).

## Global Constraints

- Дом — только когда фишка на клетке «Дом» (`city.pos === 0`): ни сцену, ни «Ждать мастера» нельзя начать с другой клетки; нажатие на клетку «Дом» во время хода только ведёт фишку (`cityMoveTo` не трогать).
- Турецкие реплики — только из списка Task 1 после одобрения пользователем; машинный перевод не использовать.
- Каждое слово реплик — с глоссой (`PHRASE_DICT`/`FORM_GLOSS`/`FUNC_GLOSS`) и в `tests/morph.json` → `python3 tests/morph-sync.py`; иначе падает тест покрытия.
- Без эмодзи; иконки — SVG; подписи кнопок — `setLbl`; зоны нажатия ≥ 44 px; всё помещается на 320/360/390/412 без прокрутки страницы.
- Цвет «тюльпан» `--tulip` — только трудные звуки и запись (для лужи/поломки — `--near` #7A4A00 / `--near-soft` #FFF1D6).
- Новые ключи хранения — только внутри `soyle-city` (поле `city.home`).
- Новые опорные кнопки — в `ANCHORS` теста случайных нажатий; новые экраны проходят `monkey`/`STUCK`.
- Числа из спека: точно — +120 мин, 150 ₺; общими словами — +180 мин, 200 ₺ (изменено пользователем 2026-10-24 08:35); торг −10 ₺ (140 / 190); окно «мастер ждёт у двери» — 60 мин; позже 20:00 — визит завтра в 9:30; «потом» — −40 ₺ каждый вечер; соседка — отношения `komsu` −1 один раз.
- Появление в фазе 1: со 2-й недели кампании (`campWeek() >= 2`), раз в неделю — во вторник (`cityDow() === 2`), если крана нет в `city.home.broken` и его не чинили на этой неделе. Не в неделе 1.
- Перед любым push: `npm test` зелёный (кроме «вид совпадает с эталоном» локально — арбитр CI); push в `main` и `main:tts-work`; «опубликовано» — только после CI `test`, `deploy`, `verify` = success и WebFetch https://www.simitci.ru/?check=<…> с новым хэшем.

## Review Focus

1. **Неделя 3 «становится готовой» сама.** `campReady(3)` считает неделю готовой, если у неё есть хоть одна сцена; `tesisatci` стоит в `WEEK_SETS[2]` → окно «Неделя 3 — скоро» пропадёт, а `cityPlanBase` начнёт класть `tesisatci` в обычный план. Ожидание: сцены с `repair:true` не делают неделю готовой и не попадают в случайный план. Тест — Task 2.
2. **Старое сохранение без `city.home`** и восстановление резервной копии: ожидание — `city.home` появляется пустым, ничего не падает. Тест — Task 2.
3. **Игрок весь день дома** (например, сыграл `ev_sahibi`, и часы ушли дальше `at+60`): он был дома — мастер всё равно пришёл. «Мастер ушёл» — только если игрок пришёл домой с другой клетки после `at+60`. Тест — Task 4.
4. **Не хватает денег мастеру**: ожидание — как у других `pay`, остаток в долг (`city.debt`), сцена заканчивается «починено». Тест — Task 4.
5. **21:00 наступил, пока ждём мастера** (визит назначен, не пришёл): ожидание — `tesisatci_gel` переносится на завтра (`city.carry`), поломка остаётся, «потом» списывает 40 ₺. Тест — Task 4.

---

### Task 1: Реплики — проверка и одобрение (без кода)

**Files:** нет (результат — сообщение пользователю и его ответ; одобренный список вписать в спек §5).

- [ ] **Step 1: Собрать полный список реплик фазы 1** — спек §5 плюс приход мастера:
  игрок «Buyurun, mutfakta.» (Проходите, на кухне.), «Elinize sağlık.» (есть в коде — проверить grep), мастер «Merhaba, musluk için geldim.» (Здравствуйте, я по поводу крана.),
  цены «Yüz elli lira.» «İki yüz lira.» «Yüz kırk lira.» «Yüz doksan lira.», «Yarın sabah gelirim.» (Приду завтра утром.).
- [ ] **Step 2: Сверить** каждую форму Zemberek (`zyq.py`, как в уроках) и слова — sozluk.gov.tr (WebFetch): musluk, damlamak, conta, tesisatçı, sorun, kombi.
- [ ] **Step 3: Показать пользователю** список (турецкий · перевод · что проверено и как); **стоп до одобрения**. Правки — в список.
- [ ] **Step 4: Вписать одобренный список в спек §5**, коммит `docs: реплики фазы 1 одобрены`.

### Task 2: Состояние, появление поломки и план дня

**Files:**
- Modify: `index.html` — `CITY_START` (~3785), `cityNormalize` (~5336), `campReady` (~3862), `cityPlanBase` (~3914), `cityPlanFor` (~3910), `cityNewDay` (~4003)
- Test: `tests/soyle.test.js` — новый `test('Дом с поломками (2026-10-23): состояние и появление', …)`

**Interfaces:**
- Produces: `city.home = { broken:{ musluk?:{ day:number } }, visit:null | { id:"musluk", at:number /*минуты*/, day:number, price:150|200|140|190 }, fixed:[{ id, day, price }], soaked:boolean }`;
  `homeBreak(id:string)` — ставит поломку (`broken[id] = { day: city.day }`); `homeBroken(id:string) → boolean`;
  у сцены флаг `repair:true` (Task 3, 4 ставят его на `tesisatci`, `tesisatci_gel`).

- [ ] **Step 1: Тест (падает).** Утверждения:
  - новая игра: `city.home` = `{ broken:{}, visit:null, fixed:[], soaked:false }`;
  - сохранение без `home` (удалить поле, `cityNormalize()`) → то же;
  - `city.day = 8` (пн, неделя 2, кампания новая) → `cityNewDay()` → день 9 (вт) → `homeBroken('musluk') === true`, `city.plan[0] === 'tesisatci'`;
  - неделя 1 (день 2) → поломки нет;
  - со сценой-заглушкой `SCENES.tesisatci = { repair:true, phone:true, … }` `campReady(3) === false` и `cityPlanBase(15)` не содержит `tesisatci` (Review Focus 1);
  - второй вторник той же поломки не дублирует (`city.plan.filter(x => x === 'tesisatci').length === 1`).
- [ ] **Step 2:** `ONLY="Дом с поломками (2026-10-23): состояние" node tests/soyle.test.js` → FAIL.
- [ ] **Step 3: Реализовать:** поле в `CITY_START` (глубокая копия — см. «Что уже сломалось»: общие объекты `CITY_START`); в `cityNormalize` — дополнить отсутствующее; `campReady` и пул `cityPlanBase` пропускают `repair`;
  в `cityNewDay` после аренды: условие из Global Constraints → `homeBreak('musluk')`; `cityPlanFor`: если `homeBroken('musluk')` и нет `visit` — `tesisatci` первым, если `visit` — `tesisatci_gel` первым (как `ev_sahibi`).
- [ ] **Step 4:** тот же запуск → PASS; мутация (убрать фильтр `repair` в `campReady`) → FAIL, вернуть.
- [ ] **Step 5: Commit** `Дом с поломками: состояние city.home, кран ломается со 2-й недели, в план первым`.

### Task 3: Звонок сантехнику (`tesisatci`) и персонаж Нихат-уста

**Files:**
- Modify: `index.html` — `CHARS` (+ `tesisatci_nihat`), `AVATARS`, `SCENES.tesisatci`, глоссы, `ctNodeFor` (условие `if.price`)
- Modify: `tests/morph.json` → `python3 tests/morph-sync.py`
- Test: `tests/soyle.test.js` — `test('Дом с поломками (2026-10-23): звонок Нихату', …)`; `tests/city.test.js` проходит сцену автоматически

**Interfaces:**
- Consumes: `city.home`, `homeBroken` (Task 2).
- Produces: `SCENES.tesisatci` (`phone:true`, `repair:true`, `room:"mutfak"`, `char:"tesisatci_nihat"`); концовка ok ставит `city.home.visit = { id:"musluk", at: city.min + (vague ? 180 : 120), day: city.day, price }` (`at > 20*60` → `day+1`, `at = 9*60+30`); флаг описания — `ct.flags`/`fx.flag` `"vague"`, торг — ход с `haggle:true` (Pazarlık через `ctDiscount` НЕ брать: цена задана репликой мастера, уступка 10 ₺ — в `price`).
- `CHARS.tesisatci_nihat`: `name:"Нихат-уста"`, `short:"Нихат"`, `bio` — из спека §3, `trait` по характеру (быстро, сразу цена, переспрашивает «вообще»), `likes:{ words:["mutfaktaki","musluk","damlıyor"] }`, `dm` как у других, `contactAt` по умолчанию.

- [ ] **Step 1: Тест (падает).** Хуки `window.__say`, `cityStart`. Утверждения:
  - не дома (`city.pos = 3`): строка дела `tesisatci` без класса `go`, `cityStart` из строки не вызывается (Review: правило клетки);
  - дома: точно (`'mutfaktaki musluk damlıyor'` → `'tamam bekliyorum'`) → `visit` = `{ at: min0 + 120 (+минуты реплик), price:150 }`; проверять `price` и `at - min0` в [120, 130];
  - общими словами (`'su sorunu var'` → `'musluk damlıyor'` → `'tamam bekliyorum'`) → `price:200`, `at - min0` в [180, 190];
  - торг (`… 'biraz indirim olur mu'` на 70+) → `price:140` / `190`, `city.haggleWins` +1; через «Показать» → цена без уступки;
  - звонок в 19:40 (точно) → `visit.day === city.day + 1`, `visit.at === 570`;
  - портрет: `charAvatar('tesisatci_nihat')` отличается от всех остальных (тест «больше персонажей» — число 18 → 19).
- [ ] **Step 2:** запуск по `ONLY` → FAIL.
- [ ] **Step 3: Реализовать** сцену по узлам спека §2/§5 (у каждого узла `again/againRu`; `variants` по `if.price` — новое условие в `ctNodeFor`: `if(f.price !== undefined && !(city.home.visit && city.home.visit.price === f.price)) return false`), персонажа, глоссы, `morph.json`.
- [ ] **Step 4:** `ONLY=…` → PASS; `node tests/city.test.js` → PASS (граф, концовки, глоссы, бот, помещается на 3 размерах).
- [ ] **Step 5: Commit** `Дом с поломками: звонок Нихату-уста (точно/общими словами, торг, время прихода)`.

### Task 4: «Ждать мастера», приход домой, оплата, «потом»

**Files:**
- Modify: `index.html` — `SCENES.tesisatci_gel`, строка дела в `cityRender` (~5425), `cityStart` (обёртка ожидания), `cityArrive0` (~5660, ветка `home`), `cityEnd` (починено), `cityDayEnd` (~6151, «потом»)
- Test: `tests/soyle.test.js` — `test('Дом с поломками (2026-10-23): ждать, прийти к часу, потом', …)`

**Interfaces:**
- Consumes: `city.home.visit` (Task 3).
- Produces: `cityWaitUsta()` — только при `city.pos === 0 && !ct && city.home.visit && city.home.visit.day === city.day`: `city.min = Math.min(DAY_END, Math.max(city.min, visit.at))`, затем `cityStart('tesisatci_gel')`;
  `homeUstaState() → "none" | "wait" | "door" | "missed"` (по `min`, `at`, `at+60`); `SCENES.tesisatci_gel` (`repair:true`, `room:"mutfak"`, `char:"tesisatci_nihat"`, узлы: мастер у двери → «Buyurun, mutfakta.» → «Contayı değiştirdim, bitti.» → `pay` с 4 вариантами по `if.price` → ok).
- Строка дела `tesisatci_gel`: дома и `wait` → «ждать мастера до ЧЧ:ММ» (нажатие → `cityWaitUsta`); дома и `door` → «мастер у двери»; не дома → «мастер в ЧЧ:ММ · дома».

- [ ] **Step 1: Тест (падает).** Утверждения:
  - дома, `visit.at = 600`, `min = 545`: нажатие строки → `city.min === 600`, `ct.id === 'tesisatci_gel'`;
  - не дома: у строки нет `go`, `cityWaitUsta()` ничего не делает (мутация: убрать проверку `pos` → FAIL);
  - ушли, вернулись (`cityArrive0(0)` из `pos=5`) при `min = 640` (в окне) → начинается `tesisatci_gel`; при `min = 700` → окно «мастер ушёл», `visit === null`, `tesisatci` снова в плане, поломка на месте;
  - Review 3: `pos = 0` всё время, `min = 700` → нажатие строки → `tesisatci_gel` (не «ушёл»);
  - оплата 150 при `money = 100` → `money 0`, `debt` +50, сцена ok (Review 4);
  - ok → `homeBroken('musluk') === false`, `fixed.length === 1`, картинка кухни `data-state="fixed"`;
  - «потом»: поломка, `cityDayEnd()` → деньги −40, в тексте окна «Кран капает»; второй вечер — снова −40, `city.rel.komsu` −1 только в первый (`soaked`);
  - Review 5: визит назначен, `min = DAY_END` → `cityDayEnd()` → `city.carry` содержит `tesisatci_gel`, следующий день — он в плане первым.
- [ ] **Step 2:** `ONLY=…` → FAIL.
- [ ] **Step 3: Реализовать.** В `cityArrive0` ветка `home` первой проверяет `homeUstaState()` (`door` → `cityStart('tesisatci_gel')`; `missed` → окно `showModal({ ic:"Olmadı.", … })` + сброс визита); затем прежняя логика. Поломка без визита сцену НЕ навязывает: строка «нажмите, чтобы позвонить» — это и есть выбор «потом» (поправить спек §4, где сказано «открывается сцена поломки»). «Потом» — через `cityFx({ money:-40 })` (долг, если не хватает).
- [ ] **Step 4:** `ONLY=…` → PASS; мутации из Step 1 → FAIL, вернуть.
- [ ] **Step 5: Commit** `Дом с поломками: «Ждать мастера», мастер у двери час, оплата, «потом» стоит 40 ₺`.

### Task 5: Картинка кухни в шапке сцены

**Files:**
- Modify: `index.html` — разметка шапки сцены (`#ctPlace` рядом, ~1230), CSS блока «Город», функция `roomSvg(room:string, state:"broken"|"fixed") → string`
- Test: `tests/soyle.test.js` — `test('Дом с поломками (2026-10-23): кухня на картинке', …)`

**Interfaces:**
- Consumes: `SCENES[*].room`, `homeBroken`.
- Produces: элемент `#ctRoom` (`role="img"`, `aria-label` «Кухня: кран капает» / «Кухня: кран починен», `data-state`), виден только у сцен с `room`.

- [ ] **Step 1: Тест (падает):** в `tesisatci` `#ctRoom` виден, `data-state="broken"`; после починки — `fixed`; в `bakkal` скрыт; на 320×568, 360×640, 390×844, 412×915 сцена помещается без прокрутки страницы, кнопки «Сказать/Показать/Дальше» на месте (`ANCHORS`), подписи не обрезаются (запустить тест «подписи не обрезаются (21:09)»).
- [ ] **Step 2:** FAIL.
- [ ] **Step 3: Реализовать** рисунок по доске «Mutfak — кухня» холста https://claude.ai/artifact/Nz5kRs912vdsk2uL4kKo68 (кран, капли и лужа в состоянии `broken`, плашка «musluk: damlıyor» цветом `--near`), цвета — токены `:root` (светлая и тёмная тема), высота — через `var(--fit)`, без внешних картинок.
- [ ] **Step 4:** PASS + `ONLY="случайные нажатия" node tests/soyle.test.js` → PASS.
- [ ] **Step 5: Commit** `Дом с поломками: кухня на картинке (капает / починено)`.

### Task 6: Экономика и «ждать» — не доминирующая стратегия

**Files:**
- Modify: `tests/city-bot.js` — поломка в неделе 2, стратегии `wait` и `away`
- Modify: спек §4 — цифры замера

- [ ] **Step 1:** добавить в бота: во вторник недели 2 звонок (точно) → стратегия `wait` (сразу `cityWaitUsta`) и `away` (2 дела, потом домой).
- [ ] **Step 2:** `DAYS=14 node tests/city-bot.js` → записать: деньги к воскресенью недели 2 (обе стратегии ≥ 0 без долга при честной игре), дел за вторник `wait` < `away` (ожидание стоит времени).
  Если `wait` даёт столько же дел — поднять время прихода (точно 45 мин) и согласовать с пользователем до продолжения.
- [ ] **Step 3: Commit** `Бот-замер: починка крана в неделе 2 — цифры в спеке`.

### Task 7: Документы, полная проверка, ревью, публикация

**Files:** `CLAUDE.md` («Что уже реализовано»: пункт «Дом с поломками»), `node tests/seo-build.js` (если изменились `frazy/`, `llms.txt`, `sitemap.xml` — закоммитить).

- [ ] **Step 1:** `npm test` → всё зелёное (кроме эталона вида локально); выход и числа — в отчёт.
- [ ] **Step 2:** ревью отдельным агентом (`requesting-code-review`, BASE = коммит до Task 2); Critical/Important — исправить с тестом.
- [ ] **Step 3:** push `main` и `main:tts-work`; дождаться CI `test`, `deploy`, `verify` = success (api.github.com); WebFetch https://www.simitci.ru/?check=<новое> → «· <хэш>».
- [ ] **Step 4:** ответ пользователю: что проверено и как; ссылки https://www.simitci.ru/ и https://raw.githack.com/EUxGB/untitled2/<полный хэш>/index.html; снимки сцены из ветки `screens`.
