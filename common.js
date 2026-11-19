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


// ===== イベント名の翻訳（index.html と spawns.html で使う） =====
const MONTHS = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
const MONTH_RE = "(" + Object.keys(MONTHS).join("|") + ")";
const METEORS = {
  "Leonids":"しし座流星群","Geminids":"ふたご座流星群","Perseids":"ペルセウス座流星群","Quadrantids":"しぶんぎ座流星群",
  "Lyrids":"4月こと座流星群","Orionids":"オリオン座流星群","Draconids":"10月りゅう座流星群","Taurids":"おうし座流星群",
  "Eta Aquariids":"みずがめ座η流星群","Southern Delta Aquariids":"みずがめ座δ南流星群","Ursids":"こぐま座流星群",
};
const CITIES = {"Global":"グローバル","Los Angeles":"ロサンゼルス","Kaohsiung":"高雄","New Taipei City":"新北","Taipei":"台北","Osaka":"大阪","Tokyo":"東京","Yokohama":"横浜","Sapporo":"札幌","Fukuoka":"福岡","Sendai":"仙台","Seoul":"ソウル","Paris":"パリ","London":"ロンドン","Madrid":"マドリード","Jersey City":"ジャージーシティ","New York City":"ニューヨーク"};
const LEAGUES = [
  [/\bGreat League\b/g,"スーパーリーグ"],[/\bUltra League\b/g,"ハイパーリーグ"],[/\bMaster League\b/g,"マスターリーグ"],
  [/\bLittle Cup\b/g,"リトルカップ"],[/\bLittle League\b/g,"リトルリーグ"],
];

const NAME_RULES = [
  [/^(.+?) Raid Hour$/, (a)=>`${jaMons(a)} レイドアワー`],
  [/^(.+?) Spotlight Hour$/, (a)=>`${jaMons(a)} スポットライトアワー`],
  [/^(.+?) in (\d)-star Raid Battles$/, (a,n)=>`★${n}レイド：${jaMons(a)}`],
  [/^(.+?) in Mega Raids$/, (a)=>`メガレイド：${jaMons(a)}`],
  [/^(.+?) in Super Mega Raids$/, (a)=>`スーパーメガレイド：${jaMons(a)}`],
  [/^(.+?) in Shadow Raids$/, (a)=>`シャドウレイド：${jaMons(a)}`],
  [/^(.+?) in Elite Raids$/, (a)=>`エリートレイド：${jaMons(a)}`],
  [/^(.+?) in Max Battles$/, (a)=>`マックスバトル：${jaMons(a)}`],
  [/^(.+?) during Max Monday$/, (a)=>`マックスマンデー：${jaMons(a)}`],
  [/^Max Monday$/, ()=>"マックスマンデー"],
  [new RegExp("^" + MONTH_RE + " Community Day Classic$"), (m)=>`${MONTHS[m]}月のコミュニティ・デイ クラシック`],
  [new RegExp("^" + MONTH_RE + " Community Day$"), (m)=>`${MONTHS[m]}月のコミュニティ・デイ`],
  [/^(.+?) Community Day Classic$/, (a)=>`コミュニティ・デイ クラシック：${jaMons(a)}`],
  [/^(.+?) Community Day$/, (a)=>`コミュニティ・デイ：${jaMons(a)}`],
  [/^Super Mega Raid Day$/, ()=>"スーパーメガレイド・デイ"],
  [/^(.+?) Super Mega Raid Day$/, (a)=>`スーパーメガレイド・デイ：${jaMons(a)}`],
  [/^Raid Day$/, ()=>"レイド・デイ"],
  [/^(.+?) Raid Day$/, (a)=>`レイド・デイ：${jaMons(a)}`],
  [/^Max Battle Day$/, ()=>"マックスバトル・デイ"],
  [/^(.+?) Max Battle Day$/, (a)=>`マックスバトル・デイ：${jaMons(a)}`],
  [/^Hatch Day$/, ()=>"ハッチデイ"],
  [/^(.+?) Hatch Day$/, (a)=>`ハッチデイ：${jaMons(a)}`],
  [/^Research Day$/, ()=>"リサーチデイ"],
  [/^(.+?) Research Day$/, (a)=>`リサーチデイ：${jaMons(a)}`],
  [new RegExp("^GO Pass: " + MONTH_RE + "$"), (m)=>`GOパス：${MONTHS[m]}月`],
  [/^Minior Showers: (.+?)(?: (\d{4}))?$/, (a,y)=>`メテノシャワー：${METEORS[a] || a}${y ? " " + y : ""}`],
  [/^Pokémon GO Wild Area (\d{4}): (.+)$/, (y,l)=>`GO Wild Area ${y}：${l === "Global" ? "グローバル" : l}`],
  [/^Pokémon GO Tour: (.+?) - (.+?) (\d{4})$/, (a,c,y)=>`Pokémon GO Tour：${a}（${CITIES[c] || c}） ${y}`],
  [/^(.+?) Timed Research$/, (a)=>`期間限定リサーチ：${jaMons(a)}`],
  [/^(.+?) Special Research$/, (a)=>`スペシャルリサーチ：${jaMons(a)}`],
  [/^(.+?) Returns$/, (a)=>`${jaMons(a)} 再登場`],
];
function translateName(ev){
  let s = ev.name.replace(/^\s*\[(?:Canceled|Cancelled)\]\s*/i, "").trim();
  if (ev.type === "go-battle-league"){
    s = s.replace(/\s*\|\s*[^|]*$/, ""); // 末尾の「| シーズン名」を除去
    for (const [re, ja] of LEAGUES) s = s.replace(re, ja);
    s = s.replace(/,? and /g, "、").replace(/, /g, "、");
    return s;
  }
  for (const [re, fn] of NAME_RULES){
    const m = s.match(re);
    if (m) return fn(...m.slice(1));
  }
  return jaMons(s);
}


// 出会えると人気・貴重なポケモン（このアプリの判断。ドラゴン系の進化前、化石、ラプラスなど）
const PRIZE_MONS = new Set(["Dratini","Larvitar","Bagon","Beldum","Gible","Axew","Deino","Goomy","Jangmo-o","Frigibax","Dreepy",
  "Lapras","Snorlax","Aerodactyl","Omanyte","Kabuto","Lileep","Anorith","Cranidos","Shieldon","Tirtouga","Archen","Tyrunt","Amaura",
  "Spinda","Ditto","Riolu","Feebas","Scyther","Chansey","Togepi","Ralts","Mawile"]);
