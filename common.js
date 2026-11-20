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
const fmtD = (d)=>`${d.getMonth()+1}/${d.getDate()}(${WD[d.getDay()]}${jpHoliday(d) ? "・祝" : ""})`;

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
  // ポワルン・デオキシス・ミノムッチ／ミノマダム・チェリム・ロトムなど
  "Rainy": ["suf", "あまみずのすがた"], "Snowy": ["suf", "ゆきぐものすがた"], "Sunny": ["suf", "たいようのすがた"],
  "Attack": ["suf", "アタックフォルム"], "Defense": ["suf", "ディフェンスフォルム"], "Speed": ["suf", "スピードフォルム"], "Normal": ["suf", "ノーマルフォルム"],
  "Plant": ["suf", "くさきのミノ"], "Sandy": ["suf", "すなちのミノ"], "Trash": ["suf", "ゴミのミノ"],
  "Overcast": ["suf", "ネガフォルム"], "Sunshine": ["suf", "ポジフォルム"],
  "Fan": ["pre", "スピン"], "Frost": ["pre", "フロスト"], "Heat": ["pre", "ヒート"], "Mow": ["pre", "カット"], "Wash": ["pre", "ウォッシュ"],
  "Female": ["suf", "メスのすがた"], "Male": ["suf", "オスのすがた"],
  "Shield": ["suf", "シールドフォルム"], "Blade": ["suf", "ブレードフォルム"],
  "Super": ["suf", "とくだいサイズ"], "Large": ["suf", "おおきいサイズ"], "Small": ["suf", "ちいさいサイズ"], "Average": ["suf", "ふつうのサイズ"],
  "10% Forme": ["suf", "10%フォルム"], "50% Forme": ["suf", "50%フォルム"], "Complete Forme": ["suf", "パーフェクトフォルム"],
  "Baile": ["suf", "めらめらスタイル"], "Pa'u": ["suf", "ふらふらスタイル"], "Pom-Pom": ["suf", "ぱちぱちスタイル"], "Sensu": ["suf", "まいまいスタイル"],
  "Dusk": ["suf", "たそがれのすがた"], "Midday": ["suf", "まひるのすがた"], "Midnight": ["suf", "まよなかのすがた"],
  "Core": ["suf", "コアのすがた"], "Meteor": ["suf", "りゅうせいのすがた"], "Full Belly": ["suf", "まんぷくもよう"], "Hangry": ["suf", "はらぺこもよう"],
  "Hero": ["suf", "れきせんのゆうしゃ"], "Armored": ["pre", "アーマード"],
  "Aqua": ["suf", "ウォーター種"], "Blaze": ["suf", "ブレイズ種"], "Combat": ["suf", "コンバット種"],
  "Curly": ["suf", "そったすがた"], "Droopy": ["suf", "たれたすがた"], "Stretchy": ["suf", "のびたすがた"],
  // ピカチュウのコスチューム
  "Libre": ["suf", "マスクド"], "Pop Star": ["suf", "ポップスター"], "Rock Star": ["suf", "ハードロック"], "Flying": ["suf", "そらとぶピカチュウ"],
  "5th Anniversary": ["suf", "5周年"], "Horizons": ["suf", "ホライズン"], "Kariyushi": ["suf", "かりゆし"], "Shaymin Scarf": ["suf", "シェイミのスカーフ"],
};
// 名前全体で置き換えるもの
const NAME_ALIAS = {"Mime (Jr)": "マネネ"};
/** PvPoke の名前（"Charizard (Mega X)" "Tornadus (Incarnate) (Shadow)" など）を日本語に */
function nameJa(en){
  if (NAME_ALIAS[en]) return NAME_ALIAS[en];
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
// イベント名によく出る英語の言葉（公式の日本語名が分からないものは、仮のカタカナ表記）。長いものから順に置き換える
const EVENT_WORDS = [
  [/\bGO Wild Area\b/g, "GOワイルドエリア"], [/\bPower Up!/g, "パワーアップ！"],
  [/\bDynamax Trails\b/g, "ダイマックス・トレイル"], [/\bTwilight Trails\b/g, "トワイライト・トレイル"], [/\bTwilight Wishes\b/g, "トワイライト・ウィッシュ"],
  [/:\s*Mega Edition\b/g, "（メガエディション）"], [/\bMega Catch Cup\b/g, "メガキャッチカップ"], [/\s*\bEdition\b/g, "エディション"], [/\bCup\b/g, "カップ"],
  [/\bPok[eé]mon GO and (\w+)/g, "ポケモンGO × $1"], [/\bPok[eé]mon GO(?! Tour)\b/g, "ポケモンGO"], [/\bPok[eé]mon(?! GO)/g, "ポケモン"],
  [/\bAlola\b/g, "アローラ"], [/\bTwilight\b/g, "トワイライト"], [/\bTrails\b/g, "トレイル"], [/\bWishes\b/g, "ウィッシュ"], [/\bDynamax\b/g, "ダイマックス"],
];
function eventWordsJa(s){ for (const [re, ja] of EVENT_WORDS) s = s.replace(re, ja); return s.replace(/([^\x00-\x7F]): /g, "$1："); }
function translateName(ev){
  let s = ev.name.replace(/^\s*\[(?:Canceled|Cancelled)\]\s*/i, "").trim();
  if (ev.type === "go-battle-league"){
    s = s.replace(/\s*\|\s*[^|]*$/, ""); // 末尾の「| シーズン名」を除去
    for (const [re, ja] of LEAGUES) s = s.replace(re, ja);
    s = s.replace(/,? and /g, "、").replace(/, /g, "、");
    return eventWordsJa(s);
  }
  for (const [re, fn] of NAME_RULES){
    const m = s.match(re);
    if (m) return eventWordsJa(fn(...m.slice(1)));
  }
  return eventWordsJa(jaMons(s));
}


// 出会えると人気・貴重なポケモン（このアプリの判断。ドラゴン系の進化前、化石、ラプラスなど）
const PRIZE_MONS = new Set(["Dratini","Larvitar","Bagon","Beldum","Gible","Axew","Deino","Goomy","Jangmo-o","Frigibax","Dreepy",
  "Lapras","Snorlax","Aerodactyl","Omanyte","Kabuto","Lileep","Anorith","Cranidos","Shieldon","Tirtouga","Archen","Tyrunt","Amaura",
  "Spinda","Ditto","Riolu","Feebas","Scyther","Chansey","Togepi","Ralts","Mawile"]);

// ===== フィールドリサーチのタスク文の翻訳（research.html と search.html で使う） =====
const TYPES_JA = {Normal:"ノーマル",Fire:"ほのお",Water:"みず",Grass:"くさ",Electric:"でんき",Ice:"こおり",Fighting:"かくとう",Poison:"どく",
  Ground:"じめん",Flying:"ひこう",Psychic:"エスパー",Bug:"むし",Rock:"いわ",Ghost:"ゴースト",Dragon:"ドラゴン",Dark:"あく",Steel:"はがね",Fairy:"フェアリー"};
const THROWS = {Nice:"ナイス",Great:"グレート",Excellent:"エクセレント"};
const STARS = {one:1,two:2,three:3,four:4,five:5,six:6};
const N = (w) => /^an?$/i.test(w) ? 1 : w;
const row = (r) => r ? "連続で" : "";
const TASK_RULES = [
  [/^Catch (\d+|an?) Pokémon$/i, (n) => `ポケモンを${N(n)}匹捕まえる`],
  [/^Catch (\d+|an?) (\w+)- or (\w+)-type Pokémon$/i, (n, a, b) => `${TYPES_JA[a] || a}か${TYPES_JA[b] || b}タイプのポケモンを${N(n)}匹捕まえる`],
  [/^Catch (\d+|an?) (\w+)-type Pokémon$/i, (n, t) => `${TYPES_JA[t] || t}タイプのポケモンを${N(n)}匹捕まえる`],
  [/^Catch (\d+) different species of Pokémon$/i, (n) => `ちがう種類のポケモンを${n}匹捕まえる`],
  [/^Catch (\d+|an?) Pokémon with Weather Boost$/i, (n) => `天候ブーストされたポケモンを${N(n)}匹捕まえる`],
  [/^Catch (\d+|an?) Shadow Pokémon$/i, (n) => `シャドウポケモンを${N(n)}匹捕まえる`],
  [/^Use (\d+|an?) Berr(?:y|ies) to help catch Pokémon$/i, (n) => `きのみを${N(n)}個使ってポケモンを捕まえる`],
  [/^Make (\d+|an?) (Nice|Great|Excellent) Curveball Throws?( in a row)?$/i, (n, t, r) => `${THROWS[t]}カーブボールを${N(n)}回${row(r)}投げる`],
  [/^Make (\d+|an?) (Nice|Great|Excellent) Throws?( in a row)?$/i, (n, t, r) => `${THROWS[t]}スローを${N(n)}回${row(r)}投げる`],
  [/^Make (\d+|an?) Curveball Throws?( in a row)?$/i, (n, r) => `カーブボールを${N(n)}回${row(r)}投げる`],
  [/^Battle in (\d+|an?) raids?$/i, (n) => `レイドバトルに${N(n)}回参加する`],
  [/^Win (\d+|an?) raids?$/i, (n) => `レイドバトルに${N(n)}回勝つ`],
  [/^Win an? (\w+)-star raid or higher$/i, (s) => `★${STARS[s.toLowerCase()] || s}以上のレイドバトルに勝つ`],
  [/^Win (\d+|an?) Max Battles?$/i, (n) => `マックスバトルに${N(n)}回勝つ`],
  [/^Battle in (\d+|an?) Max Battles?$/i, (n) => `マックスバトルに${N(n)}回参加する`],
  [/^Unlock (\d+|an?) Max Moves?$/i, (n) => `マックスわざを${N(n)}回解放する`],
  [/^Defeat (\d+|an?) Team GO Rocket Grunts?$/i, (n) => `GOロケット団のしたっぱに${N(n)}回勝つ`],
  [/^Earn (\d+) Stardust$/i, (n) => `ほしのすなを${n}集める`],
  [/^Earn (\d+) XP$/i, (n) => `XPを${n}獲得する`],
  [/^Earn (\d+|an?) Cand(?:y|ies) walking with your buddy$/i, (n) => `相棒と歩いてアメを${N(n)}個見つける`],
  [/^Explore (\d+(?:\.\d+)?) km$/i, (n) => `${n}km歩く`],
  [/^Hatch (\d+|an?) Eggs?$/i, (n) => `タマゴを${N(n)}個かえす`],
  [/^Spin (\d+|an?) PokéStops? or Gyms?$/i, (n) => `ポケストップかジムを${N(n)}回まわす`],
  [/^Spin (\d+|an?) PokéStops?$/i, (n) => `ポケストップを${N(n)}回まわす`],
  [/^Take a snapshot of a wild Pokémon$/i, () => "野生のポケモンのGOスナップショットを撮る"],
  [/^Take (\d+|an?) snapshots? of (.+)$/i, (n, w) => `${jaMons(w)}のGOスナップショットを${N(n)}回撮る`],
  [/^Evolve (\d+|an?) Pokémon$/i, (n) => `ポケモンを${N(n)}匹進化させる`],
  [/^Power up Pokémon (\d+) times$/i, (n) => `ポケモンを${n}回強化する`],
  [/^Send (\d+|an?) Gifts? and add a sticker to each$/i, (n) => `ステッカーを付けてギフトを${N(n)}個送る`],
  [/^Send (\d+|an?) Gifts? to friends$/i, (n) => `フレンドにギフトを${N(n)}個送る`],
  [/^Trade (\d+|an?) Pokémon$/i, (n) => `ポケモンを${N(n)}回交換する`],
  [/^Purify (\d+|an?) Shadow Pokémon$/i, (n) => `シャドウポケモンを${N(n)}匹リトレーンする`],
  [/^Mega Evolve (\d+|an?) Pokémon$/i, (n) => `ポケモンを${N(n)}回メガシンカさせる`],
  [/^Transfer (\d+|an?) Pokémon$/i, (n) => `ポケモンを${N(n)}匹博士に送る`],
  [/^Battle in the GO Battle League (\d+) times$/i, (n) => `GOバトルリーグで${n}回対戦する`],
  [/^Win (\d+|an?) battles? in the GO Battle League$/i, (n) => `GOバトルリーグで${N(n)}回勝つ`],
  [/^Use (\d+|an?) supereffective Charged Attacks?.*$/i, (n) => `効果ばつぐんのスペシャルアタックを${N(n)}回使う`],
  [/^Play with your buddy (\d+) times$/i, (n) => `相棒と${n}回遊ぶ`],
  [/^Give your buddy (\d+|an?) treats?$/i, (n) => `相棒におやつを${N(n)}回あげる`],
  [/^Earn (\d+|an?) hearts? with your buddy$/i, (n) => `相棒とハートを${N(n)}個ためる`],
  [/^Catch (\d+|an?) (.+)$/i, (n, w) => { const j = jaMons(w); return j !== w ? `${j}を${N(n)}匹捕まえる` : null; }],
];
function translateTask(t){
  const s = String(t || "").trim();
  for (const [re, fn] of TASK_RULES){ const m = s.match(re); if (m){ const r = fn(...m.slice(1)); if (r) return {ja: r, ok: true}; } }
  return {ja: jaMons(s), ok: false};
}


// ===== 電波がないときのための保存（前回取れたデータを使う） =====
/** ブラウザに保存したデータを読む（壊れていたら null） */
function cacheGet(key){ try { return JSON.parse(localStorage.getItem(key) || "null"); } catch { return null; } }
/** ブラウザに保存する（容量いっぱいなどで保存できなくても止めない） */
function cacheSet(key, v){ try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } }
/**
 * データを取りに行き、取れたら保存。取れなければ前回保存した分を返す。
 * fetcher: () => Promise<data>、valid: data → true/false（形が正しいか）、unwrap: 保存した形 → data（他ページと保存の形が違うとき用）
 * 戻り値：{data, cached（前回の分を使ったか）}
 */
async function fetchWithCache(key, fetcher, valid, unwrap = (x) => x, wrap = (x) => x){
  try {
    const d = await fetcher();
    if (valid(d)){ cacheSet(key, wrap(d)); return {data: d, cached: false}; }
  } catch {}
  const c = unwrap(cacheGet(key));
  return c && valid(c) ? {data: c, cached: true} : {data: null, cached: false};
}

// ===== タイプの札の文字色：背景色に対して読みやすいほう（白か黒）を選ぶ =====
function luminance(hex){
  const m = String(hex || "").match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0.2;
  const v = m.slice(1).map(x => { const c = parseInt(x, 16) / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
/** 背景色 hex に対して、白と黒（#1a1a1a）のうちコントラスト比が高いほう */
function typeFg(hex){
  const l = luminance(hex);
  return 1.05 / (l + 0.05) >= (l + 0.05) / (0.0103 + 0.05) ? "#fff" : "#1a1a1a";
}

// ===== データが古いときの注意（取得元が止まっていると気づけないため） =====
/** date（データを作った日時）から hours 時間以上たっていたら、id="stale" の欄に注意を出す。what＝何のデータか */
function staleText(date, hours, what){
  const d = date ? new Date(date) : null;
  if (!d || isNaN(d)) return "";
  const h = (Date.now() - d.getTime()) / 3600000;
  if (h < hours) return "";
  const ago = h >= 48 ? `${Math.floor(h / 24)}日` : `${Math.floor(h)}時間`;
  return `${what}が${ago}ほど更新されていません（最終：${fmtD(d)} ${fmtT(d)}）。データの取得元が止まっている可能性があり、内容が古いかもしれません。`;
}
function showStale(msgs){
  const el = document.getElementById("stale"); if (!el) return;
  const list = (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean);
  el.innerHTML = list.length ? `<div class="notice">⚠️ ${list.join("<br>⚠️ ")}</div>` : "";
}

// ===== 日本の祝日（振替休日・国民の休日を含む）。春分・秋分の日は計算式（1980〜2099年で使える近似式） =====
function jpHolidayBase(y, m, d){
  const dow = new Date(y, m - 1, d).getDay();
  const nthMon = (n) => dow === 1 && Math.ceil(d / 7) === n;
  const k = y - 1980;
  const spring = Math.floor(20.8431 + 0.242194 * k - Math.floor(k / 4));
  const autumn = Math.floor(23.2488 + 0.242194 * k - Math.floor(k / 4));
  if (m === 1 && d === 1) return "元日";
  if (m === 1 && nthMon(2)) return "成人の日";
  if (m === 2 && d === 11) return "建国記念の日";
  if (m === 2 && d === 23) return "天皇誕生日";
  if (m === 3 && d === spring) return "春分の日";
  if (m === 4 && d === 29) return "昭和の日";
  if (m === 5 && d === 3) return "憲法記念日";
  if (m === 5 && d === 4) return "みどりの日";
  if (m === 5 && d === 5) return "こどもの日";
  if (m === 7 && nthMon(3)) return "海の日";
  if (m === 8 && d === 11) return "山の日";
  if (m === 9 && nthMon(3)) return "敬老の日";
  if (m === 9 && d === autumn) return "秋分の日";
  if (m === 10 && nthMon(2)) return "スポーツの日";
  if (m === 11 && d === 3) return "文化の日";
  if (m === 11 && d === 23) return "勤労感謝の日";
  return "";
}
/** Date → 祝日名（祝日でなければ ""） */
function jpHoliday(date){
  const y = date.getFullYear(), m = date.getMonth() + 1, d = date.getDate();
  const base = jpHolidayBase(y, m, d);
  if (base) return base;
  // 振替休日：日曜の祝日のあと、祝日でない最初の日
  for (let i = 1; i <= 7; i++){
    const p = new Date(y, m - 1, d - i);
    if (!jpHolidayBase(p.getFullYear(), p.getMonth() + 1, p.getDate())) break;
    if (p.getDay() === 0) return "振替休日";
  }
  // 国民の休日：前の日と次の日が祝日にはさまれた平日
  const prev = new Date(y, m - 1, d - 1), next = new Date(y, m - 1, d + 1);
  if (date.getDay() !== 0 && jpHolidayBase(prev.getFullYear(), prev.getMonth() + 1, prev.getDate()) && jpHolidayBase(next.getFullYear(), next.getMonth() + 1, next.getDate())) return "国民の休日";
  return "";
}
