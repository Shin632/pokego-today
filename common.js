/* 2ページ共通の小さな関数（ポケモン名の日本語化など） */
"use strict";
const PREFIXES = {
  "Gigantamax":"キョダイマックス","Dynamax":"ダイマックス","Eternamax":"ムゲンダイマックス","Mega":"メガ",
  "Shadow":"シャドウ","Primal":"ゲンシ","Alolan":"アローラ","Galarian":"ガラル","Hisuian":"ヒスイ","Paldean":"パルデア",
  "Shiny":"色違い",
};
const FORM_WORDS = {
  "Normal":"ノーマル","Attack":"アタック","Defense":"ディフェンス","Speed":"スピード","Incarnate":"けしん","Therian":"れいじゅう",
  "Origin":"オリジン","Altered":"アナザー","Forme":"フォルム","Formes":"フォルム","Form":"フォルム","Forms":"フォルム",
  "Male":"オス","Female":"メス","Land":"ランド","Sky":"スカイ","Aria":"ボイス","Pirouette":"ステップ",
  "Hero":"ナイーブ","Crowned":"けんのおう","Sword":"けん","Shield":"たて","Ordinary":"いつも","Resolute":"かくご",
  "Dawn Wings":"あかつきのつばさ","Dusk Mane":"たそがれのたてがみ","Ultra":"ウルトラ",
  "Black":"ブラック","White":"ホワイト","Kyurem":"キュレム",
};
function escRe(s){return s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");}
let MON_RE = null;
function buildMonRe(){
  const names = Object.keys(POKE_JA).sort((a,b)=>b.length-a.length).map(escRe);
  if (!names.length) return null;
  const pre = Object.keys(PREFIXES).join("|");
  // (先頭 or 英字以外)(接頭辞 )?(ポケモン名)( X/Y)?(英字以外 or 末尾)
  return new RegExp("(^|[^A-Za-z])(?:(" + pre + ") )?(" + names.join("|") + ")(?: ([XY]))?(?=[^A-Za-z]|$)", "g");
}
/** 英語の文字列中のポケモン名・フォルム・接続語を日本語化 */
function jaMons(s){
  if (!s) return s;
  if (MON_RE === null) MON_RE = buildMonRe() || /$^/;
  let out = s.replace(MON_RE, (m, lead, pre, name, xy) => {
    let ja = POKE_JA[name] || name;
    if (pre) ja = PREFIXES[pre] + ja;
    if (xy) ja += xy;
    return lead + ja;
  });
  // (Normal, Defense, Attack, and Speed Formes) → （ノーマル・ディフェンス・アタック・スピードフォルム）
  out = out.replace(/\(([^()]*)\)/g, (m, inner) => {
    let t = inner;
    const keys = Object.keys(FORM_WORDS).sort((a,b)=>b.length-a.length);
    let changed = false;
    for (const k of keys){
      const re = new RegExp("\\b" + escRe(k) + "\\b", "g");
      if (re.test(t)){ t = t.replace(re, FORM_WORDS[k]); changed = true; }
    }
    if (!changed) return m;
    t = t.replace(/,? and /g, "・").replace(/, /g, "・").replace(/\s+(?=フォルム)/g, "").replace(/(\S)\s+(?=\S)/g, "$1");
    return "\u0000（" + t + "）";
  });
  out = out.replace(/\s*\u0000/g, ""); // 「名前 （フォルム）」の空白を詰める
  // 日本語化された名前の間の and / , を「・」に
  out = out.replace(/([぀-ヿ一-鿿）XY2]),? and (?=[぀-ヿ一-鿿])/g, "$1・")
           .replace(/([぀-ヿ一-鿿）]), (?=[぀-ヿ一-鿿])/g, "$1・");
  return out;
}
function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function safeUrl(u){
  try { const x = new URL(u); return x.protocol === "https:" ? x.href : null; } catch { return null; }
}
const WD = ["日","月","火","水","木","金","土"];
const pad = (n)=>String(n).padStart(2,"0");
const fmtT = (d)=>`${d.getHours()}:${pad(d.getMinutes())}`;
const fmtD = (d)=>`${d.getMonth()+1}/${d.getDate()}(${WD[d.getDay()]})`;

// フォルム名（英語の括弧書き → 日本語）
const FORMS = {
  "Shadow": ["pre", "シャドウ"], "Mega": ["pre", "メガ"], "Primal": ["pre", "ゲンシ"],
  "Mega X": ["prepost", "メガ", "X"], "Mega Y": ["prepost", "メガ", "Y"],
  "Black": ["pre", "ブラック"], "White": ["pre", "ホワイト"],
  "Alolan": ["suf", "アローラ"], "Galarian": ["suf", "ガラル"], "Hisuian": ["suf", "ヒスイ"], "Paldean": ["suf", "パルデア"],
  "Galarian Standard": ["suf", "ガラル"], "Standard": ["drop"],
  "Origin": ["suf", "オリジンフォルム"], "Altered": ["suf", "アナザーフォルム"], "Incarnate": ["suf", "けしんフォルム"], "Therian": ["suf", "れいじゅうフォルム"],
  "Dawn Wings": ["suf", "あかつきのつばさ"], "Dusk Mane": ["suf", "たそがれのたてがみ"],
  "Crowned Sword": ["suf", "けんのおう"], "Crowned Shield": ["suf", "たてのおう"],
  "Resolute": ["suf", "かくごのすがた"], "Ordinary": ["suf", "いつものすがた"],
  "Burn": ["suf", "ブレイズカセット"], "Chill": ["suf", "フリーズカセット"], "Douse": ["suf", "アクアカセット"], "Shock": ["suf", "イナズマカセット"],
  "Unbound": ["suf", "ときはなたれし"], "Land": ["suf", "ランドフォルム"], "Sky": ["suf", "スカイフォルム"], "Aria": ["suf", "ボイスフォルム"],
  "Rapid Strike": ["suf", "れんげきのかた"], "Single Strike": ["suf", "いちげきのかた"],
};
/** PvPoke の名前（"Charizard (Mega X)" "Tornadus (Incarnate) (Shadow)" など）を日本語に */
function nameJa(en){
  const m = String(en).match(/^([^(]+?)\s*((?:\([^)]*\)\s*)*)$/);
  if (!m) return jaMons(en);
  const base = m[1].trim();
  let ja = (typeof POKE_JA !== "undefined" && POKE_JA[base]) || base, pre = "", post = "", suf = [];
  for (const g of m[2].match(/\(([^)]*)\)/g) || []){
    const k = g.slice(1, -1), f = FORMS[k];
    if (!f) suf.push(k);
    else if (f[0] === "pre") pre = f[1] + pre;
    else if (f[0] === "prepost"){ pre = f[1] + pre; post = f[2]; }
    else if (f[0] === "suf") suf.push(f[1]);
  }
  // 「シャドウ」は「メガ」「ゲンシ」より前に来ないので、シャドウ＋リージョンは「シャドウ〇〇（アローラ）」
  return pre + ja + post + (suf.length ? `（${suf.join("・")}）` : "");
}

