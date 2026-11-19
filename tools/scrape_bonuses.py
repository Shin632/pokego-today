#!/usr/bin/env python3
"""開催中・近日開催のイベントについて、LeekDuck の各イベントページから「ボーナス」欄を集めて JSON に保存する。

GitHub Actions（.github/workflows/bonuses.yml）から定期実行される想定。
  python3 tools/scrape_bonuses.py <前回の bonuses.json> <出力先 bonuses.json>

出力形式:
{
  "updatedAt": "2026-11-17T12:00:00Z",
  "events": {
    "<eventID>": {
      "fetchedAt": "...",
      "bonuses": [{"text": "2× Catch Stardust", "section": "Event Bonuses"}],
      "notes": ["Bonuses are active from ..."]
    }
  }
}
"""
import datetime as dt
import json
import re
import sys
import time
import urllib.request

from bs4 import BeautifulSoup

EVENTS_URL = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json"
UA = "Mozilla/5.0 (compatible; pokego-today-bonus-collector/1.0)"
PAST = dt.timedelta(days=1)       # 終了から1日以内のものまで
AHEAD = dt.timedelta(days=9)      # 9日先に始まるものまで
MAX_NOTES = 6
MAX_NOTE_LEN = 500
SLEEP_SEC = 1.0


def now_utc():
    return dt.datetime.now(dt.timezone.utc)


def get(url, timeout=25):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8", "replace")


def parse_time(s):
    """Z 付きは UTC。無しは現地時間なので、取りこぼさないよう UTC として扱う（±14時間の誤差は許容範囲に含める）。"""
    if not s:
        return None
    try:
        if s.endswith("Z"):
            return dt.datetime.fromisoformat(s[:-1]).replace(tzinfo=dt.timezone.utc)
        return dt.datetime.fromisoformat(s).replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def clean(text):
    return " ".join((text or "").split())


def heading_of(node):
    h = node.find_previous(["h2"])
    return clean(h.get_text()) if h else ""


SPAWN_HEAD = re.compile(r"spawn|wild|encounter|habitat|biome|appear", re.I)


def parse_spawns(root):
    """「Spawns」「Wild Encounters」などの見出しの下にあるポケモンの一覧を、直前の説明文と一緒に集める"""
    groups = []
    for h in root.find_all("h2"):
        title = clean(h.get_text(" "))
        if not (SPAWN_HEAD.search(title) or SPAWN_HEAD.search(h.get("id") or "")):
            continue
        context = []
        sib = h.find_next_sibling()
        while sib is not None and sib.name != "h2":
            items = sib.select(".pkmn-list-item") if hasattr(sib, "select") else []
            if sib.get("class") and "pkmn-list-item" in sib.get("class"):
                items = [sib]
            if items:
                mons = []
                for it in items:
                    nm = it.select_one(".pkmn-name")
                    img = it.select_one("img")
                    name = clean(nm.get_text(" ")) if nm else ""
                    if name:
                        mons.append({"name": name, "image": img.get("src") if img else None,
                                     "shiny": it.select_one(".shiny-icon") is not None})
                if mons:
                    groups.append({"section": title, "context": context[-3:], "pokemon": mons})
                context = []
            else:
                t = clean(sib.get_text(" "))
                if t:
                    context.append(t[:300])
            sib = sib.find_next_sibling()
    return groups


MOVE_HEAD = re.compile(r"featured attack|exclusive (?:move|attack)|attack|move", re.I)
MOVE_SENT = re.compile(r"(?:will know|that knows?|learn(?:s)? the|knowing the|exclusive (?:Fast|Charged) Attack|Elite (?:Fast|Charged) TM|legacy)", re.I)


def parse_moves(root):
    """レガシー技（イベント限定の技）についての文を集める。
    「Featured Attack」などの見出しの下の文と、本文中の「will know the Charged Attack ...」のような文。"""
    out = []
    def add(t, section):
        t = clean(t)
        if t and len(t) <= 600 and not any(o["text"] == t for o in out):
            out.append({"section": section, "text": t})
    for h in root.find_all("h2"):
        title = clean(h.get_text(" "))
        if not (MOVE_HEAD.search(title) or MOVE_HEAD.search(h.get("id") or "")):
            continue
        sib = h.find_next_sibling()
        while sib is not None and sib.name != "h2":
            for line in sib.get_text("\n").split("\n"):
                add(line, title)
            sib = sib.find_next_sibling()
    for el in root.find_all(["p", "li", "div"]):
        if el.find(["p", "li", "div"]):
            continue   # いちばん内側の要素だけ見る
        t = clean(el.get_text(" "))
        if MOVE_SENT.search(t):
            for sent in re.split(r"(?<=[.!])\s+", t):
                if MOVE_SENT.search(sent):
                    add(sent, heading_of(el))
    return out[:12]


def parse_page(html):
    soup = BeautifulSoup(html, "html.parser")
    root = soup.select_one(".page-content") or soup
    bonuses, notes, seen = [], [], set()

    lists = root.select(".bonus-list")
    items_groups = [(lst, lst.select(".bonus-item")) for lst in lists]
    if not lists:  # 念のため: リストの枠が無くても項目だけあれば拾う
        items_groups = [(None, root.select(".bonus-item"))]

    for lst, items in items_groups:
        for item in items:
            t = item.select_one(".bonus-text") or item
            text = clean(t.get_text(" "))
            if not text:
                continue
            section = heading_of(lst if lst is not None else item)
            key = (text, section)
            if key in seen:
                continue
            seen.add(key)
            bonuses.append({"text": text, "section": section})
        # リスト直後の注意書き（次の見出しまでの段落）
        if lst is not None:
            sib = lst.find_next_sibling()
            while sib is not None and sib.name not in ("h2",) and len(notes) < MAX_NOTES:
                if sib.name == "p":
                    for line in sib.get_text("\n").split("\n"):
                        line = clean(line)
                        if line and line not in notes:
                            notes.append(line[:MAX_NOTE_LEN])
                if sib.get("class") and "bonus-list" in sib.get("class"):
                    break
                sib = sib.find_next_sibling()
    spawns = parse_spawns(root)
    sample = None
    if spawns:   # ページの作りを確かめるための見本（最初の見出しまわりのHTMLを少しだけ）
        h = next((x for x in root.find_all("h2") if SPAWN_HEAD.search(clean(x.get_text(" "))) or SPAWN_HEAD.search(x.get("id") or "")), None)
        if h is not None:
            parts, sib = [str(h)], h.find_next_sibling()
            while sib is not None and sib.name != "h2" and sum(len(x) for x in parts) < 2500:
                parts.append(str(sib)[:800]); sib = sib.find_next_sibling()
            sample = "".join(parts)[:2500]
    return bonuses, notes[:MAX_NOTES], spawns, sample, parse_moves(root)


def main(prev_path, out_path):
    try:
        with open(prev_path, encoding="utf-8") as f:
            prev = json.load(f).get("events", {})
    except Exception:
        prev = {}

    events = json.loads(get(EVENTS_URL))
    now = now_utc()
    targets = []
    for e in events:
        link = e.get("link") or ""
        if not link.startswith("https://leekduck.com/"):
            continue
        s, en = parse_time(e.get("start")), parse_time(e.get("end"))
        if s is None or en is None:
            continue
        if en < now - PAST or s > now + AHEAD:
            continue
        targets.append(e)

    out, ok, fail = {}, 0, 0
    for i, e in enumerate(targets):
        eid = e["eventID"]
        try:
            bonuses, notes, spawns, sample, moves = parse_page(get(e["link"]))
            out[eid] = {"fetchedAt": now_utc().isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "bonuses": bonuses, "notes": notes, "spawns": spawns, "moves": moves}
            if sample:
                out[eid]["spawnSample"] = sample
            ok += 1
            print(f"[ok] {eid}: {len(bonuses)} bonuses, {sum(len(g['pokemon']) for g in spawns)} spawns")
        except Exception as ex:  # 失敗したら前回の内容を残す
            fail += 1
            print(f"::warning::{eid}: {ex}")
            if eid in prev:
                out[eid] = prev[eid]
        if i + 1 < len(targets):
            time.sleep(SLEEP_SEC)

    data = {"updatedAt": now_utc().isoformat(timespec="seconds").replace("+00:00", "Z"), "events": out}
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1, sort_keys=True)
    print(f"targets={len(targets)} ok={ok} fail={fail}")
    if targets and ok == 0:
        sys.exit("すべてのページの取得に失敗しました")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
