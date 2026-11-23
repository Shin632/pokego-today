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
  '/data/megas.json': 'megas.json', '/data/raids.json': 'raids.json', '/data/pokedex.json': 'pokedex.json', '/data/gbl.json': 'gbl.json',
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
    // 見つからない名前を入れたら前のポケモンの情報が消える（2回目で修正）
    await p.fill('#q', ''); await p.fill('#q', 'リザードン'); await p.waitForTimeout(500);
    await p.fill('#q', 'ミライドン'); await p.waitForTimeout(500);
    check('search: 別の名前を入れると前のポケモンの情報が消える', !(await p.$eval('#main', e => e.innerText)).includes('リザードン'), '');
    await p.fill('#q', 'メタモン'); await p.waitForTimeout(500);
    check('search: メタモンが見つかる', (await p.$eval('#main', e => e.innerText)).includes('Ditto'), '');
    // 活躍の場・育成難易度・候補は最終進化だけ（11/21 追加）
    await p.fill('#q', ''); await p.fill('#q', 'メタグロス'); await p.waitForTimeout(500);
    const mt = await p.$eval('#main', e => e.innerText);
    check('search: 活躍の場がいちばん上に出る', mt.indexOf('活躍の場') >= 0 && mt.indexOf('活躍の場') < mt.indexOf('今の入手方法'), '');
    check('search: 育成難易度が出る', /育成難易度[\s\S]*★/.test(mt) && mt.includes('連れ歩き'), '');
    await p.fill('#q', ''); await p.fill('#q', 'アンノーン'); await p.waitForTimeout(500);
    check('search: 活躍の場がないときはその旨を出す', (await p.$eval('#main', e => e.innerText)).includes('活躍の場はありません'), '');
    // タイプ別は20位まで・シャドウだけなら「シャドウなら」（11/22 改善A）
    await p.fill('#q', ''); await p.fill('#q', 'ケッキング'); await p.waitForTimeout(500);
    check('search: シャドウの姿だけがランキングに入っているときは「シャドウなら」', /レイド攻略（シャドウなら）/.test(await p.$eval('#main', e => e.innerText)), '');
    await p.fill('#q', ''); await p.fill('#q', 'ダンバル'); await p.waitForTimeout(500);
    const sg = await p.$$eval('.sg', e => e.map(x => x.innerText).join(' / '));
    check('search: 候補は最終進化だけ（ダンバル→メタグロス）', /メタグロス/.test(sg) && !/^ダンバル/.test(sg) && !/メタング/.test(sg), sg);
    await p.fill('#q', ''); await p.fill('#q', 'ピカ'); await p.waitForTimeout(500);
    const sg2 = await p.$$eval('.sg', e => e.map(x => x.innerText).join(' / '));
    check('search: コスチュームのピカチュウは候補に出ない', !/マスクド|かりゆし/.test(sg2), sg2);
    // 合体・王の姿も活躍の場に含める（育成判定と食い違わないように。11/22・3回目）
    await p.fill('#q', ''); await p.fill('#q', 'ネクロズマ'); await p.waitForTimeout(500);
    check('search: ネクロズマの活躍の場に合体後の姿が入る', /あかつきのつばさ/.test((await p.$eval('#main', e => e.innerText)).split('育成難易度')[0]), '');
    // フォルム違いを同じ系統として出す（改善K）
    await p.fill('#q', 'ロトム'); await p.waitForTimeout(500);
    check('search: ロトムでウォッシュロトムなどのフォルムも出る', /ウォッシュロトム/.test(await p.$eval('#main', e => e.innerText)), '');
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
    // 本編にはあるがGOで未解禁のメガシンカ（ポカブ→エンブオー）
    for (const [n, iv, want] of [['ポカブ', [15, 14, 13], 'とっておく'], ['ポカブ', [5, 10, 10], '逃がしてOK']]) {
      await p.fill('#q', ''); await p.fill('#q', n); await p.waitForTimeout(350); await setIv(...iv);
      const t = await p.$eval('#main', e => e.innerText);
      check(`iv: ${n} ${iv.join('/')} は「${want}」で、未解禁のメガシンカ（メガエンブオー）を知らせる`, t.includes(want) && t.includes('🔮') && t.includes('メガエンブオー'), t.slice(0, 50));
    }
    await p.fill('#q', ''); await p.fill('#q', 'ヒトカゲ'); await p.waitForTimeout(350); await setIv(15, 15, 15);
    check('iv: メガシンカが解禁済みのポケモン（ヒトカゲ）には未解禁の注意を出さない', !(await p.$eval('#main', e => e.innerText)).includes('🔮'), '');
    // マックスバトルの目安（11/22 改善B）
    await p.fill('#q', ''); await p.fill('#q', 'ハピナス'); await p.waitForTimeout(350);
    await p.setChecked('#dmax', true); await setIv(3, 15, 15);
    const mx = await p.$eval('#main', e => e.innerText);
    check('iv: ダイマックスのハピナスはマックスバトルの耐久役として出る', /マックスバトルの耐久役/.test(mx) && /育成すべき/.test(mx), mx.slice(0, 60));
    await setIv(3, 5, 5);
    check('iv: 防御・HPが低いと1段階下がる', /○ マックスバトルの耐久役/.test(await p.$eval('#main', e => e.innerText)), '');
    await p.setChecked('#dmax', false);
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
    // ひらがな・半角カナでも同じ件数（7回目で修正）
    for (const q2 of ['みにりゅう', 'ﾐﾆﾘｭｳ']) {
      await p.fill('#q', q2); await p.waitForTimeout(400);
      const n2 = await p.$$eval('.task', e => e.length);
      check(`research: 「${q2}」でも「ミニリュウ」と同じ件数`, n2 === n, `${n2} / ${n}`);
    }
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
    // 野生の出現が増えるイベントが今ないときは「見つかりませんでした」と出るのが正しい
    const noSpawn = pg === 'spawns.html' && /野生の出現が増えるイベントは見つかりませんでした/.test(txt);
    check(`${pg}: 中身が表示される`, (txt.length > 100 || noSpawn) && !txt.includes('読み込み中'), txt.slice(0, 40));
    if (pg === 'raids.html') {
      for (const k of ['mega', 'shadow', 'legendary']) await p.click(`[data-show="${k}"]`);
      await p.waitForTimeout(100);
      const empty = await p.$$eval('.boss', bs => bs.filter(b => !b.querySelector('.cr')).length);
      check('raids: 全部外しても各ボスに有利なポケモンが出る', empty === 0, empty);
    }
    if (pg === 'spawns.html' && !noSpawn) {
      const t = await p.$eval('main', e => e.innerText);
      check('spawns: アメ集めにおすすめのメガシンカが出る', /アメ集めにおすすめのメガシンカ/.test(t) && /1\. メガ|1\. ゲンシ/.test(t), t.slice(0, 40));
      const names = await p.$$eval('.mrow .mname', es => es.map(e => e.innerText.split('\n')[0]));
      check('spawns: おすすめのメガシンカは3つまでで、同じものが重ならない', names.length >= 1 && names.length <= 3 && new Set(names).size === names.length, names.join(' / '));
    }
    if (pg === 'rocket.html') {
      check('rocket: 8位まで表示', (await p.$$eval('#main .tr', e => e.length)) === 8, '');
      check('rocket: サカキがランキングにいない', !(await p.$eval('#main', e => e.innerText)).includes('サカキ'), '');
    }
    await close(p, pg);
  }
  // 電波がなくても、前回のデータで検索・育成判定ができる（改善A）
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    let offline = false;
    await ctx.route('**/*', r => {
      const u = r.request().url();
      for (const [k, f] of Object.entries(FILES)) if (u.includes(k)) {
        if (offline) return r.abort();
        return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(CACHE, f)) });
      }
      return u.startsWith('file:') ? r.continue() : r.abort();
    });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('file://' + path.join(ROOT, 'iv.html')); await p.waitForTimeout(1300);
    await p.goto('file://' + path.join(ROOT, 'search.html')); await p.waitForTimeout(1300);
    offline = true;
    await p.reload(); await p.waitForTimeout(1300);
    await p.fill('#q', 'リザードン'); await p.waitForTimeout(500);
    check('offline: 電波なしでも検索できる', (await p.$eval('#main', e => e.innerText)).includes('Charizard'), '');
    await p.goto('file://' + path.join(ROOT, 'iv.html')); await p.waitForTimeout(1300);
    await p.fill('#q', 'マリル'); await p.waitForTimeout(400);
    await p.fill('#ia', '0'); await p.fill('#id', '15'); await p.fill('#ih', '15'); await p.waitForTimeout(300);
    const t = await p.$eval('#main', e => e.innerText);
    check('offline: 電波なしでも育成判定できる（ランキングも使う）', t.includes('育成すべき') && t.includes('スーパーリーグ'), t.slice(0, 50));
    check('offline: 前回のデータで判定していると知らせる', (await p.$eval('#notice', e => e.innerText)).includes('前回取得したデータ'), '');
    check('offline: JavaScriptエラーなし', !errs.length, errs.join(' / '));
    await ctx.close();
  }
  // 前日のうちにレガシー技を予告する（改善E）
  {
    const ev = (JSON.parse(fs.readFileSync(path.join(CACHE, 'sd_events.json'), 'utf8')) || [])
      .find(e => e.eventType === 'community-day' && e.start && new Date(e.start.replace(/\.\d+$/, '') + '+09:00') > new Date());
    if (ev) {
      const st = new Date(ev.start.replace(/\.\d+$/, '') + '+09:00');
      const dayBefore = new Date(Date.parse(ev.start.slice(0, 10) + 'T21:00:00+09:00') - 86400000);   // 日本時間で前日の21時
      const q = await open(b, 'index.html', { time: dayBefore });
      const bp = await q.$eval('.bonus-panel', e => e.innerText).catch(() => '');
      const lb = await q.$eval('#main', e => e.innerText);
      // そのコミュニティ・デイにレガシー技があるときだけ確かめる
      if (/レガシー技/.test(lb)) {
        check('index: 前日のおトク欄に「明日」のレガシー技が出る', /明日/.test(bp) && /レガシー技/.test(bp), bp.slice(0, 60));
        check('index: このあと7日間の一覧に「レガシー技あり」が付く', /レガシー技あり/.test(lb), '');
      }
      await close(q, 'index(前日)');
    }
  }
  // GOバトルリーグ（11/23 追加）：特別ルールが先、そのあと CP上限の低い順
  {
    const g = JSON.parse(fs.readFileSync(path.join(CACHE, 'gbl.json'), 'utf8'));
    const live = (g.events || []).find(e => new Date(e.start) <= new Date() && new Date() < new Date(e.end));
    const q = await open(b, 'gbl.html', live ? {} : { time: new Date(new Date((g.events[0] || {}).start || Date.now()).getTime() + 3600000) });
    const cards = await q.$$eval('main > .lg', es => es.map(e => ({ kind: (e.querySelector('.kind') || {}).textContent, name: (e.querySelector('.lname') || {}).textContent, n: e.querySelectorAll('.pr').length })));
    check('gbl: 開催中のリーグが出る', cards.length >= 1, JSON.stringify(cards).slice(0, 80));
    const firstNormal = cards.findIndex(c => c.kind !== '特別ルール');
    check('gbl: 特別ルールが先に並ぶ', cards.slice(firstNormal < 0 ? cards.length : firstNormal).every(c => c.kind !== '特別ルール'), cards.map(c => c.kind).join(','));
    const cpOrder = cards.filter(c => c.kind !== '特別ルール').map(c => /スーパー/.test(c.name) ? 1 : /ハイパー/.test(c.name) ? 2 : /マスター/.test(c.name) ? 3 : 0);
    check('gbl: スーパー → ハイパー → マスターの順', cpOrder.every((v, i) => !i || v >= cpOrder[i - 1]), cpOrder.join(','));
    check('gbl: 各リーグにおすすめポケモンが出る', cards.every(c => c.n >= 1), '');
    const sp = await q.$('main > .lg.special');
    if (sp) check('gbl: 特別ルールにはルールの説明が出る', /ルール/.test(await sp.innerText()), '');
    await close(q, 'gbl');
  }
  // コミュニティ・デイ当日は主役を「捕まえるべき」に（6回目で修正）。出現ポケモンの情報があるコミュニティ・デイで確かめる
  {
    const bon = JSON.parse(fs.readFileSync(path.join(CACHE, 'bonuses.json'), 'utf8')).events || {};
    const ev = (JSON.parse(fs.readFileSync(path.join(CACHE, 'sd_events.json'), 'utf8')) || [])
      .find(e => e.eventType === 'community-day' && e.start && bon[e.eventID] && (bon[e.eventID].spawns || []).length);
    if (ev) {
      const q = await open(b, 'spawns.html', { time: new Date(new Date(ev.start.replace(/\.\d+$/, '') + '+09:00').getTime() + 30 * 60000) });
      const t = await q.$eval('main', e => e.innerText);
      const hitPart = t.split('出現しにくいポケモン')[0];
      check('spawns: コミュニティ・デイの主役が捕まえるべきに入る', hitPart.includes('コミュニティ・デイの主役'), hitPart.slice(0, 60));
      await close(q, 'spawns(CD)');
    }
  }

  await b.close();
  console.log(`合格 ${passes.length} / 失敗 ${fails.length}`);
  fails.forEach(f => console.log('✗ ' + f));
  process.exit(fails.length ? 1 : 0);
})();
