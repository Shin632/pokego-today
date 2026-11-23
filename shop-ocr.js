/* ボックス判定：ショップ画面のスクリーンショットから、ボックスの名前・中身・値段を読み取る
 * 文字の読み取りは Tesseract.js（vendor/tesseract）をブラウザの中で動かす。画像は外部に送らない。
 * parseBoxText() は読み取った文字だけを使うので、単体でテストできる。 */
"use strict";

// アイテムの見つけ方（読み取りの間違いを考えて、言い方・書き方の違いもいくつか持つ）。長いものから順に調べる
const OCR_ITEMS = [
  ["remote_raid", ["リモートレイドパス", "リモートレイド"]],
  ["raid_pass", ["プレミアムバトルパス", "レイドパス", "バトルパス"]],
  ["super_incubator", ["スーパーふかそうち", "スーパー孵化装置", "スーパーフカソウチ"]],
  ["incubator", ["ふかそうち", "孵化装置", "フカソウチ"]],
  ["storage_upgrade", ["ポケモンボックスアップグレード", "ボックスアップグレード", "ポケモンボックス"]],
  ["bag_upgrade", ["バッグアップグレード", "バッグ"]],
  ["lucky_egg", ["しあわせタマゴ", "しあわせたまご", "幸せタマゴ"]],
  ["star_piece", ["ほしのかけら", "星のかけら"]],
  ["max_particles", ["マックス粒子", "マックスりゅうし"]],
  ["max_mushroom", ["ダイキノコ"]],
  ["rocket_radar", ["ロケットレーダー"]],
  ["special_lure", ["アイスルアー", "ハーブルアー", "マグネットルアー", "レイニールアー", "キラキラルアー", "ゴールデンルアー"]],
  ["lure", ["ルアーモジュール"]],
  ["incense", ["おこう", "お香"]],
  ["poffin", ["ポフィン"]],
  ["postcard", ["ポストカード"]],
  ["link_charge", ["リンクチャージ"]],
  ["rare_candy_xl", ["ふしぎなアメXL", "ふしぎなアメＸＬ"]],
  ["rare_candy", ["ふしぎなアメ"]],
  ["elite_tm", ["すごいわざマシン"]],
  ["charged_tm", ["わざマシンスペシャル", "スペシャルわざマシン"]],
  ["fast_tm", ["わざマシンノーマル", "ノーマルわざマシン"]],
  ["max_potion", ["まんたんのくすり"]],
  ["max_revive", ["げんきのかたまり"]],
  ["revive", ["げんきのかけら"]],
  ["hyper_potion", ["すごいキズぐすり"]],
  ["super_potion", ["いいキズぐすり"]],
  ["golden_razz", ["金のズリのみ", "きんのズリのみ"]],
  ["silver_pinap", ["銀のパイルのみ", "ぎんのパイルのみ"]],
  ["ultra_ball", ["ハイパーボール"]],
  ["great_ball", ["スーパーボール"]],
  ["poke_ball", ["モンスターボール"]],
  ["sticker", ["ステッカー"]],
];

/** 比べやすい形に：全角・半角をそろえ、空白・記号を取り、カタカナ・ひらがなはそのまま */
function ocrNorm(s){
  // 長音（ー）は読み取りで「-」「一」などになりやすいので「ー」にそろえる
  return String(s || "").normalize("NFKC").replace(/[\-―‐−ｰ一]/g, "ー").replace(/[\s・･.,、。:：|｜「」『』()（）\[\]［］{}<>〈〉'"`´~～]/g, "");
}
/** 2文字ずつの組の重なり（0〜1）。読み取りが少しずれていても同じ言葉だと分かるように */
function bigramSim(a, b){
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++){ const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = grams(a), B = grams(b); let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) || 0);
  return 2 * hit / (a.length - 1 + b.length - 1);
}
/** 行の中に alias が（少しずれていても）入っているか。入っていれば、その終わりの位置を返す */
function findAlias(line, alias){
  const i = line.indexOf(alias);
  if (i >= 0) return i + alias.length;
  if (alias.length < 4) return -1;   // 短い言葉は、ぴったりでないと間違えやすい
  for (let w = alias.length - 1; w <= alias.length + 1; w++){
    for (let s = 0; s + w <= line.length; s++){
      const win = line.slice(s, s + w);
      // 並び順の違う言葉（「アップグレードボックス」と「ボックスアップグレード」）を同じとみなさないよう、頭か終わりの2文字は合っていること
      if ((win.slice(0, 2) === alias.slice(0, 2) || win.slice(-2) === alias.slice(-2)) && bigramSim(win, alias) >= 0.75) return s + w;
    }
  }
  return -1;
}
const toNum = (s) => Number(String(s).normalize("NFKC").replace(/[,，\s]/g, ""));

/**
 * 読み取った文字 → {name, price, rows:[{id, qty}], notes:[]}
 * 個数は「×3」「x3」「X 3」のように書かれていることが多い。値段は、個数でも割引率でもない数字のうち、いちばん小さい2桁以上のもの
 * （割引のときは元の値段も並ぶため。無料なら 0）
 */
function parseBoxText(text){
  const lines = String(text || "").split(/\n+/).map(l => l.trim()).filter(Boolean);
  const norm = lines.map(ocrNorm);
  const rows = [], notes = [], used = new Set();
  // 1回目はぴったり一致するものだけ、2回目は（その行で何も見つからなかったときだけ）少しずれていても似ているもの
  const scan = (line, li, fuzzy) => {
    let rest = line, found = 0;
    for (const [id, aliases] of OCR_ITEMS){
      for (const al of aliases){
        const a = ocrNorm(al);
        const end = fuzzy ? findAlias(rest, a) : (rest.indexOf(a) >= 0 ? rest.indexOf(a) + a.length : -1);
        if (end < 0) continue;
        // 個数：同じ行の後ろ → 次の行の先頭 の順で「×N」を探す。無ければ1個
        const after = rest.slice(end) + " " + (norm[li + 1] || "");
        const m = after.match(/^[^0-9]{0,6}?[×xX✕✖*]\s*([0-9,]{1,5})/) || after.match(/^\s*([0-9]{1,3})(?![0-9])/);
        const qty = m ? toNum(m[1]) : 1;
        if (qty > 0 && qty < 10000){
          const ex = rows.find(r => r.id === id);
          if (ex) ex.qty = Math.max(ex.qty, qty); else rows.push({id, qty});
          used.add(li); found++;
        }
        rest = rest.slice(0, Math.max(0, end - a.length)) + "　".repeat(a.length) + rest.slice(end);   // 同じ言葉を2回数えない
        break;
      }
    }
    return found;
  };
  norm.forEach((line, li) => { if (!scan(line, li, false)) scan(line, li, true); });
  // 値段
  const free = norm.some(l => /無料|FREE|むりょう/i.test(l));
  const cands = [];
  lines.map(l => l.normalize("NFKC")).forEach((line, li) => {
    const re = /(^|[^0-9×xX✕✖*%％])([0-9]{1,3}(?:,[0-9]{3})+|[0-9]{2,5})(?![0-9%％]|km|時間|日|個|回|枚)/g;
    let m;
    while ((m = re.exec(line))){
      const before = line.slice(Math.max(0, m.index - 2), m.index + m[1].length);
      if (/[×xX✕✖*]\s*$/.test(before)) continue;
      cands.push({v: toNum(m[2]), li, item: used.has(li)});
    }
  });
  // アイテムの行の数字（個数）より、アイテムの無い行の数字を優先
  const pool = cands.filter(c => !c.item && c.v >= 10).length ? cands.filter(c => !c.item && c.v >= 10) : cands.filter(c => c.v >= 10);
  let price = free ? 0 : pool.length ? Math.min(...pool.map(c => c.v)) : null;
  if (!free && pool.length > 1) notes.push(`値段の候補が複数ありました（${[...new Set(pool.map(c => c.v))].join("、")}）。いちばん安いものにしています`);
  // 名前：「〜ボックス」「〜BOX」を含む行、なければ最初の行
  // （読み取った日本語は1文字ずつ空白が入ることがあるので、空白を除いて探す）
  // アイテムとして読んだ行（「ポケモンボックスアップグレード ×1」など）は名前にしない
  const nameIdx = norm.findIndex((l, i) => /ボックス|BOX|Box|パック|セット/i.test(l) && !used.has(i));
  const name = nameIdx >= 0 ? norm[nameIdx].replace(/[0-9,%]+[A-Za-z]*$/, "").slice(0, 30) : "";
  if (!rows.length) notes.push("中身のアイテムを読み取れませんでした");
  if (price == null) notes.push("値段を読み取れませんでした");
  return {name, price, rows, notes};
}

/** 画像（File）→ 読み取った文字。worker は使い回す */
let OCR_WORKER = null;
async function ocrWorker(onProgress){
  if (OCR_WORKER) return OCR_WORKER;
  if (typeof Tesseract === "undefined") throw new Error("文字の読み取りの部品を読み込めませんでした");
  const base = new URL("vendor/tesseract/", location.href).href;
  OCR_WORKER = await Tesseract.createWorker("jpn", 1, {
    workerPath: base + "worker.min.js", corePath: base, langPath: base + "lang", gzip: true,
    logger: (m) => onProgress && onProgress(m),
  });
  return OCR_WORKER;
}
/** 画像を読み取りやすくする：1.5倍に広げ、mode="gray" は白黒の濃淡、"bin" は白と黒の2色 */
async function prepImage(file, mode, want = 1.5, exact = false){
  const bmp = await createImageBitmap(file);
  const scale = exact ? want : Math.min(want, (want > 1.5 ? 4200 : 2600) / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  const g = c.getContext("2d");
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height), p = d.data;
  for (let i = 0; i < p.length; i += 4){
    let y = 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    if (mode === "bin") y = y > 150 ? 255 : 0;
    else if (mode === "white") y = y > 215 ? 0 : 255;   // 色の付いたボタンの上の白い文字だけを黒く残す
    p[i] = p[i + 1] = p[i + 2] = y;
  }
  g.putImageData(d, 0, 0);
  return c;
}
/** 値段用：数字は英語の学習データのほうがよく読めるので、別に用意する */
let OCR_NUM = null;
async function numWorker(){
  if (OCR_NUM) return OCR_NUM;
  const base = new URL("vendor/tesseract/", location.href).href;
  OCR_NUM = await Tesseract.createWorker("eng", 1, {workerPath: base + "worker.min.js", corePath: base, langPath: base + "lang", gzip: true});
  await OCR_NUM.setParameters({tessedit_pageseg_mode: "3", tessedit_char_whitelist: "0123456789,"});
  return OCR_NUM;
}
/** 値段：数字だけを読み、いちばん大きな文字の数字（購入ボタンの値段は大きい）を選ぶ。
 * ボタンの上の白い文字も読めるように、白黒の濃淡の画像と、白い文字だけを残した画像の両方で読む */
async function readPrice(_w, file){
  const w = await numWorker();
  const bmp = await createImageBitmap(file);
  const words = [];
  // 画像の大きさによって読めたり読めなかったりするので、縦の長さを2通りにそろえて読む（スマホのスクショは縦2000〜2800くらい）
  for (const tall of [1800, 1300]){
    const sc = tall / bmp.height;
    for (const [mode, psm] of [["gray", "3"], ["white", "6"]]){
      await w.setParameters({tessedit_pageseg_mode: psm});
      const {data} = await w.recognize(await prepImage(file, mode, sc, true), {}, {text: true, blocks: true});
      for (const bl of data.blocks || []) for (const pa of bl.paragraphs || []) for (const li of pa.lines || []) for (const x of li.words || []) words.push({...x, h0: (x.bbox.y1 - x.bbox.y0) / sc});
    }
  }
  return pickPrice(words);
}
function pickPrice(words){
  // 読み違えた数字は確信度がとても低い（0前後）ので、確信度の高いものだけを使う。大きさは元の画像での高さで比べる
  const ws = words.map(x => ({t: x.text.replace(/,/g, ""), h: x.h0 ?? (x.bbox.y1 - x.bbox.y0), conf: x.confidence}))
    .filter(x => /^[0-9]{1,5}$/.test(x.t) && x.conf >= 70);
  if (!ws.length) return null;
  // いちばん大きな文字の数字。同じくらいの大きさなら確信度の高いもの
  ws.sort((a, b) => (b.h - a.h > 3 ? 1 : a.h - b.h > 3 ? -1 : 0) || b.conf - a.conf);
  return Number(ws[0].t);
}
async function readBoxFromImage(file, onProgress){
  const w = await ocrWorker(onProgress);
  const gray = await prepImage(file, "gray"), bin = await prepImage(file, "bin");
  // 2通りの読み方で読んで、合わせる（片方で読み落としたアイテムを、もう片方で拾うため）
  await w.setParameters({tessedit_pageseg_mode: "6", tessedit_char_whitelist: ""});
  const a = (await w.recognize(gray)).data.text;
  await w.setParameters({tessedit_pageseg_mode: "3"});
  const b = (await w.recognize(bin)).data.text;
  const r = parseBoxText(a + "\n" + b);
  const free = /無料|FREE/i.test((a + b).normalize("NFKC").replace(/\s+/g, ""));
  const price = free ? 0 : await readPrice(w, file);
  if (price != null){ r.price = price; r.notes = r.notes.filter(n => !/値段/.test(n)); }
  else if (!free){ r.price = null; if (!r.notes.some(n => /値段/.test(n))) r.notes.push("値段を読み取れませんでした"); }
  return {text: a + "\n----\n" + b, ...r};
}
if (typeof module !== "undefined") module.exports = {parseBoxText, ocrNorm, bigramSim, OCR_ITEMS};
