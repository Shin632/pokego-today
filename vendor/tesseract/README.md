# 文字の読み取り（ボックス判定のスクショ読み取り用）

ブラウザの中だけで画像の文字を読み取るための部品です。画像は外部に送りません。

- `tesseract.min.js` `worker.min.js`：Tesseract.js 5.1.1（Apache License 2.0、LICENSE-tesseract.js.md）
- `tesseract-core-*.wasm.js`：tesseract.js-core（Apache License 2.0、LICENSE-tesseract.js-core）
- `lang/jpn.traineddata.gz`：日本語の学習データ（@tesseract.js-data/jpn 4.0.0_best_int、元は tesseract-ocr/tessdata（Apache License 2.0））

npm から取得したものをそのまま置いています。
