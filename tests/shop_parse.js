// ボックス判定：読み取った文字からボックスを組み立てる処理（shop-ocr.js の parseBoxText）の単体テスト
//   node tests/shop_parse.js
// 読み取りで起こりやすいずれ（1文字ずつの空白、長音が「-」「一」になる、×が x / X / * になる、全角数字など）を含めて確かめる
const { parseBoxText } = require('../shop-ocr.js');
const cases = [
  ['ふつう', 'レイドボックス\nスーパーふかそうち ×1\nレイドパス ×3\n45%OFF\n275', {name: 'レイドボックス', price: 275, rows: {super_incubator: 1, raid_pass: 3}}],
  ['1文字ずつ空白', 'レイ ド ボ ッ クス\nスー パー ふか そう ち x1\nレイ ド パ ス x3\n275', {name: 'レイドボックス', price: 275, rows: {super_incubator: 1, raid_pass: 3}}],
  ['長音のずれ', 'アルティメットボックス\nリモ-トレイドパス ×3\nスーパ一ふかそうち ×2\n1,480', {price: 1480, rows: {remote_raid: 3, super_incubator: 2}}],
  ['全角の数字・×', 'ブーストボックス\nしあわせタマゴ×１\nほしのかけら×１\nポフィン×１\n８５', {price: 85, rows: {lucky_egg: 1, star_piece: 1, poffin: 1}}],
  ['個数が次の行', 'ハイパーレイドボックス\nプレミアムバトルパス\nx6\nいいキズぐすり\nx10\n385', {price: 385, rows: {raid_pass: 6, super_potion: 10}}],
  ['「個」で書く', 'スペシャルボックス\nレイドパス 3個\nスーパーふかそうち 1個\n480', {price: 480, rows: {raid_pass: 3, super_incubator: 1}}],
  ['無料', 'デイリーボックス\nモンスターボール ×20\n無料', {price: 0, rows: {poke_ball: 20}}],
  ['アップグレードは名前にしない', 'アップグレードボックス\nポケモンボックスアップグレード ×1\nバッグアップグレード ×1\n500', {name: 'アップグレードボックス', price: 500, rows: {storage_upgrade: 1, bag_upgrade: 1}}],
  ['ふしぎなアメXLとふしぎなアメ', 'アメボックス\nふしぎなアメXL ×2\nふしぎなアメ ×5\n600', {price: 600, rows: {rare_candy_xl: 2, rare_candy: 5}}],
  ['すごいキズぐすりといいキズぐすり', 'ボックス\nいいキズぐすり ×10\nすごいキズぐすり ×10\n200', {price: 200, rows: {super_potion: 10, hyper_potion: 10}}],
];
let pass = 0, fail = 0;
for (const [label, text, want] of cases){
  const r = parseBoxText(text);
  const rows = Object.fromEntries(r.rows.map(x => [x.id, x.qty]));
  const errs = [];
  if (want.name && r.name !== want.name) errs.push(`名前 ${r.name}`);
  if (want.price !== undefined && r.price !== want.price) errs.push(`値段 ${r.price}`);
  for (const [id, q] of Object.entries(want.rows)) if (rows[id] !== q) errs.push(`${id}=${rows[id]}`);
  for (const id of Object.keys(rows)) if (!(id in want.rows)) errs.push(`余計な ${id}`);
  if (errs.length){ fail++; console.log(`✗ ${label}: ${errs.join(' / ')}`); } else pass++;
}
console.log(`合格 ${pass} / 失敗 ${fail}`);
process.exit(fail ? 1 : 0);
