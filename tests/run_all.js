// 全ページの通しテスト（Playwright / Chromium）
//   node tests/run_all.js [--times=now,cd,...]   ※先に tests/fetch_data.sh で最新データを取ってくる
// 各ページを、スマホ幅・PC幅 × ライト・ダーク × いくつかの日時で開き、次を確かめる：
//   ・JavaScriptのエラー  ・横方向のはみ出し  ・ナビのボタンがすべて押せるか
//   ・英語のまま残った文（日本語化の漏れ）  ・空の欄・「読み込み中」のまま
// 結果は tests/out/result.json と画面写真（tests/out/*.png）に保存する。
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = ['index.html', 'search.html', 'iv.html', 'spawns.html', 'raids.html', 'rocket.html', 'research.html', 'gbl.html', 'shop.html', 'ranks.html'];
const VIEWPORTS = [{ name: 'phone', width: 390, height: 844 }, { name: 'pc', width: 1280, height: 800 }];
// 英語のまま残っていても問題ない語
const ALLOW = /^(PvP|PvPoke|XP|CP|DPS|TDO|GO|Pok[eé]mon|LeekDuck|ScrapedDuck|PokeMiners|PokeAPI|GitHub|Pages|Dynamax|Trails|Twilight|Wishes|Tour|Wild|Area|Lv|MP|UB|Max|Mega|TL|IV|OK|Ctrl|Shift|JSON|HTTP|Failed|fetch|km|Web|The|Of|Edition|Cup|League|LAIC|Catch|Great|Ultra|Master|Kaohsiung|Alola|Global|Los|Angeles|Duolingo|adidas|Pass|Deluxe|Gigantamax|Raid|Day|Battle|Hour|Spotlight|Community|Classic|Research|Timed|Returns|Showers|Minior|Leonids|Geminids|Eternamax)$/i;

function loadJSON(f) { try { return JSON.parse(fs.readFileSync(path.join(CACHE, f), 'utf8')); } catch { return null; } }
function parseTime(s) {
  if (!s) return null;
  if (/Z$/.test(s)) return new Date(s);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5])) : null;   // 日本時間として
}

// テストする日時：今・イベント中・イベント終了直後など（データから自動で選ぶ）
function scenarioTimes() {
  const now = new Date();
  const out = [{ name: 'now', t: now }];
  const ev = loadJSON('sd_events.json') || [];
  const pick = (type, offsetMin, label) => {
    const e = ev.filter(x => x.eventType === type && parseTime(x.start) > now).sort((a, b) => parseTime(a.start) - parseTime(b.start))[0];
    if (e) out.push({ name: label, t: new Date(parseTime(e.start).getTime() + offsetMin * 60000), event: e.name });
  };
  pick('community-day', 30, 'cd_live');
  pick('community-day', 60 * 3 + 30, 'cd_after');      // 終了30分後（レガシー技の期限内）
  pick('raid-hour', 15, 'raidhour_live');
  pick('pokemon-spotlight-hour', -60, 'spotlight_before');
  const jst = new Date(now.getTime() + 9 * 3600000);
  out.push({ name: 'midnight', t: new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 14, 59, 30)) }); // 日本時間 23:59:30
  return out;
}

const FILES = {
  'ScrapedDuck/data/events.json': 'sd_events.json', 'ScrapedDuck/data/research.json': 'sd_research.json',
  '/data/bonuses.json': 'bonuses.json', '/data/research.json': 'research.json', '/data/rankings.json': 'rankings.json',
  '/data/megas.json': 'megas.json', '/data/raids.json': 'raids.json', '/data/pokedex.json': 'pokedex.json', '/data/gbl.json': 'gbl.json',
};

async function checkPage(browser, page, vp, scheme, sc, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', colorScheme: scheme });
  const p = await ctx.newPage();
  await p.clock.install({ time: sc.t });
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  await p.route('**/*', r => {
    const u = r.request().url();
    for (const [k, f] of Object.entries(FILES)) if (u.includes(k)) {
      if (opts.offline) return r.abort();
      const fp = path.join(CACHE, f);
      return fs.existsSync(fp) ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(fp) }) : r.abort();
    }
    return u.startsWith('file:') ? r.continue() : r.abort();
  });
  await p.goto('file://' + path.join(ROOT, page));
  await p.waitForTimeout(1500);
  if (opts.after) await opts.after(p);
  const res = await p.evaluate((allowSrc) => {
    const allow = new RegExp(allowSrc, 'i');
    const out = {};
    out.overflowX = document.documentElement.scrollWidth - window.innerWidth;
    const nav = [...document.querySelectorAll('.nav a')];
    out.navHidden = nav.filter(a => { const r = a.getBoundingClientRect(); return r.right > window.innerWidth + 1 && getComputedStyle(a.parentElement).overflowX === 'visible'; }).map(a => a.textContent);
    const main = document.querySelector('main') || document.body;
    const text = main.innerText || '';
    // わざと並べている英語の原文（.orig .te .en、原文を開く欄）は数えない
    const clone = main.cloneNode(true);
    clone.querySelectorAll('.orig, .te, .en, details.small, details.how, .ec .use').forEach(e => e.remove());
    document.body.appendChild(clone); clone.style.position = 'absolute'; clone.style.left = '-99999px';
    const visibleJa = clone.innerText || ''; clone.remove();
    out.loading = /読み込み中/.test(text);
    out.textLen = text.length;
    // 英語のまま残った語（英字4文字以上の単語のうち、許可していないもの）
    const words = (visibleJa.match(/[A-Za-zÀ-ÿ'’]{4,}/g) || []).filter(w => !allow.test(w));
    const freq = {}; words.forEach(w => freq[w] = (freq[w] || 0) + 1);
    out.english = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 25);
    out.notices = [...document.querySelectorAll('.notice')].map(n => n.innerText.trim()).filter(Boolean);
    out.undefinedText = (text.match(/undefined|NaN|\[object Object\]|null位|Infinity/g) || []).length;
    return out;
  }, ALLOW.source);
  const shot = path.join(OUT, `${page.replace('.html', '')}_${vp.name}_${scheme}_${sc.name}.png`);
  if (opts.shot) await p.screenshot({ path: shot, fullPage: true });
  await ctx.close();
  return { page, vp: vp.name, scheme, scenario: sc.name, errors, ...res };
}

(async () => {
  const browser = await chromium.launch();
  const results = [];
  const times = scenarioTimes();
  const only = (process.argv.find(a => a.startsWith('--times=')) || '').slice(8).split(',').filter(Boolean);
  for (const sc of times.filter(s => !only.length || only.includes(s.name))) {
    for (const page of PAGES) for (const vp of VIEWPORTS) for (const scheme of ['light', 'dark']) {
      if (sc.name !== 'now' && (scheme === 'dark' || vp.name === 'pc')) continue;   // 日時を変えるテストはスマホ・ライトだけ
      results.push(await checkPage(browser, page, vp, scheme, sc, { shot: sc.name === 'now' && scheme === 'light' }));
    }
  }
  // 通信できないとき
  for (const page of PAGES) results.push({ ...(await checkPage(browser, page, VIEWPORTS[0], 'light', { name: 'offline', t: new Date() }, { offline: true })), offline: true });
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify({ times: times.map(t => ({ ...t, t: t.t.toISOString() })), results }, null, 1));
  // 要約
  const bad = results.filter(r => r.errors.length || r.overflowX > 1 || r.navHidden.length || (r.loading && !r.offline) || r.undefinedText);
  console.log(`テスト ${results.length} 件、問題あり ${bad.length} 件`);
  for (const r of bad) console.log(`- ${r.page} ${r.vp} ${r.scheme} ${r.scenario}: ${[r.errors.join(' / '), r.overflowX > 1 ? 'はみ出し' + r.overflowX + 'px' : '', r.navHidden.length ? 'ナビ見切れ' : '', r.loading && !r.offline ? '読み込み中のまま' : '', r.undefinedText ? 'undefined等の表示' : ''].filter(Boolean).join(' ')}`);
  const eng = {};
  results.filter(r => r.vp === 'phone' && r.scheme === 'light').forEach(r => r.english.forEach(([w, n]) => { eng[r.page] = eng[r.page] || {}; eng[r.page][w] = Math.max(eng[r.page][w] || 0, n); }));
  console.log('英語のまま残った語（ページ別・上位）:');
  for (const [pg, ws] of Object.entries(eng)) console.log(`  ${pg}: ${Object.entries(ws).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w, n]) => `${w}(${n})`).join(' ')}`);
  console.log('通信できないときの表示:');
  results.filter(r => r.offline).forEach(r => console.log(`  ${r.page}: ${r.notices.join(' / ').slice(0, 120) || '（お知らせなし）'} ${r.loading ? '【読み込み中のまま】' : ''}`));
})();
