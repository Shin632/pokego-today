// 検索ページで、全ポケモンを1件ずつ表示して確かめる
//   node tests/search_all.js   ※先に tests/fetch_data.sh
// ・JavaScriptのエラー、undefined / NaN の表示
// ・「活躍の場」「育成難易度」が出ているか、英語のまま残った語
// ・候補（最終進化だけ）に、進化前・メガ・シャドウ・進化できない見た目違いが混ざっていないか
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const CACHE = path.join(__dirname, '.cache');
const FILES = {
  'ScrapedDuck/data/events.json': 'sd_events.json', '/data/bonuses.json': 'bonuses.json', '/data/research.json': 'research.json',
  '/data/rankings.json': 'rankings.json', '/data/megas.json': 'megas.json', '/data/raids.json': 'raids.json', '/data/pokedex.json': 'pokedex.json', '/data/gbl.json': 'gbl.json',
};
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.route('**/*', r => {
    const u = r.request().url();
    for (const [k, f] of Object.entries(FILES)) if (u.includes(k)) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: fs.readFileSync(path.join(CACHE, f)) });
    return u.startsWith('file:') ? r.continue() : r.abort();
  });
  await p.goto('file://' + path.join(ROOT, 'search.html')); await p.waitForTimeout(1500);
  const res = await p.evaluate(() => {
    const out = { n: 0, bad: [], noAct: [], noDiff: [], english: {}, counts: {}, gap: 0 };
    for (const sp of SPECIES) {
      out.n++;
      try { show(sp.id); } catch (e) { out.bad.push(`${sp.id}: ${e.message}`); continue; }
      const main = document.getElementById('main');
      const t = main.innerText;
      if (/undefined|NaN|\[object Object\]|null位/.test(t)) out.bad.push(`${sp.id}: ${(t.match(/.{0,15}(undefined|NaN|\[object Object\]|null位).{0,15}/) || [''])[0]}`);
      const act = (t.split('🏟 活躍の場')[1] || '').split('📈 育成難易度')[0];
      const dif = (t.split('📈 育成難易度')[1] || '').split('📍 今の入手方法')[0];
      if (!act.trim()) out.noAct.push(sp.id);
      if (!/★/.test(dif)) out.noDiff.push(sp.id);
      const m = act.match(/活躍の場が(\d)つ/); const k = m ? m[1] : /活躍の場はありません/.test(act) ? '0' : /目立った活躍の場はありません/.test(act) ? '△のみ' : '?';
      out.counts[k] = (out.counts[k] || 0) + 1;
      if (act.includes('🔮')) out.gap++;
      for (const w of ((act + dif).match(/[A-Za-z]{4,}/g) || [])) if (!/^(PvPoke|PvP|Lv)$/.test(w)) out.english[w] = (out.english[w] || 0) + 1;
    }
    return out;
  });
  // 候補のテスト：いろいろな文字で候補を出し、最終進化以外が混ざっていないか
  const sugg = await p.evaluate(() => {
    const wrong = [];
    for (const q of ['ア', 'カ', 'サ', 'タ', 'ナ', 'ハ', 'マ', 'ヤ', 'ラ', 'ワ', 'メガ', 'シャドウ', 'ピカ', 'イーブイ', 'ガラル', 'アローラ']) {
      suggest(q);
      for (const btn of document.querySelectorAll('.sg')) {
        const sp = BY_ID[btn.dataset.id];
        if (!sp) continue;
        if ((sp.evo || []).some(e => BY_ID[e])) wrong.push(`${q}→${sp.id}（進化前）`);
        if (/_(shadow|mega|mega_x|mega_y|primal)$/.test(sp.id)) wrong.push(`${q}→${sp.id}（メガ・シャドウ）`);
        if (EVOLVING_DEX.has(sp.dex)) wrong.push(`${q}→${sp.id}（見た目違い）`);
      }
    }
    return wrong;
  });
  await b.close();
  console.log(`表示したポケモン ${res.n}件`);
  console.log(`活躍の場の数：${Object.entries(res.counts).sort().map(([k, v]) => `${k}=${v}`).join(' ')} ／ 未解禁メガ🔮 ${res.gap}件`);
  console.log(`エラー・おかしな表示：${res.bad.length}件 ${res.bad.slice(0, 10).join(' / ')}`);
  console.log(`活躍の場が空：${res.noAct.length}件 ${res.noAct.slice(0, 10).join(',')}`);
  console.log(`育成難易度の★が無い：${res.noDiff.length}件 ${res.noDiff.slice(0, 10).join(',')}`);
  console.log(`英語のまま：${Object.entries(res.english).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w, n]) => `${w}(${n})`).join(' ')}`);
  console.log(`候補に最終進化以外：${sugg.length}件 ${sugg.slice(0, 10).join(' / ')}`);
  console.log(`JavaScriptエラー：${errors.length}件 ${errors.slice(0, 3).join(' / ')}`);
  process.exit(res.bad.length || res.noAct.length || sugg.length || errors.length ? 1 : 0);
})();
