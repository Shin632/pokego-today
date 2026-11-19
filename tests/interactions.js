// 各ページの操作・入力のテスト（Playwright / Chromium）
//   node tests/interactions.js   ※先に tests/fetch_data.sh
// 失敗したものを一覧で出す（終了コード1）。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const FILES = {
  'ScrapedDuck/data/events.json': 'sd_events.json', 'ScrapedDuck/data/research.json': 'sd_research.json',
  '/data/bonuses.json': 'bonuses.json', '/data/research.json': 'research.json', '/data/rankings.json': 'rankings.json',
  '/data/megas.json': 'megas.json', '/data/raids.json': 'raids.json', '/data/pokedex.json': 'pokedex.json',
};
const fails = [], passes = [];
function check(name, ok, detail = '') { (ok ? passes : fails).push(name + (ok ? '' : ` → ${detail}`)); }

async function open(browser, page, { time, width = 390, height = 844, storage } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const p = await ctx.newPage();
  if (time) await p.clock.install({ time });
  p.errors = [];
  p.on('pageerror', e => p.errors.push(e.message));
  await p.route('**/*', r => {
    const u = r.request().url();
    for (const [k, f] of Object.entries(FILES)) if (u.includes(k)) {
      const fp = path.join(CACHE, f);
      return fs.existsSync(fp) ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(fp) }) : r.abort();
    }
    return u.startsWith('file:') ? r.continue() : r.abort();
  });
  if (storage) await p.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, storage);
  await p.goto('file://' + path.join(ROOT, page) + (page.includes('#') ? '' : ''));
  await p.waitForTimeout(1300);
  p.ctx = ctx;
  return p;
}
const close = async (p, label) => { check(`${label}: JavaScriptエラーなし`, !p.errors.length, p.errors.join(' / ')); await p.ctx.close(); };

(async () => {
  const b = await chromium.launch();

  // ===== index.html =====
  {
    const p = await open(b, 'index.html');
    const days = await p.$$('.day');
    check('index: 日付タブが8つ', days.length === 8, days.length);
    for (let i = 0; i < days.length; i++) {
      await (await p.$$('.day'))[i].click(); await p.waitForTimeout(150);
      const sel = await p.$eval('.day.sel', e => e.dataset.day);
      check(`index: 日付タブ${i}を押すと選択される`, sel === String(i), sel);
    }
    await (await p.$$('.day'))[0].click(); await p.waitForTimeout(150);
    const row = await p.$('.row[data-day]');
    if (row) {
      const d = await row.getAttribute('data-day'); await row.click(); await p.waitForTimeout(150);
      const sel = await p.$eval('.day.sel', e => e.dataset.day);
      check('index: 「このあと7日間」の行を押すとその日に移る', +d >= 8 || sel === d, `${d} → ${sel}`);
    }
    await close(p, 'index');
  }
  // 日付が変わる瞬間（23:59:30 → 1分後）に表示の日付が進むか
  {
    const now = new Date(); const jst = new Date(now.getTime() + 9 * 3600000);
    const t = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 14, 59, 30));
    const p = await open(b, 'index.html', { time: t });
    const before = await p.$eval('#todayLabel', e => e.textContent);
    await p.clock.runFor(60000); await p.waitForTimeout(300);
    const after = await p.$eval('#todayLabel', e => e.textContent);
    check('index: 0時をまたぐと今日の日付が進む', before !== after, `${before} → ${after}`);
    const selDay = await p.$eval('.day.sel .dw', e => e.textContent);
    check('index: 0時をまたいでも「今日」が選択されたまま', selDay === '今日', selDay);
    await close(p, 'index 0時');
  }

  // ===== search.html =====
  {
    const p = await open(b, 'search.html');
    const cases = [['だんばる', 'ダンバル'], ['METAGROSS', 'メタグロス'], ['ﾋﾟｶﾁｭｳ', 'ピカチュウ'], ['ホウオウ', 'ホウオウ'], ['ho-oh', 'ホウオウ'],
      ['ポリゴン2', 'ポリゴン2'], ['ポリゴンZ', 'ポリゴンZ'], ['ニドラン', 'ニドラン'], ['mr. mime', 'バリヤード'], ['カモネギ', 'カモネギ'], ['ルカリオ', 'ルカリオ'], ['  ルカリオ  ', 'ルカリオ']];
    for (const [q, expect] of cases) {
      await p.fill('#q', ''); await p.fill('#q', q); await p.waitForTimeout(350);
      const sugg = await p.$$eval('.sg', e => e.map(x => x.textContent));
      const card = await p.$eval('.card .name', e => e.textContent).catch(() => '');
      const nf = (x) => x.normalize('NFKC');
      const ok = nf(card).includes(nf(expect)) || sugg.some(s => nf(s).includes(nf(expect)));
      check(`search: 「${q}」で「${expect}」が出る`, ok, `候補=${sugg.slice(0, 5).join(',')} カード=${card.slice(0, 20)}`);
    }
    await p.fill('#q', 'ぴかちゅう'); await p.waitForTimeout(350);
    const first = await p.$('.sg'); if (first) { await first.click(); await p.waitForTimeout(200); }
    const hash = await p.evaluate(() => location.hash);
    check('search: 選ぶとアドレスに #id が付く', /^#\w+/.test(hash), hash);
    const vb = await p.$$('.vb'); if (vb.length > 1) { await vb[1].click(); await p.waitForTimeout(200); }
    check('search: 系統ボタンで切り替えできる', (await p.$$('.vb.cur')).length === 1, '');
    await p.fill('#q', 'あいうえおかきくけこ'); await p.waitForTimeout(350);
    check('search: 見つからないときに案内が出る', (await p.$eval('#sugg', e => e.textContent)).includes('見つかりません'), '');
    await close(p, 'search');
    // ハッシュ付きで開く
    const p2 = await open(b, 'search.html#metagross');
    check('search: #metagross で開くとメタグロスが出る', (await p2.$eval('.card .name', e => e.textContent).catch(() => '')).includes('メタグロス'), '');
    await close(p2, 'search hash');
  }

  // ===== iv.html =====
  {
    const p = await open(b, 'iv.html');
    const setIv = async (a, d, h) => { await p.fill('#ia', String(a)); await p.fill('#id', String(d)); await p.fill('#ih', String(h)); await p.waitForTimeout(120); };
    await p.fill('#q', 'マリル'); await p.waitForTimeout(350);
    for (const bad of [['16', '15', '15'], ['-1', '0', '0'], ['1.5', '3', '3'], ['', '3', '3']]) {
      await setIv(...bad);
      const t = await p.$eval('#main', e => e.innerText);
      check(`iv: 不正な個体値 ${bad.join('/')} で注意が出る`, t.includes('0〜15の整数'), t.slice(0, 40));
    }
    const t0 = Date.now(); await setIv(0, 15, 15); const ms = Date.now() - t0;
    check('iv: マリル 0/15/15 は育成すべき（スーパー1位）', (await p.$eval('#main', e => e.innerText)).includes('育成すべき'), '');
    check('iv: PvP計算が2秒以内', ms < 2000, ms + 'ms');
    // 名前を変えると結果が更新されるか
    await p.fill('#q', ''); await p.fill('#q', 'コラッタ'); await p.waitForTimeout(350); await setIv(1, 1, 1);
    check('iv: 名前を変えると判定も変わる', (await p.$eval('#main', e => e.innerText)).includes('逃がしてOK'), '');
    // シャドウ未実装のポケモンでシャドウにチェック
    await p.fill('#q', ''); await p.fill('#q', 'ミュウ'); await p.waitForTimeout(350);
    const sg = await p.$$('.sg'); if (sg.length) { await sg[0].click(); await p.waitForTimeout(150); }
    await p.setChecked('#shadow', true); await setIv(10, 10, 10);
    const t = await p.$eval('#main', e => e.innerText);
    check('iv: シャドウ未実装のポケモンでもエラーにならない', t.length > 20, t.slice(0, 50));
    await p.setChecked('#shadow', false);
    // ダイマックスとキョダイマックスは同時に選べない
    await p.check('#dmax'); await p.check('#gmax'); await p.waitForTimeout(100);
    check('iv: ダイマックスとキョダイマックスは片方だけ', !(await p.isChecked('#dmax')) && (await p.isChecked('#gmax')), '');
    // 名前を書き換えたら前のポケモンの結果が残らない（2回目で修正）
    await p.uncheck('#gmax'); await p.fill('#q', 'ケッキング'); await p.waitForTimeout(350); await setIv(15, 15, 15);
    await p.fill('#q', 'ヌケ'); await p.waitForTimeout(350);
    check('iv: 名前を書き換えると前の結果が消える', !(await p.$eval('#main', e => e.innerText)).includes('ケッキング'), '');
    // バトルに出ないが実装済みのポケモンも選べる・進化すると伝説になるポケモンは逃がしてOKにしない
    for (const [n, want, ng] of [['メタモン', '個体値', null], ['ヌケニン', '個体値', null], ['コスモッグ', 'とっておく', '逃がしてOK']]) {
      await p.fill('#q', ''); await p.fill('#q', n); await p.waitForTimeout(350); await setIv(1, 2, 3);
      const t = await p.$eval('#main', e => e.innerText);
      check(`iv: ${n} を判定できる`, t.includes(want) && (!ng || !t.includes(ng)), t.slice(0, 40));
    }
    await close(p, 'iv');
  }

  // ===== shop.html =====
  {
    const p = await open(b, 'shop.html');
    for (const i of [0, 1, 2, 3]) {
      await p.click(`[data-t="${i}"]`); await p.waitForTimeout(100);
      check(`shop: テンプレート${i}で判定が出る`, /^[SABCD]$/.test(await p.$eval('#result .grade', e => e.textContent)), '');
    }
    await p.click('[data-t="0"]'); await p.fill('#bprice', '0'); await p.waitForTimeout(100);
    check('shop: 価値のある中身で0コインはS', (await p.$eval('#result .grade', e => e.textContent)) === 'S', '');
    await p.fill('#bprice', '-5'); await p.waitForTimeout(100);
    check('shop: マイナスの値段は判定しない', (await p.$eval('#result .grade', e => e.textContent)) === '？', await p.$eval('#result .grade', e => e.textContent));
    await p.fill('#bprice', '99999999'); await p.waitForTimeout(100);
    check('shop: とても高い値段はD', (await p.$eval('#result .grade', e => e.textContent)) === 'D', '');
    await p.click('[data-t="0"]'); await p.click('#save'); await p.waitForTimeout(150);
    check('shop: 保存すると一覧に出る', (await p.$$('.sv')).length >= 1, '');
    await p.reload(); await p.waitForTimeout(600);
    check('shop: 再読み込み後も保存が残る', (await p.$$('.sv')).length >= 1, '');
    await p.click('#delAll'); await p.click('#delAll'); await p.waitForTimeout(150);
    check('shop: すべて消すで消える', (await p.$$('.sv')).length === 0, '');
    await close(p, 'shop');
  }

  // ===== ranks.html =====
  {
    const p = await open(b, 'ranks.html');
    for (const tab of ['raid', 'gymAttack', 'gymDefense', 'buddy']) {
      await p.click(`[data-tab="${tab}"]`); await p.waitForTimeout(150);
      const n = await p.$$eval('#main .rk', e => e.length);
      check(`ranks: ${tab} で10件`, n === 10, n);
    }
    await p.click('[data-tab="raid"]');
    const types = await p.$$eval('[data-type]', e => e.map(x => x.dataset.type));
    for (const t of types) {
      await p.click(`[data-type="${t}"]`); await p.waitForTimeout(60);
      for (const k of ['mega', 'shadow', 'legendary']) await p.click(`[data-show="${k}"]`);
      await p.click('[data-easy]'); await p.waitForTimeout(60);
      const n = await p.$$eval('#main .rk', e => e.length);
      check(`ranks: ${t} で「メガ・シャドウ・伝説なし＋育てやすいだけ」でも1件以上`, n >= 1, n);
      for (const k of ['mega', 'shadow', 'legendary']) await p.click(`[data-show="${k}"]`);
      await p.click('[data-easy]');
    }
    await close(p, 'ranks');
    const p2 = await open(b, 'ranks.html#gymDefense');
    check('ranks: #gymDefense で開くとジム防衛タブ', (await p2.$eval('.tab.sel', e => e.dataset.tab)) === 'gymDefense', '');
    await close(p2, 'ranks hash');
  }

  // ===== research.html =====
  {
    const p = await open(b, 'research.html');
    for (const f of await p.$$eval('[data-f]', e => e.map(x => x.dataset.f))) {
      await p.click(`[data-f="${f}"]`); await p.waitForTimeout(100);
      const n = await p.$$eval('.task', e => e.length);
      check(`research: 絞り込み ${f} でタスクが出るか案内`, n > 0 || (await p.$eval('#main', e => e.innerText)).includes('ありません'), n);
    }
    await p.click('[data-f="all"]');
    await p.fill('#q', 'ミニリュウ'); await p.waitForTimeout(400);
    const n = await p.$$eval('.task', e => e.length);
    check('research: 「ミニリュウ」で絞り込める', n >= 1, n);
    await p.fill('#q', ''); await p.waitForTimeout(300);
    await p.click('details.gfold > summary'); await p.waitForTimeout(100);
    const link = await p.$('.grow'); if (link) { await link.click(); await p.waitForTimeout(300); }
    check('research: 割に合うタスクの行を押すとそのタスクへ移動', (await p.evaluate(() => location.hash)).startsWith('#task-'), await p.evaluate(() => location.hash));
    await close(p, 'research');
  }

  // ===== raids / rocket / spawns =====
  for (const pg of ['raids.html', 'rocket.html', 'spawns.html']) {
    const p = await open(b, pg);
    const txt = await p.$eval('main', e => e.innerText);
    check(`${pg}: 中身が表示される`, txt.length > 100 && !txt.includes('読み込み中'), txt.slice(0, 40));
    if (pg === 'raids.html') {
      for (const k of ['mega', 'shadow', 'legendary']) await p.click(`[data-show="${k}"]`);
      await p.waitForTimeout(100);
      const empty = await p.$$eval('.boss', bs => bs.filter(b => !b.querySelector('.cr')).length);
      check('raids: 全部外しても各ボスに有利なポケモンが出る', empty === 0, empty);
    }
    if (pg === 'rocket.html') {
      check('rocket: 8位まで表示', (await p.$$eval('#main .tr', e => e.length)) === 8, '');
      check('rocket: サカキがランキングにいない', !(await p.$eval('#main', e => e.innerText)).includes('サカキ'), '');
    }
    await close(p, pg);
  }

  await b.close();
  console.log(`合格 ${passes.length} / 失敗 ${fails.length}`);
  fails.forEach(f => console.log('✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})();
