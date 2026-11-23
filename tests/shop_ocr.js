// ボックス判定：スクリーンショットの読み取りのテスト（Playwright / Chromium）
//   node tests/shop_ocr.js
// ショップ画面に似せた画像を作り、ページに読み込ませて、ボックスの名前・中身・値段・おすすめの表示を確かめる。
// 本物のショップ画面ではないので、実際の画面での読み取りの精度は別に確かめる必要がある。
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// 画像にするボックス（名前・中身・値段・割引）
const BOXES = [
  { name: 'レイドボックス', items: [['スーパーふかそうち', 1], ['レイドパス', 3]], price: '275', off: '45%OFF', want: { price: 275, rows: { super_incubator: 1, raid_pass: 3 } } },
  { name: 'ブーストボックス', items: [['しあわせタマゴ', 1], ['ほしのかけら', 1], ['ポフィン', 1]], price: '85', want: { price: 85, rows: { lucky_egg: 1, star_piece: 1, poffin: 1 } } },
  { name: 'アルティメットボックス', items: [['リモートレイドパス', 3], ['スーパーふかそうち', 2], ['ポケモンボックスアップグレード', 1]], price: '1,480', want: { price: 1480, rows: { remote_raid: 3, super_incubator: 2, storage_upgrade: 1 } } },
];
const MOCK = (b) => `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><style>
body{margin:0;width:390px;height:844px;background:linear-gradient(#2a9d8f,#7fd1c7);font-family:sans-serif}
.card{position:absolute;left:20px;right:20px;top:120px;background:#fff;border-radius:18px;padding:18px;color:#3a3a3a}
h1{font-size:22px;text-align:center;margin:0 0 12px}
.it{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eee;font-size:16px}
.ic{width:44px;height:44px;border-radius:50%;background:#f2c14e;flex:0 0 auto}
.q{margin-left:auto;font-weight:700}
.buy{margin:18px auto 0;width:180px;background:#1fa36f;color:#fff;border-radius:30px;text-align:center;font-size:22px;font-weight:700;padding:10px}
.off{position:absolute;right:30px;top:90px;background:#e63946;color:#fff;font-weight:700;padding:4px 10px;border-radius:10px}
</style></head><body>${b.off ? `<div class="off">${b.off}</div>` : ''}<div class="card"><h1>${b.name}</h1>
${b.items.map(([n, q]) => `<div class="it"><div class="ic"></div><div>${n}</div><div class="q">×${q}</div></div>`).join('')}
<div class="buy">${b.price}</div></div></body></html>`;

function serve(){
  return new Promise(res => {
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.png': 'image/png' };
    const srv = http.createServer((req, rsp) => {
      const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()){ rsp.writeHead(404); return rsp.end(); }
      rsp.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
      fs.createReadStream(p).pipe(rsp);
    }).listen(0, () => res(srv));
  });
}

(async () => {
  const fails = [], passes = [];
  const check = (n, ok, d = '') => (ok ? passes : fails).push(n + (ok ? '' : ` → ${d}`));
  const b = await chromium.launch();
  // 1) 画像を作る
  const files = [];
  {
    const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
    for (const [i, box] of BOXES.entries()){
      await p.setContent(MOCK(box)); const f = path.join(OUT, `shop_mock_${i}.png`);
      await p.screenshot({ path: f }); files.push(f);
    }
  }
  // 2) ページで読み取る
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/shop.html`;
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url); await p.waitForTimeout(500);
  check('shop: 最初は「まだ読み取っていません」', /まだ読み取っていません/.test(await p.$eval('#verdict', e => e.innerText)), '');
  const t0 = Date.now();
  await p.setInputFiles('#shots', files);
  await p.waitForFunction(() => /枚読み取りました/.test(document.getElementById('ocrStatus').innerText), null, { timeout: 180000 });
  const ms = Date.now() - t0;
  const got = await p.evaluate(() => JSON.parse(localStorage.getItem('pogo-shop-saved-v1') || '[]'));
  for (const box of BOXES){
    const g = got.find(x => x.name && x.name.includes(box.name.slice(0, 4)));
    check(`ocr: 「${box.name}」の名前を読み取れた`, !!g, got.map(x => x.name).join(','));
    if (!g) continue;
    check(`ocr: 「${box.name}」の値段 ${box.want.price}`, g.price === box.want.price, g.price);
    const rows = Object.fromEntries(g.rows.map(r => [r.id, r.qty]));
    check(`ocr: 「${box.name}」の中身`, JSON.stringify(rows, Object.keys(box.want.rows).sort()) === JSON.stringify(box.want.rows, Object.keys(box.want.rows).sort()), JSON.stringify(rows));
  }
  const verdict = await p.$eval('#verdict', e => e.innerText);
  check('shop: おすすめの有無が出る', /今日のおすすめ/.test(verdict), verdict.slice(0, 40));
  check('shop: JavaScriptエラーなし', !errs.length, errs.join(' / '));
  console.log(`読み取り ${files.length}枚：${(ms / 1000).toFixed(1)}秒（初回の準備を含む）`);
  console.log('判定：' + verdict.replace(/\n/g, ' / '));
  // 2b) 本物のスマホと同じ解像度（3倍）の画像と、ボックス一覧の画面（1枚に複数・中身なし）
  {
    const q = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 })).newPage();
    await q.setContent(MOCK(BOXES[0])); const hi = path.join(OUT, 'shop_mock_hi.png'); await q.screenshot({ path: hi });
    await q.setContent(`<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><style>body{margin:0;background:#2a9d8f;font-family:sans-serif}
      .g{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;padding:120px 12px}.t{background:#fff;border-radius:12px;padding:10px;text-align:center}
      .n{font-size:13px;font-weight:700}.p{margin-top:40px;background:#1fa36f;color:#fff;border-radius:20px;font-weight:700;padding:4px}</style></head><body>
      <div class="g"><div class="t"><div class="n">レイドボックス</div><div class="p">275</div></div><div class="t"><div class="n">ブーストボックス</div><div class="p">85</div></div>
      <div class="t"><div class="n">スペシャルボックス</div><div class="p">480</div></div></div></body></html>`);
    const list = path.join(OUT, 'shop_mock_list.png'); await q.screenshot({ path: list });
    await p.evaluate(() => localStorage.removeItem('pogo-shop-saved-v1')); await p.reload(); await p.waitForTimeout(400);
    await p.setInputFiles('#shots', [hi]);
    await p.waitForFunction(() => /枚読み取りました/.test(document.getElementById('ocrStatus').innerText), null, { timeout: 120000 });
    const g = (await p.evaluate(() => JSON.parse(localStorage.getItem('pogo-shop-saved-v1') || '[]')))[0] || {};
    check('ocr: 3倍の解像度の画像でも読める', g.price === 275 && (g.rows || []).length === 2, JSON.stringify(g).slice(0, 120));
    await p.setInputFiles('#shots', [list]);
    await p.waitForFunction(() => /枚読み取りました/.test(document.getElementById('ocrStatus').innerText), null, { timeout: 120000 });
    const st = await p.$eval('#ocrStatus', e => e.innerText);
    const n = (await p.evaluate(() => JSON.parse(localStorage.getItem('pogo-shop-saved-v1') || '[]'))).length;
    check('ocr: ボックス一覧の画面（中身なし）は取り込まず、中身の画面を選ぶよう案内する', n === 1 && /中身の画面/.test(st), `${n}件 ${st}`);
  }
  // 3) 日付が変わると、前の日のボックスは消える
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('pogo-shop-saved-v1')); s.forEach(x => x.day = '2000-01-01'); localStorage.setItem('pogo-shop-saved-v1', JSON.stringify(s)); });
  await p.reload(); await p.waitForTimeout(500);
  check('shop: 前の日のボックスは消える', /まだ読み取っていません/.test(await p.$eval('#verdict', e => e.innerText)), '');
  // 4) おすすめが無いとき
  await p.evaluate(() => localStorage.setItem('pogo-shop-saved-v1', JSON.stringify([{ name: 'ステッカーボックス', price: 72, rows: [{ id: 'sticker', qty: 24 }], at: Date.now(), day: (d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)(new Date()) }])));
  await p.reload(); await p.waitForTimeout(500);
  check('shop: S・Aが無ければ「おすすめはありません」', /今日のおすすめはありません/.test(await p.$eval('#verdict', e => e.innerText)), '');
  await b.close(); srv.close();
  console.log(`合格 ${passes.length} / 失敗 ${fails.length}`);
  fails.forEach(f => console.log('✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})();
