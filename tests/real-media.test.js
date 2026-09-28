// Проверка настоящих средств браузера (без заглушек микрофона, записи и воспроизведения).
// Микрофон — аудиофайл tests/voice.wav через флаги Chromium; страница открывается по http://localhost.
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const WAV = path.join(__dirname, 'voice.wav');
let passed = 0, failed = 0;
async function test(name, fn){ try { await fn(); passed++; console.log('  ✓', name); } catch(e){ failed++; console.log('  ✗', name, '\n     ', e.message); } }
const ok = (v, m) => { if(!v) throw new Error(m || 'условие не выполнено'); };

(async () => {
  const types = { '.html':'text/html; charset=utf-8', '.json':'application/manifest+json', '.png':'image/png', '.js':'text/javascript', '.wav':'audio/wav', '.woff2':'font/woff2' };
  const server = http.createServer((q, r) => { const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(q.url.split('?')[0])); if(!f.startsWith(ROOT) || !fs.existsSync(f)){ r.writeHead(404); return r.end(); } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(0);
  const URL = `http://localhost:${server.address().port}/index.html`;
  const browser = await chromium.launch({ args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${WAV}`,'--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ permissions:['microphone'], viewport:{ width:390, height:844 } });
  const p = await ctx.newPage(); const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.route('**/*googleapis*/**', r => r.abort());
  await p.route('**/commons.wikimedia.org/**', r => r.fulfill({ json:{ query:{ pages:{} } } }));
  await p.goto(URL); await p.waitForTimeout(300);
  console.log('Настоящие микрофон, запись и воспроизведение (http://localhost)');

  await test('страница открывается с сервера, манифест и иконки отдаются', async () => {
    const r = await p.evaluate(async () => { const m = await fetch('manifest.json').then(r => r.json()); const i = await fetch(m.icons[0].src); return [m.display, i.ok, i.headers.get('content-type')]; });
    ok(r[0] === 'standalone' && r[1] && r[2] === 'image/png', JSON.stringify(r));
  });
  await test('шрифты Soyle Serif и Soyle Sans (как на одобренном экране) грузятся с того же сайта, без Google Fonts; номер версии и кнопка обновления', async () => {
    const r = await p.evaluate(async () => { await document.fonts.ready; await Promise.all([document.fonts.load('700 40px "Soyle Serif"', 'böl'), document.fonts.load('400 16px "Soyle Sans"', 'Сказать')]);
      return [document.fonts.check('700 40px "Soyle Serif"', 'böl'), document.fonts.check('400 16px "Soyle Sans"', 'Сказать'),
        performance.getEntriesByType('resource').filter(e => /woff2/.test(e.name)).every(e => e.name.startsWith(location.origin)),
        !!document.querySelector('link[href*="googleapis"]'), document.getElementById('appVersion').textContent, !!document.getElementById('updateApp')]; });
    ok(r[0] && r[1] && r[2] && !r[3] && r[4].length > 3 && r[5], JSON.stringify(r));
  });
  await test('на экране действительно рисуются свои шрифты (как на одобренном скриншоте), а не шрифты телефона', async () => {
    const c = await p.context().newCDPSession(p); await c.send('DOM.enable'); await c.send('CSS.enable');
    const { root } = await c.send('DOM.getDocument'); const out = {};
    for(const sel of ['#target', '#next .lbl', '#meaning']){
      const { nodeId } = await c.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      out[sel] = (await c.send('CSS.getPlatformFontsForNode', { nodeId })).fonts.map(f => f.familyName + (f.isCustomFont ? '*' : '')).join(','); }
    ok(out['#target'] === 'Liberation Serif*' && out['#next .lbl'] === 'DejaVu Sans*' && out['#meaning'] === 'DejaVu Sans*', JSON.stringify(out));
  });
  await test('микрофон открывается, MediaRecorder пишет настоящий звук', async () => {
    const r = await p.evaluate(async () => {
      const st = await navigator.mediaDevices.getUserMedia({ audio:true });
      const ch = [], rec = new MediaRecorder(st); rec.ondataavailable = e => ch.push(e.data); rec.start();
      await new Promise(z => setTimeout(z, 1200)); rec.stop(); await new Promise(z => rec.onstop = z); st.getTracks().forEach(t => t.stop());
      const blob = new Blob(ch, { type: rec.mimeType });
      // громкость записи: декодируем и считаем среднюю амплитуду
      const buf = await new AudioContext().decodeAudioData(await blob.arrayBuffer());
      const d = buf.getChannelData(0); let sum = 0; for(let i = 0; i < d.length; i++) sum += Math.abs(d[i]);
      return [blob.size, buf.duration, sum / d.length];
    });
    ok(r[0] > 1000, 'пустая запись: ' + r[0]); ok(r[1] > 0.8, 'короткая запись: ' + r[1]); ok(r[2] > 0.01, 'тишина в записи: ' + r[2]);
  });
  await test('«Сравнить» на телефоне без параллельной записи: образец → настоящая запись → она воспроизводится', async () => {
    const r = await p.evaluate(async () => {
      recordOn = false; setMode('pairs'); nativeCache.set(clean(item.target), []);            // нет записи носителя и нет синтеза → сразу запись
      const a = document.getElementById('myAudio'); const before = a.src;
      compareWithFreshRecording();
      for(let t = 0; t < 120 && (a.src === before || a.paused); t++) await new Promise(z => setTimeout(z, 100));
      await new Promise(z => setTimeout(z, 500));
      return [a.src !== before && a.src.startsWith('blob:'), a.currentTime > 0 || !a.paused, myRecFor === item.target];
    });
    ok(r[0], 'запись не создана'); ok(r[1], 'запись не воспроизводится'); ok(r[2], 'запись не привязана к слову');
  });
  await test('«Свободно» на Android-пути: «Записать себя» → «Стоп» → запись играет', async () => {
    const r = await p.evaluate(async () => {
      setMode('free'); recordOn = false; setupSelfRecord(); const b = document.getElementById('freeMine'), a = document.getElementById('myAudio');
      const label0 = b.textContent; await toggleSelfRecord(); await new Promise(z => setTimeout(z, 900)); const label1 = b.textContent;
      await toggleSelfRecord(); for(let t = 0; t < 30 && a.paused; t++) await new Promise(z => setTimeout(z, 100));
      return [label0, label1, !a.paused || a.currentTime > 0];
    });
    ok(r[0] === 'Записать себя' && r[1] === 'Стоп' && r[2], JSON.stringify(r));
  });
  await test('настоящий распознаватель без сети Google: понятное сообщение, приложение не ломается', async () => {
    const r = await p.evaluate(async () => {
      setMode('pairs'); recordOn = false;
      const SRnative = window.SpeechRecognition || window.webkitSpeechRecognition; if(!SRnative) return ['нет API в этом браузере'];
      await startListening(); for(let t = 0; t < 170 && listening; t++) await new Promise(z => setTimeout(z, 100));
      return [document.getElementById('result').textContent.trim().slice(0, 80), listening];
    });
    ok(r.length === 1 || r[1] === false, 'распознавание зависло: ' + JSON.stringify(r));
    console.log('       сообщение:', r[0]);
  });
  // Одобренный вид: эталонный снимок экрана, который выбрал пользователь (tests/approved/). Любое изменение вида,
  // которое заметно меняет этот экран, роняет тест: эталон обновляют ТОЛЬКО после согласия пользователя
  // (UPDATE_APPROVED=1 npm test — перезаписать эталон текущим видом).
  await test('вид совпадает с одобренным пользователем эталоном (Фразы, 360×640)', async () => {
    const REF = path.join(__dirname, 'approved', 'phrases-360.png');
    const c2 = await browser.newContext({ viewport:{ width:360, height:640 }, deviceScaleFactor:2 });
    const q = await c2.newPage();
    await q.route(u => /^https?:/.test(u.href) && !u.href.includes('localhost'), r => r.abort());
    await q.addInitScript(() => { window.SOYLE_TEST = true; });
    await q.goto(URL); await q.evaluate(() => document.fonts.ready); await q.waitForTimeout(400);
    await q.evaluate(() => { setMode('phrases'); item = { target:'Bir çay lütfen.', gid:'ph-basic', meaning:'Кондиционер не работает.' };
      document.getElementById('target').textContent = item.target; document.getElementById('meaning').textContent = item.meaning;
      document.getElementById('partner').textContent = '[клима чалышмыйор]'; evalPhrase(['bir cay lütfe']); game.streak = 1; renderGame(); });
    await q.waitForTimeout(700);                                  // анимация оценки закончилась
    const shot = await q.screenshot();
    if(process.env.UPDATE_APPROVED === '1' || !fs.existsSync(REF)){ fs.writeFileSync(REF, shot); await c2.close(); console.log('       эталон записан:', REF); return; }
    // сравнение попиксельно в самом браузере: доля пикселей, где цвет заметно отличается
    const diff = await q.evaluate(async ([a, b]) => {
      const load = src => new Promise(z => { const i = new Image(); i.onload = () => z(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      if(ia.width !== ib.width || ia.height !== ib.height) return 1;
      const px = img => { const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const x = cv.getContext('2d'); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
      const da = px(ia), db = px(ib); let bad = 0;
      for(let i = 0; i < da.length; i += 4) if(Math.abs(da[i]-db[i]) + Math.abs(da[i+1]-db[i+1]) + Math.abs(da[i+2]-db[i+2]) > 90) bad++;
      return bad / (da.length / 4);
    }, ['data:image/png;base64,' + fs.readFileSync(REF).toString('base64'), 'data:image/png;base64,' + shot.toString('base64')]);
    if(diff > 0.02) fs.writeFileSync(path.join(__dirname, 'approved', 'phrases-360.actual.png'), shot);
    await c2.close();
    ok(diff <= 0.02, `вид отличается от одобренного на ${(diff * 100).toFixed(1)}% пикселей (порог 2%) — снимок: tests/approved/phrases-360.actual.png`);
    console.log(`       отличие от эталона: ${(diff * 100).toFixed(2)}%`);
  });
  await test('за прогон нет JS-ошибок', async () => ok(errors.length === 0, errors.join('; ')));

  await browser.close(); server.close();
  console.log(`\nИтог: ${passed} пройдено, ${failed} с ошибкой`); process.exit(failed ? 1 : 0);
})();
