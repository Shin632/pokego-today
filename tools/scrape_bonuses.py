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
    return bonuses, notes[:MAX_NOTES]


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
            bonuses, notes = parse_page(get(e["link"]))
            out[eid] = {"fetchedAt": now_utc().isoformat(timespec="seconds").replace("+00:00", "Z"),
                        "bonuses": bonuses, "notes": notes}
            ok += 1
            print(f"[ok] {eid}: {len(bonuses)} bonuses")
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
