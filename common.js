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
