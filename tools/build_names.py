#!/usr/bin/env python3
"""index.html に埋め込むポケモン名辞書（英語→日本語）を更新する。

使い方:
  curl -sSLo names.csv https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv
  python3 tools/build_names.py names.csv names-ja.js
"""
import csv
import json
import re
import sys

EN, JA = "9", "1"  # PokeAPI の local_language_id（9=英語, 1=日本語カナ）


def main(csv_path, html_path):
    en, ja = {}, {}
    with open(csv_path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["local_language_id"] == EN:
                en[r["pokemon_species_id"]] = r["name"]
            elif r["local_language_id"] == JA:
                ja[r["pokemon_species_id"]] = r["name"]
    names = {en[k]: ja[k] for k in en if k in ja}
    # 表記ゆれ（’ と '、♀♂ の英字表記）
    for k, v in list(names.items()):
        if "’" in k:
            names[k.replace("’", "'")] = v
    if "Nidoran♀" in names:
        names["Nidoran (Female)"] = names["Nidoran♀"]
    if "Nidoran♂" in names:
        names["Nidoran (Male)"] = names["Nidoran♂"]
    blob = json.dumps(names, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    with open(html_path, encoding="utf-8") as f:
        html = f.read()
    new, n = re.subn(r"/\*NAMES-BEGIN\*/.*?/\*NAMES-END\*/",
                     lambda _: "/*NAMES-BEGIN*/" + blob + "/*NAMES-END*/", html, flags=re.S)
    if n != 1:
        sys.exit("マーカー /*NAMES-BEGIN*/ ... /*NAMES-END*/ が見つかりません")
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(new)
    print(f"{len(names)} 件の名前を書き込みました")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
