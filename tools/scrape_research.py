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
    name = ""
    if label_el is not None:
        # アイテムは「Pinap Berry <span>×3</span>」、ポケモンは「<span>Bulbasaur</span>」の形
        own = clean("".join(t for t in label_el.find_all(string=True, recursive=False)))
        span = label_el.select_one("span")
        name = own or (clean(span.get_text(" ")) if span else clean(label_el.get_text(" ")))
    img_el = r.select_one(".reward-image") or r.select_one("img")
    image = img_el.get("src") if img_el else None
    if image and image.startswith("/"):
        image = "https://leekduck.com" + image
    if image:
        image = image.replace(" ", "%20")
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


EVENTS_URL = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json"
JST = dt.timezone(dt.timedelta(hours=9))


def norm_event(name):
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def parse_time(s):
    """ScrapedDuck の日時。末尾に Z があれば UTC、無ければ現地時刻（このアプリは日本向けなので日本時間とみなす）"""
    try:
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None
    return t if t.tzinfo else t.replace(tzinfo=JST)


def mark_events(cats, events=None):
    """イベントのタスク（「〇〇 Tasks」）に、同じ名前のイベントの開始・終了日時（start / end）を付け、もう終わったものは除く。
    （まだ始まっていないものは残し、ページの側で始まるまで隠す）
    LeekDuck のリサーチ一覧は、イベントが終わってもしばらくそのタスクが残ることがあるため。
    同じ名前のイベントが見つからないものはそのまま残す。"""
    if events is None:
        try:
            req = urllib.request.Request(EVENTS_URL, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=30) as res:
                events = json.load(res)
        except Exception as ex:
            print(f"::warning::research: イベントの一覧を読めず、終わったイベントのタスクを除けませんでした（{ex}）")
            return cats
    by_name = {}
    for e in events or []:
        by_name.setdefault(norm_event(e.get("name")), []).append(e)
    now = dt.datetime.now(dt.timezone.utc)
    out = []
    for c in cats:
        m = re.match(r"^(.+?) Tasks$", c.get("name") or "")
        evs = by_name.get(norm_event(m.group(1))) if m else None
        if evs:
            ends = [(parse_time(e.get("end") or ""), e.get("end")) for e in evs]
            ends = [x for x in ends if x[0]]
            starts = [(parse_time(e.get("start") or ""), e.get("start")) for e in evs]
            starts = [x for x in starts if x[0]]
            if ends:
                last = max(ends)
                if last[0] < now:
                    print(f"research: 終わったイベントのタスクを除きました：{c['name']}（終了 {last[1]}）")
                    continue
                c = dict(c, end=last[1])
            if starts:
                c = dict(c, start=min(starts)[1])
        out.append(c)
    return out


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
    if isinstance(data.get("categories"), list):
        data["categories"] = mark_events(data["categories"])
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
