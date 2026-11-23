#!/usr/bin/env bash
# テストで使う最新データを tests/.cache に取ってくる（公開データと同じもの）
set -u
cd "$(dirname "$0")"
mkdir -p .cache
D=https://raw.githubusercontent.com/Shin632/pokego-today/data
S=https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data
for f in bonuses research rankings megas raids pokedex gbl; do
  curl -fsS -o ".cache/$f.json" "$D/$f.json?t=$(date +%s)" || echo "取得失敗: $f"
done
curl -fsS -o .cache/sd_events.json "$S/events.json" || echo "取得失敗: events"
curl -fsS -o .cache/sd_research.json "$S/research.json" || echo "取得失敗: sd research"
ls -la .cache
