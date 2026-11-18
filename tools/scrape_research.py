#!/usr/bin/env python3
"""LeekDuck のフィールドリサーチ一覧（https://leekduck.com/research/）から、
今出ているタスクと報酬（ポケモン・アイテム両方）を集めて JSON に保存する。

  python3 tools/scrape_research.py <前回の research.json> <出力先 research.json>

失敗したときは前回の内容をそのまま書き出す（アプリ側が空にならないように）。

出力形式:
{
  "updatedAt": "...",
  "categories": [
    {"name": "Catching Tasks", "tasks": [
      {"text": "Catch 8 Pokémon", "rewards": [
        {"type": "encounter", "name": "Bulbasaur", "image": "...", "shiny": false, "cpMin": 442, "cpMax": 477, "qty": null},
        {"type": "item", "name": "Stardust", "image": "...", "qty": 500}
      ]}
    ]}
  ]
}
"""
import datetime as dt
import json
import re
import sys
import urllib.request

from bs4 import BeautifulSoup

URL = "https://leekduck.com/research/"
UA = "Mozilla/5.0 (compatible; pokego-today-research-collector/1.0)"


def clean(text):
    return " ".join((text or "").split())


def to_int(text):
    m = re.search(r"\d[\d,]*", text or "")
    return int(m.group(0).replace(",", "")) if m else None


def parse_reward(r):
    rtype = r.get("data-reward-type") or ""
    label_el = r.select_one(".reward-label")
    span = label_el.select_one("span") if label_el else None
    name = clean((span or label_el).get_text(" ")) if (span or label_el) else ""
    img_el = r.select_one(".reward-image") or r.select_one("img")
    image = img_el.get("src") if img_el else None
    if image and image.startswith("/"):
        image = "https://leekduck.com" + image
    qty = None
    q_el = r.select_one("[class*=quantity]") or r.select_one("[class*=amount]") or r.select_one("[class*=count]")
    if q_el:
        qty = to_int(q_el.get_text())
    raw = clean(r.get_text(" "))
    if qty is None and rtype != "encounter":
        m = re.search(r"[×x]\s*(\d[\d,]*)", raw)
        if m:
            qty = int(m.group(1).replace(",", ""))
    if not name and img_el is not None:
        name = clean(img_el.get("alt") or img_el.get("title") or "")
    min_el, max_el = r.select_one(".min-cp"), r.select_one(".max-cp")
    reward = {
        "type": rtype or ("encounter" if min_el else "item"),
        "name": name,
        "image": image,
        "shiny": r.select_one(".shiny-icon") is not None,
        "cpMin": to_int(min_el.get_text()) if min_el else None,
        "cpMax": to_int(max_el.get_text()) if max_el else None,
        "qty": qty,
    }
    # 名前に数量が混ざっている場合（例: "×500 Stardust"）は分ける
    m = re.match(r"^[×x]\s*(\d[\d,]*)\s+(.+)$", reward["name"])
    if m:
        reward["qty"] = reward["qty"] or int(m.group(1).replace(",", ""))
        reward["name"] = m.group(2)
    return reward, raw


def parse_page(html):
    soup = BeautifulSoup(html, "html.parser")
    cats, samples = [], []
    for cat in soup.select(".task-category"):
        h = cat.find(["h2", "h3"])
        name = clean(h.get_text(" ")) if h else ""
        tasks = []
        for item in cat.select(".task-item"):
            t = item.select_one(".task-text")
            text = clean(t.get_text(" ")) if t else ""
            if not text:
                continue
            rewards = []
            for r in item.select(".reward"):
                reward, raw = parse_reward(r)
                if reward["name"] or reward["image"]:
                    rewards.append(reward)
                if reward["type"] != "encounter" and len(samples) < 3:
                    samples.append({"raw": raw, "html": str(r)[:1200]})
            # 同じタスクが重複して載っている場合はまとめる
            same = next((x for x in tasks if x["text"] == text), None)
            if same:
                same["rewards"].extend(rewards)
            else:
                tasks.append({"text": text, "rewards": rewards})
        if tasks:
            cats.append({"name": name, "tasks": tasks})
    return cats, samples


def main(prev_path, out_path):
    try:
        with open(prev_path, encoding="utf-8") as f:
            prev = json.load(f)
    except Exception:
        prev = None
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": UA, "Accept-Language": "en"})
        with urllib.request.urlopen(req, timeout=30) as res:
            html = res.read().decode("utf-8", "replace")
        cats, samples = parse_page(html)
        n = sum(len(c["tasks"]) for c in cats)
        if n == 0:
            raise RuntimeError("タスクが1件も見つかりませんでした（ページの構造が変わった可能性）")
        data = {"updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "categories": cats, "samples": samples}
        print(f"categories={len(cats)} tasks={n}")
    except Exception as ex:
        print(f"::warning::research: {ex}")
        if not prev:
            sys.exit("前回のデータも無いため終了します")
        data = prev
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
