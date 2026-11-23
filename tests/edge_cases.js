// 境目のテスト（Playwright / Chromium）
//   node tests/edge_cases.js   ※先に tests/fetch_data.sh
// ・狭いスマホ（320px）・タブレット（768px）・文字を大きくしたときの横はみ出し
// ・データが空／一部の項目が無い／壊れている（JSONでない）ときにエラーで止まらないか
// ・おかしなURL（#の後ろ）や、壊れた保存データ（ボックス判定）で止まらないか
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const FILES = {
  'ScrapedDuck/data/events.json': 'sd_events.json', 'ScrapedDuck/data/research.json': 'sd_research.json',
  '/data/bonuses.json': 'bonuses.json', '/data/research.json': 'research.json', '/data/rankings.json': 'rankings.json',
  '/data/megas.json': 'megas.json', '/data/raids.json': 'raids.json', '/data/pokedex.json': 'pokedex.json', '/data/gbl.json': 'gbl.json',
};
const PAGES = ['index.html', 'search.html', 'iv.html', 'spawns.html', 'raids.html', 'rocket.html', 'research.html', 'gbl.html', 'shop.html', 'ranks.html'];
const fails = [], passes = [];
function check(name, ok, detail = '') { (ok ? passes : fails).push(name + (ok ? '' : ` → ${detail}`)); }

// override: ファイル名 → 本文（文字列）を差し替える関数
async function open(browser, page, { width = 390, override = {}, storage, fontScale, time } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const p = await ctx.newPage();
  if (time) await p.clock.install({ time });
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.route('**/*', r => {
    const u = r.request().url();
    for (const [k, f] of Object.entries(FILES)) if (u.includes(k)) {
      const fp = path.join(CACHE, f);
      let body = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null;
      if (override[f] !== undefined) body = typeof override[f] === 'function' ? override[f](body) : override[f];
      if (body === null) return r.abort();
      return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body });
    }
    return u.startsWith('file:') ? r.continue() : r.abort();
  });
  if (storage) await p.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
  if (fontScale) await p.addInitScript(sc => { document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = (16 * sc) + 'px'; document.body.style.zoom = sc; }); }, fontScale);
  await p.goto('file://' + path.join(ROOT, page.split('#')[0]) + (page.includes('#') ? '#' + page.split('#')[1] : ''));
  await p.waitForTimeout(1400);
  p.ctx = ctx;
  return p;
}
const info = (p) => p.evaluate(() => ({
  overflow: document.documentElement.scrollWidth - window.innerWidth,
  wide: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.right > window.innerWidth + 1 && !e.closest('.nav,.chips,.days,.tabs,.types') && getComputedStyle(e).position !== 'fixed'; }).slice(0, 3).map(e => (e.className || e.tagName) + ':' + (e.innerText || '').slice(0, 20)),
  text: (document.querySelector('main') || document.body).innerText,
}));

(async () => {
  const b = await chromium.launch();
  // 1) 画面幅
  for (const width of [320, 768]) for (const page of PAGES) {
    const p = await open(b, page, { width });
    const r = await info(p);
    check(`${page} ${width}px: 横にはみ出さない`, r.overflow <= 1, `${r.overflow}px ${r.wide.join(' / ')}`);
    check(`${page} ${width}px: エラーなし`, !p.errors.length, p.errors.join(' / '));
    await p.ctx.close();
  }
  // 2) 文字を大きくしたとき（1.3倍）
  for (const page of PAGES) {
    const p = await open(b, page, { width: 390, fontScale: 1.3 });
    const r = await info(p);
    check(`${page} 文字1.3倍: 横にはみ出さない`, r.overflow <= 1, `${r.overflow}px ${r.wide.join(' / ')}`);
    await p.ctx.close();
  }
  // 3) データが空・壊れている・項目が欠けている
  const states = {
    '空': { 'sd_events.json': '[]', 'sd_research.json': '[]', 'bonuses.json': '{}', 'research.json': '{}', 'rankings.json': '{}', 'megas.json': '{}', 'raids.json': '{}', 'pokedex.json': '{}' },
    '壊れている': Object.fromEntries(Object.values(FILES).map(f => [f, '<html>502 Bad Gateway</html>'])),
    '項目が欠けている': {
      'sd_events.json': (s) => JSON.stringify(JSON.parse(s).map((e, i) => i % 2 ? { ...e, extraData: undefined, image: undefined } : { ...e, start: null })),
      'raids.json': (s) => { const d = JSON.parse(s); (d.bosses || []).forEach(x => { x.counters = []; delete x.rating; }); return JSON.stringify(d); },
      'research.json': (s) => { const d = JSON.parse(s); return JSON.stringify({ ...d, categories: undefined }); },
      'rankings.json': (s) => { const d = JSON.parse(s); return JSON.stringify({ ...d, buddy: undefined, raidByType: {} }); },
      'bonuses.json': (s) => { const d = JSON.parse(s); return JSON.stringify({ ...d, events: undefined }); },
    },
  };
  for (const [label, override] of Object.entries(states)) for (const page of PAGES) {
    const p = await open(b, page, { override });
    const r = await info(p);
    check(`${page} データ${label}: エラーで止まらない`, !p.errors.length, p.errors.join(' / ').slice(0, 200));
    check(`${page} データ${label}: 「読み込み中」のままにならない`, !/読み込み中/.test(r.text), r.text.slice(0, 80));
    check(`${page} データ${label}: undefined 等が出ない`, !/undefined|NaN|\[object Object\]/.test(r.text), (r.text.match(/.{0,20}(undefined|NaN|\[object Object\]).{0,20}/) || [''])[0]);
    await p.ctx.close();
  }
  // 3b) データが古い（取ってきたイベントが全部終わった後）・まだ始まっていない日時
  for (const [label, time] of [['半年後', new Date(Date.now() + 180 * 86400000)], ['半年前', new Date(Date.now() - 180 * 86400000)]]) for (const page of PAGES) {
    const p = await open(b, page, { time });
    const r = await info(p);
    check(`${page} ${label}: エラーで止まらない`, !p.errors.length, p.errors.join(' / ').slice(0, 200));
    check(`${page} ${label}: undefined 等が出ない`, !/undefined|NaN|\[object Object\]|-\d+日/.test(r.text), (r.text.match(/.{0,20}(undefined|NaN|\[object Object\]|-\d+日).{0,20}/) || [''])[0]);
    if (label === '半年後' && page !== 'shop.html') {
      const st = await p.$eval('#stale', e => e.innerText).catch(() => '');
      check(`${page} ${label}: データが古いと注意が出る`, /更新されていません|1件もありません/.test(st), st.slice(0, 60));
    }
    if (label === '半年前') {
      const st = await p.$eval('#stale', e => e.innerText).catch(() => '');
      check(`${page} ${label}: 新しいデータなら注意は出ない`, !st.trim(), st.slice(0, 60));
    }
    if (page === 'index.html') console.log(`  [${label}] index: ${r.text.replace(/\n+/g, ' | ').slice(0, 300)}`);
    await p.ctx.close();
  }
  // 4) おかしなURL
  for (const page of ['search.html#zzz', 'search.html#%E3%81%82', 'search.html#__proto__', 'ranks.html#zzz', 'ranks.html#buddy', 'iv.html#zzz', 'research.html#zzz', 'raids.html#zzz']) {
    const p = await open(b, page);
    check(`${page}: エラーで止まらない`, !p.errors.length, p.errors.join(' / '));
    await p.ctx.close();
  }
  // 5) 壊れた保存データ（ボックス判定）
  const p0 = await open(b, 'shop.html');
  const keys = await p0.evaluate(() => Object.keys(localStorage));
  await p0.ctx.close();
  // 保存に使うキーを調べるため、一度保存してみる
  const p1 = await open(b, 'shop.html');
  await p1.click('text=レイドボックス'); await p1.waitForTimeout(200);
  await p1.click('text=このボックスを保存'); await p1.waitForTimeout(200);
  const saved = await p1.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));
  await p1.ctx.close();
  for (const k of Object.keys(saved)) for (const bad of ['{', 'null', '[1,2,"x"]', '{"a":1}', '[{"items":null,"price":"abc"}]']) {
    const p = await open(b, 'shop.html', { storage: { [k]: bad } });
    const t = await p.$eval('body', e => e.innerText);
    check(`shop: 保存データ ${k}=${bad} でも開ける`, !p.errors.length && t.includes('ボックスの名前'), p.errors.join(' / ').slice(0, 150));
    await p.ctx.close();
  }
  console.log(`保存に使うキー: ${Object.keys(saved).join(', ')}（最初から: ${keys.join(', ') || 'なし'}）`);

  await b.close();
  console.log(`合格 ${passes.length} / 失敗 ${fails.length}`);
  fails.forEach(f => console.log('✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})();
