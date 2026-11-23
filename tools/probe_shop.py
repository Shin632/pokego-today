"""一時的な調査用：LeekDuck に「その日ショップで売っているボックス」の情報があるかを確かめる（記録を出すだけで、データは作らない）"""
import json
import re
import sys
import time
import urllib.request

from bs4 import BeautifulSoup

EVENTS_URL = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json"
UA = {"User-Agent": "Mozilla/5.0 (pokego-today probe)"}
CANDIDATES = ["https://leekduck.com/shop/", "https://leekduck.com/boxes/", "https://leekduck.com/shop-boxes/",
              "https://leekduck.com/news/", "https://leekduck.com/", "https://leekduck.com/events/"]


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status, r.read().decode("utf-8", "replace")


def main():
    for url in CANDIDATES:
        try:
            st, html = get(url)
            soup = BeautifulSoup(html, "html.parser")
            title = soup.title.get_text(strip=True) if soup.title else ""
            links = sorted({a.get("href", "") for a in soup.select("a[href]") if re.search(r"box|shop|bundle", a.get("href", ""), re.I)})
            print(f"[page] {url} {st} title={title!r} box/shop links={links[:30]}")
        except Exception as ex:
            print(f"[page] {url} NG {ex}")
        time.sleep(2)
    events = json.loads(get(EVENTS_URL)[1])
    shown = 0
    for e in events:
        link = e.get("link") or ""
        if not link.startswith("https://leekduck.com/") or shown >= 25:
            continue
        try:
            _, html = get(link)
        except Exception as ex:
            print(f"[event] {link} NG {ex}")
            continue
        soup = BeautifulSoup(html, "html.parser")
        heads = [h.get_text(" ", strip=True) for h in soup.select("h2, h3")]
        print(f"[event] {e.get('eventID')} headings={heads[:25]}")
        for h in soup.select("h2, h3"):
            if re.search(r"box|bundle|shop|paid|ticket", h.get_text(" ", strip=True), re.I):
                txt = []
                sib = h.find_next_sibling()
                while sib is not None and sib.name not in ("h2",) and len(" ".join(txt)) < 700:
                    txt.append(sib.get_text(" ", strip=True))
                    sib = sib.find_next_sibling()
                print(f"    [box?] {h.get_text(' ', strip=True)!r}: {' / '.join(t for t in txt if t)[:700]}")
        shown += 1
        time.sleep(2)


if __name__ == "__main__":
    try:
        main()
    except Exception as ex:
        print(f"probe failed: {ex}")
    sys.exit(0)
