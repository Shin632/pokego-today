#!/usr/bin/env python3
"""レイド・ジム攻撃・ジム防衛で「育成すべきポケモン」のランキングを、ゲームデータから計算して JSON にする。

  python3 tools/build_rankings.py <前回の rankings.json> <出力先 rankings.json> [<前回の megas.json> <出力先 megas.json>]

前回のデータが 24 時間以内なら計算をせずにそのまま使う（重いデータを毎回取りにいかないため）。

使うデータ（どれも GitHub 上の公開データ）:
- PvPoke の gamemaster.json：ポケモンの種族値・タイプ・覚える技・実装済みか・伝説などのタグ
- PokeMiners の GAME_MASTER（latest.json）：レイド・ジム（PvE）での技の威力・時間・エネルギー
- PokeAPI の moves.csv / move_names.csv：技の日本語名

計算の考え方（目安。くわしくは ranks.html の「計算のしかた」）:
- 攻撃側はレベル40・個体値15/15/15。シャドウは攻撃1.2倍・防御0.833倍。メガ・ゲンシはメガ後の種族値。
- 技1と技2の組み合わせごとに、GamePress 方式の DPS（1秒あたりのダメージ）と TDO（倒されるまでの総ダメージ）を計算し、
  「(DPS^3 × TDO)^(1/4)」を評価値にして、いちばん良い組み合わせでそのポケモンを評価する。
- レイド：タイプ相性なし（等倍）の相手に対する評価。タイプ別は、技1・技2ともにそのタイプのものだけで評価。
- ジム防衛：ジムに置けるポケモン（伝説・幻・ウルトラビースト・メガ・シャドウを除く）について、
  「強い攻撃役（各ポケモンに対して相性の良い上位5匹）で倒すのにかかる時間」で評価する（ジムの防衛側はHPが2倍）。
- 育成難易度（1〜5）：伝説・幻・メガ・合体・シャドウ・★技・相棒でアメ1個の距離（すごいわざマシン）・進化に必要なアメの数・進化アイテム・地域限定から点数化。
- 連れ歩き：上のランキング（各TOP10）に出るポケモンについて、相棒の距離・必要なアメ（進化＋レベル20→40）・
  連れ歩きでもらえるメガエナジーから「1km歩いたときの育成の進み具合 × 役立ち度」で並べる。
- ジム攻撃：ジム防衛ランキングの上位6匹を「よく置かれる相手」とみなし、それらに対する評価の平均（上位ほど重み大）。
"""
import csv
import datetime as dt
import io
import json
import math
import os
import re
import sys
import urllib.request

PVPOKE = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/gamemaster.json"
GAME_MASTER = "https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json"
MOVES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/moves.csv"
MOVE_NAMES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/move_names.csv"
FRESH_HOURS = 0          # レイドボスが入れ替わるので毎回計算する（計算は1分かからない）
SCHEMA = 18               # 出力の形式を変えたら上げる（前回分を使い回さず計算し直す）
TOP_N = 10
KEEP = {"raid": 250, "type": 60, "gym": 200, "defense": 30}   # 画面で絞り込んでも10件出せるよう多めに持つ
ATTACKER_POOL = 150      # ジム防衛の評価に使う攻撃役の候補（レイド上位＋タイプ別上位）
COUNTERS = 5

CPM40 = 0.7903
SHADOW_ATK, SHADOW_DEF = 1.2, 1 / 1.2
STAB = 1.2
SE, NVE, IMM = 1.6, 0.625, 0.390625
RAID_TARGET_DEF = (200 + 15) * 0.79     # タイプ相性なしの「よくある相手」の防御
DEFENDER_FAST_DELAY = 2.0               # ジム防衛側は技1の間隔が 1.5〜2.5 秒のびる
GYM_TARGETS = 6
EXCLUDE_CHARGED = {"FRUSTRATION", "RETURN"}

TYPES = ["normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground", "flying",
         "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"]
_CHART = {
    "normal": {"rock": .5, "ghost": 0, "steel": .5},
    "fire": {"fire": .5, "water": .5, "grass": 2, "ice": 2, "bug": 2, "rock": .5, "dragon": .5, "steel": 2},
    "water": {"fire": 2, "water": .5, "grass": .5, "ground": 2, "rock": 2, "dragon": .5},
    "electric": {"water": 2, "electric": .5, "grass": .5, "ground": 0, "flying": 2, "dragon": .5},
    "grass": {"fire": .5, "water": 2, "grass": .5, "poison": .5, "ground": 2, "flying": .5, "bug": .5, "rock": 2, "dragon": .5, "steel": .5},
    "ice": {"fire": .5, "water": .5, "grass": 2, "ice": .5, "ground": 2, "flying": 2, "dragon": 2, "steel": .5},
    "fighting": {"normal": 2, "ice": 2, "poison": .5, "flying": .5, "psychic": .5, "bug": .5, "rock": 2, "ghost": 0, "dark": 2, "steel": 2, "fairy": .5},
    "poison": {"grass": 2, "poison": .5, "ground": .5, "rock": .5, "ghost": .5, "steel": 0, "fairy": 2},
    "ground": {"fire": 2, "electric": 2, "grass": .5, "poison": 2, "flying": 0, "bug": .5, "rock": 2, "steel": 2},
    "flying": {"electric": .5, "grass": 2, "fighting": 2, "bug": 2, "rock": .5, "steel": .5},
    "psychic": {"fighting": 2, "poison": 2, "psychic": .5, "dark": 0, "steel": .5},
    "bug": {"fire": .5, "grass": 2, "fighting": .5, "poison": .5, "flying": .5, "psychic": 2, "ghost": .5, "dark": 2, "steel": .5, "fairy": .5},
    "rock": {"fire": 2, "ice": 2, "fighting": .5, "ground": .5, "flying": 2, "bug": 2, "steel": .5},
    "ghost": {"normal": 0, "psychic": 2, "ghost": 2, "dark": .5},
    "dragon": {"dragon": 2, "steel": .5, "fairy": 0},
    "dark": {"fighting": .5, "psychic": 2, "ghost": 2, "dark": .5, "fairy": .5},
    "steel": {"fire": .5, "water": .5, "electric": .5, "ice": 2, "rock": 2, "steel": .5, "fairy": 2},
    "fairy": {"fire": .5, "fighting": 2, "poison": .5, "dragon": 2, "dark": 2, "steel": .5},
}
_GO = {2: SE, .5: NVE, 0: IMM}


def eff(move_type, target_types):
    m = 1.0
    for t in target_types:
        if t and t != "none":
            v = _CHART.get(move_type, {}).get(t)
            if v is not None:
                m *= _GO[v]
    return m


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "pokego-today-rankings/1.0"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def load_pve_moves(gm):
    moves = {}
    for x in gm:
        ms = x.get("data", {}).get("moveSettings")
        if not ms or not isinstance(ms.get("movementId"), str):
            continue
        mid = ms["movementId"]
        t = (ms.get("pokemonType") or "").replace("POKEMON_TYPE_", "").lower()
        moves[mid] = {"type": t, "power": float(ms.get("power") or 0), "dur": (ms.get("durationMs") or 0) / 1000,
                      "energy": int(ms.get("energyDelta") or 0)}
    return moves


ITEM_JA = {"ITEM_SUN_STONE": "たいようのいし", "ITEM_KINGS_ROCK": "おうじゃのしるし", "ITEM_METAL_COAT": "メタルコート",
           "ITEM_GEN4_EVOLUTION_STONE": "シンオウのいし", "ITEM_DRAGON_SCALE": "りゅうのウロコ", "ITEM_UP_GRADE": "アップグレード",
           "ITEM_GEN5_EVOLUTION_STONE": "イッシュのいし"}
# 個数つきの特別な素材（evolutionItemRequirementCost）
COST_ITEM_JA = {"ITEM_OTHER_EVOLUTION_STONE_A": ("コレクレーのコイン", 1.0), "ITEM_BEANS": ("ジガルデセル", 1.0),
                "ITEM_OTHER_EVOLUTION_STONE_MAPLE_A": ("専用のりんご", 0.5), "ITEM_OTHER_EVOLUTION_STONE_MAPLE_B": ("専用のりんご", 0.5),
                "ITEM_OTHER_EVOLUTION_STONE_MAPLE_C": ("専用のりんご", 0.5)}
LURE_JA = {"ITEM_TROY_DISK_MAGNETIC": "マグネット", "ITEM_TROY_DISK_MOSSY": "ハーブ", "ITEM_TROY_DISK_GLACIAL": "アイス",
           "ITEM_TROY_DISK_RAINY": "レイニー", "ITEM_TROY_DISK_SPARKLY": "キラキラ"}
GM_TYPE_JA = {"NORMAL": "ノーマル", "FIRE": "ほのお", "WATER": "みず", "ELECTRIC": "でんき", "GRASS": "くさ", "ICE": "こおり",
              "FIGHTING": "かくとう", "POISON": "どく", "GROUND": "じめん", "FLYING": "ひこう", "PSYCHIC": "エスパー", "BUG": "むし",
              "ROCK": "いわ", "GHOST": "ゴースト", "DRAGON": "ドラゴン", "DARK": "あく", "STEEL": "はがね", "FAIRY": "フェアリー"}


def quest_text(q):
    """進化タスク（evolutionQuestTemplate）→ 日本語の説明"""
    g = (q.get("goals") or [{}])[0]
    n = g.get("target") or 1
    types, raid, dmax = [], False, False
    for c in g.get("condition") or []:
        for k in ("withPokemonType", "withOpponentPokemonBattleStatus"):
            for t in (c.get(k) or {}).get("pokemonType" if k == "withPokemonType" else "opponentPokemonType") or []:
                types.append(GM_TYPE_JA.get(t.replace("POKEMON_TYPE_", ""), t))
        ct = (c.get("withCombatType") or {}).get("combatType") or []
        raid = raid or "COMBAT_TYPE_RAID" in ct
        dmax = dmax or "COMBAT_TYPE_DMAX" in ct
    ty = "・".join(types)
    qt = q.get("questType", "")
    if qt == "QUEST_CATCH_POKEMON":
        return f"{ty}タイプのポケモンを{n}匹捕まえる" if ty else f"ポケモンを{n}匹捕まえる"
    if qt == "QUEST_FIGHT_POKEMON":
        return f"相棒にして{ty}タイプのポケモンを{n}匹倒す" if ty else f"相棒にしてポケモンを{n}匹倒す"
    if qt == "QUEST_COMPLETE_BATTLE":
        where = "レイド・マックスバトル" if dmax else "レイド" if raid else "バトル"
        return f"{where}で{ty}タイプのポケモンに{n}回勝つ" if ty else f"{where}で{n}回勝つ"
    if qt == "QUEST_COMPLETE_RAID_BATTLE":
        return f"レイドで{n}回勝つ"
    if qt == "QUEST_BUDDY_EVOLUTION_WALK":
        return f"相棒にして{n}km歩く"
    if qt == "QUEST_BUDDY_EARN_AFFECTION_POINTS":
        return f"相棒にしてハートを{n}個ためる"
    if qt == "QUEST_BUDDY_FEED":
        return f"相棒におやつを{n}回あげる"
    if qt == "QUEST_USE_INCENSE":
        return f"おこうを{n}回使う"
    if qt == "QUEST_LAND_THROW":
        return f"エクセレントスローを{n}回投げる"
    return f"専用のタスク（{n}回）を達成する"


def load_evolutions(gm):
    """図鑑番号ごとに「進化前の図鑑番号・進化に必要なアメ・必要な道具・そのほかの条件（[(説明, 点数)]）」を返す"""
    id2dex, branches, quests = {}, [], {}
    for x in gm:
        q = x.get("data", {}).get("evolutionQuestTemplate")
        if q:
            quests[x["templateId"]] = q
    for x in gm:
        ps = x.get("data", {}).get("pokemonSettings")
        if not ps:
            continue
        tid = x.get("templateId", "")
        try:
            dex = int(tid[1:5])
        except ValueError:
            continue
        id2dex.setdefault(ps["pokemonId"], dex)
        for b in ps.get("evolutionBranch") or []:
            if b.get("evolution") and (b.get("candyCost") or b.get("evolutionItemRequirementCost")):
                branches.append((dex, b))
    evo = {}
    for parent, b in branches:
        cd = id2dex.get(b["evolution"])
        if cd is None or cd == parent:
            continue
        cost = int(b.get("candyCost") or 0)
        item = b.get("evolutionItemRequirement")
        conds = []
        if item in COST_ITEM_JA:
            name, pt = COST_ITEM_JA[item]
            conds.append((f"{name}{b.get('evolutionItemRequirementCost') or ''}個", pt)); item = None
        if b.get("lureItemRequirement"):
            conds.append((f"{LURE_JA.get(b['lureItemRequirement'], '特別な')}ルアーモジュールを使ったポケストップの近く", 0.5))
        # 進化タスク（コミュニティ・デイ用・イベント用の軽いものは使わない）
        qids = [d.get("questRequirementTemplateId") for d in b.get("questDisplay") or []]
        qids = [q for q in qids if q and "_CD_" not in q and "BUDDY_EVENT" not in q]
        if qids and qids[0] in quests:
            conds.append((quest_text(quests[qids[0]]), 0.5))
        elif b.get("kmBuddyDistanceRequirement"):
            conds.append((f"相棒にして{int(b['kmBuddyDistanceRequirement'])}km歩く", 0.5))
        if b.get("onlyDaytime"):
            conds.append(("昼に進化させる", 0))
        if b.get("onlyNighttime"):
            conds.append(("夜に進化させる", 0))
        if b.get("onlyUpsideDown"):
            conds.append(("スマホを逆さにして進化させる", 0))
        if b.get("genderRequirement"):
            conds.append((("オス" if b["genderRequirement"] == "MALE" else "メス") + "だけが進化できる", 0))
        cur = evo.get(cd)
        # 同じ進化先への道が複数あるときは、アメが少なく条件の軽いほう
        key = (cost, sum(p for _, p in conds))
        if cur is None or key < (cur[1], sum(p for _, p in cur[3])):
            evo[cd] = (parent, cost, item, conds)
    return evo


def total_candy(dex, evo, depth=0, conds=None):
    """進化に必要なアメの合計と道具。conds を渡すと、そのほかの条件（[(説明, 点数)]）もそこに足す"""
    if dex not in evo or depth > 5:
        return 0, []
    parent, cost, item, cs = evo[dex]
    if conds is not None:
        conds[:0] = cs
    c, items = total_candy(parent, evo, depth + 1, conds)
    return c + cost, items + ([item] if item else [])


# ポケモンGOに実装済みだが、バトルに出られない（出しても意味がない）ため PvPoke では released: false のポケモン
# （検索・育成判定で名前が出るように pokedex.json にだけ入れる）
NON_BATTLE_RELEASED = {"ditto", "shedinja", "spewpa", "cosmog", "cosmoem"}


# 専用の素材で姿を変えるポケモン（ゲームデータの formChange：素材1000個とアメ30個）
FORM_ITEMS = {
    "zacian_crowned_sword": "王の姿になるには専用の素材1000個とアメ30個が必要",
    "zamazenta_crowned_shield": "王の姿になるには専用の素材1000個とアメ30個が必要",
}


# 合体して姿が変わるポケモン（合体相手の伝説と、合体用のエネルギーが別に必要）
FUSIONS = {
    "kyurem_black": "合体：ゼクロムと合体エネルギーが必要",
    "kyurem_white": "合体：レシラムと合体エネルギーが必要",
    "necrozma_dusk_mane": "合体：ソルガレオと合体エネルギーが必要",
    "necrozma_dawn_wings": "合体：ルナアーラと合体エネルギーが必要",
    "calyrex_ice_rider": "合体：ブリザポスが必要",
    "calyrex_shadow_rider": "合体：レイスポスが必要",
}


def difficulty(p, b, evo):
    """育成の大変さ（1〜5）と理由。目安としての点数づけ。"""
    tags = set(p.get("tags", []))
    pts, reasons = 0.0, []
    if "mythical" in tags:
        pts += 3; reasons.append("幻：入手の機会がとても限られる")
    elif "legendary" in tags or "ultrabeast" in tags:
        pts += 2; reasons.append("伝説：レイドなどでしか手に入らず、アメも集めにくい")
    if "mega" in tags:
        sid = p["speciesId"]
        if sid.startswith("rayquaza_mega"):
            why = "メガシンカにわざ「ガリョウテンセイ」が必要（いんせきで覚える）"
        elif "primal" in sid:
            why = "ゲンシカイキにゲンシエナジーが必要"
        else:
            why = "メガシンカにメガエナジーが必要"
        pts += 1; reasons.append(why)
    if p["speciesId"].replace("_shadow", "") in FUSIONS:
        pts += 1.5; reasons.append(FUSIONS[p["speciesId"].replace("_shadow", "")])
    if p["speciesId"].replace("_shadow", "") in FORM_ITEMS:
        pts += 1; reasons.append(FORM_ITEMS[p["speciesId"].replace("_shadow", "")])
    if "shadow" in tags:
        pts += 1; reasons.append("シャドウ：GOロケット団などから入手。やつあたりを消すにはイベントが必要")
    if b.get("fastElite") or b.get("chargedElite"):
        pts += 1; reasons.append("★の技にすごいわざマシンが必要")
    conds = []
    candy, items = total_candy(p["dex"], evo, conds=conds)
    if candy >= 400:
        pts += 1.5
    elif candy >= 200:
        pts += 1
    elif candy >= 100:
        pts += 0.5
    if candy >= 100:
        reasons.append(f"進化にアメ{candy}個")
    for it in items:
        pts += 0.5; reasons.append(f"進化に{ITEM_JA.get(it, '専用のどうぐ')}が必要")
    for text, pt in conds:
        pts += pt; reasons.append(f"進化の条件：{text}")
    # 相棒で歩いてアメ1個もらう距離（伝説・幻は「アメも集めにくい」で数え済みなので点は足さない）
    km = p.get("buddyDistance")
    if km and km >= 5:
        if not ({"legendary", "mythical", "ultrabeast"} & tags):
            pts += 1 if km >= 20 else 0.5
        reasons.append(f"相棒でアメ1個に{km}km")
    if "regional" in tags:
        pts += 1; reasons.append("地域限定")
    level = 1 if pts <= 0 else 2 if pts <= 1 else 3 if pts <= 2 else 4 if pts <= 3.5 else 5
    return {"level": level, "reasons": reasons}


EVENTS_URL = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/events.json"


def load_max_forms(gm, ids):
    """ゲームデータの BREAD_POKEMON_SCALING_SETTINGS から、ダイマックス（BREAD_MODE）・キョダイマックス（BREAD_DOUGH_MODE）の姿があるポケモン。
    ここに無くてもダイマックスできるポケモンはいる（表示の大きさを個別に決めているものだけ載っている）ので、イベント情報などで補う"""
    dmax, gmax = set(), set()
    for t in gm:
        if t.get("templateId") != "BREAD_POKEMON_SCALING_SETTINGS":
            continue
        for v in t["data"]["breadPokemonScalingSettings"].get("visualSettings", []):
            pid = v.get("pokemonId", "")
            for f in v.get("pokemonFormData", []):
                form = (f.get("pokemonForm") or pid)
                if "ETERNAMAX" in form:
                    continue
                cand = [form.lower(), form.lower().replace("_normal", ""), pid.lower()]
                sid = next((c for c in cand if c in ids), None)
                if not sid:
                    continue
                for vd in f.get("visualData", []):
                    (dmax if vd.get("breadMode") == "BREAD_MODE" else gmax).add(sid)
    return dmax, gmax


def max_names_from_text(text, name2id):
    """「Dynamax Espurr」「Gigantamax Machamp」のような書き方からポケモンを拾う"""
    dmax, gmax = set(), set()
    for kind, name in re.findall(r"\b(Dynamax|Gigantamax) ([A-Z][\w'.\-é]+(?: \([^)]*\))?(?: (?!Dynamax|Gigantamax)[A-Z][\w'.\-é]+)?)", text):
        for cand in (name, re.sub(r" \(.*\)$", "", name), name.split(" ")[0]):
            sid = name2id.get(cand)
            if sid:
                (gmax if kind == "Gigantamax" else dmax).add(sid)
                break
    return dmax, gmax


def load_move_names():

    ids = {}
    for r in csv.DictReader(io.StringIO(get(MOVES_CSV).decode("utf-8"))):
        ids[r["id"]] = r["identifier"]
    ja = {}
    for r in csv.DictReader(io.StringIO(get(MOVE_NAMES_CSV).decode("utf-8"))):
        if r["local_language_id"] == "1" and r["move_id"] in ids:  # 1 = 日本語（かな）
            key = ids[r["move_id"]].upper().replace("-", "_")
            ja[key] = r["name"]
            ja.setdefault("~" + key.replace("_", ""), r["name"])   # 区切りの違い用（SUPER_POWER と superpower など）
    return ja


def stats(p):
    b = p["baseStats"]
    atk, de, hp = (b["atk"] + 15) * CPM40, (b["def"] + 15) * CPM40, math.floor((b["hp"] + 15) * CPM40)
    if "shadow" in p.get("tags", []):
        atk *= SHADOW_ATK
        de *= SHADOW_DEF
    return atk, de, hp


def damage(power, atk, de, stab, effm):
    return math.floor(0.5 * power * atk / de * stab * effm) + 1


def cycle(p, fm, cm, target_def, target_types, fast_delay=0.0):
    """GamePress 方式の DPS と TDO。fm/cm は PvE の技データ。"""
    atk, de, hp = stats(p)
    ptypes = p["types"]
    fd = damage(fm["power"], atk, target_def, STAB if fm["type"] in ptypes else 1, eff(fm["type"], target_types))
    cd = damage(cm["power"], atk, target_def, STAB if cm["type"] in ptypes else 1, eff(cm["type"], target_types))
    fdur, cdur = fm["dur"] + fast_delay, cm["dur"]
    fe, ce = max(fm["energy"], 0), -min(cm["energy"], 0)
    if fdur <= 0 or cdur <= 0 or fe <= 0 or ce <= 0:
        return None
    fdps, feps, cdps, ceps = fd / fdur, fe / fdur, cd / cdur, ce / cdur
    y = 900 / de                      # 相手から受ける DPS の目安
    x = 0.5 * ce + 0.5 * fe
    dps0 = (fdps * ceps + cdps * feps) / (ceps + feps)
    dps = dps0 + (cdps - fdps) / (ceps + feps) * (0.5 - x / hp) * y
    dps = max(dps, fdps)
    tdo = dps * hp / y
    return dps, tdo


def er(dps, tdo):
    return (dps ** 3 * tdo) ** 0.25


def movesets(p, pve, only_type=None):
    elite = set(p.get("eliteMoves", []))
    for f in p.get("fastMoves", []):
        fm = pve.get(f + "_FAST")
        if not fm or (only_type and fm["type"] != only_type):
            continue
        for c in p.get("chargedMoves", []):
            if c in EXCLUDE_CHARGED:
                continue
            cm = pve.get(c)
            if not cm or (only_type and cm["type"] != only_type):
                continue
            yield f, c, fm, cm, (f in elite), (c in elite)


def best_attack(p, pve, target_def, target_types, only_type=None):
    best = None
    for f, c, fm, cm, fe, ce in movesets(p, pve, only_type):
        r = cycle(p, fm, cm, target_def, target_types)
        if not r:
            continue
        s = er(*r)
        if best is None or s > best["score"]:
            best = {"score": s, "dps": r[0], "tdo": r[1], "fast": f, "charged": c, "fastElite": fe, "chargedElite": ce}
    return best


def defender_moves(p, pve):
    """防衛時の技（技1の間隔がのびる前提で DPS がいちばん高い組み合わせ）"""
    best = None
    for f, c, fm, cm, fe, ce in movesets(p, pve):
        r = cycle(p, fm, cm, RAID_TARGET_DEF, [], fast_delay=DEFENDER_FAST_DELAY)
        if r and (best is None or r[0] > best["dps"]):
            best = {"dps": r[0], "fast": f, "charged": c, "fastElite": fe, "chargedElite": ce}
    return best


def best_defense(p, pve, attackers):
    """強い攻撃役の上位 COUNTERS 匹の平均 DPS で、HP 2倍の防衛側を倒すのにかかる秒数"""
    mv = defender_moves(p, pve)
    if not mv:
        return None
    _, de, hp = stats(p)
    dps_list = []
    for a in attackers:
        b = best_attack(a, pve, de, p["types"])
        if b:
            dps_list.append(b["dps"])
    if len(dps_list) < COUNTERS:
        return None
    top = sorted(dps_list, reverse=True)[:COUNTERS]
    seconds = 2 * hp / (sum(top) / len(top))
    return {**mv, "score": seconds, "seconds": seconds, "bulk": hp * de}


EVO = {}


def entry(p, b, move_ja, move_en):
    tags = p.get("tags", [])
    return {
        "id": p["speciesId"], "name": p["speciesName"], "dex": p["dex"], "types": [t for t in p["types"] if t != "none"],
        "shadow": "shadow" in tags, "mega": "mega" in tags, "legendary": "legendary" in tags,
        "mythical": "mythical" in tags, "ultrabeast": "ultrabeast" in tags,
        "fast": {"id": b["fast"], "en": move_en.get(b["fast"], b["fast"]), "ja": move_ja.get(b["fast"]), "elite": b["fastElite"]},
        "charged": {"id": b["charged"], "en": move_en.get(b["charged"], b["charged"]), "ja": move_ja.get(b["charged"]), "elite": b["chargedElite"]},
        "difficulty": difficulty(p, b, EVO),
        "score": round(b["score"], 3), "dps": round(b["dps"], 2),
        **({"tdo": round(b["tdo"], 1)} if "tdo" in b else {}),
        **({"seconds": round(b["seconds"], 1)} if "seconds" in b else {}),
    }


def load_buddy_extra(gm):
    """図鑑番号ごとの「連れ歩きでもらえるメガエナジー（相棒の距離ごと）」「メガシンカに必要なエナジー（初回・2回目以降）」と、
    レベル20→40の強化に必要なアメ"""
    mega = {}
    upgrade = None
    level4, lv3_cooldown = {}, None
    for x in gm:
        d = x.get("data", {})
        ml = d.get("megaEvoLevelSettings")
        if ml:
            tid = x["templateId"]
            if tid == "MEGA_EVOLUTION_LEVEL_3":
                lv3_cooldown = int(ml.get("cooldown", {}).get("durationMs", 0)) / 3.6e6
            if tid.startswith("MEGA_EVOLUTION_LEVEL_4_V"):
                try:
                    ldex = int(tid[len("MEGA_EVOLUTION_LEVEL_4_V"):][:4])
                except ValueError:
                    ldex = None
                if ldex:
                    e = ml.get("effects", {})
                    level4[ldex] = {"unlock": ml.get("megaEnergyCostToUnlock"), "candy": e.get("sameTypeExtraCatchCandy"),
                                    "xl": e.get("sameTypeExtraCatchCandyXlChance"), "xp": e.get("sameTypeExtraCatchXp"),
                                    "cpLevels": e.get("selfCpBoostAdditionalLevel"),
                                    "cooldownH": int(ml.get("cooldown", {}).get("durationMs", 0)) / 3.6e6}
        if "pokemonUpgrades" in d:
            u = d["pokemonUpgrades"]
            per = u.get("upgradesPerLevel", 2)
            cost = u.get("candyCost", [])
            upgrade = sum(cost[19:39]) * per if len(cost) >= 39 else None    # レベル20→40
        ps = d.get("pokemonSettings")
        if not ps:
            continue
        form = ps.get("form")
        if form and not str(form).endswith("_NORMAL"):
            continue
        try:
            dex = int(x["templateId"][1:5])
        except ValueError:
            continue
        award = ps.get("buddyWalkedMegaEnergyAward")
        if award is None and ps.get("buddyWalkedMegaEnergyAwards"):
            award = max(a.get("megaEnergyAwardAmount", 0) for a in ps["buddyWalkedMegaEnergyAwards"])
        temps = [b for b in ps.get("evolutionBranch") or [] if b.get("temporaryEvolution")]
        if award and temps and dex not in mega:
            mega[dex] = {"award": award,
                         "initial": min(b.get("temporaryEvolutionEnergyCost") or 0 for b in temps),
                         "subsequent": min(b.get("temporaryEvolutionEnergyCostSubsequent") or 0 for b in temps)}
    for dex, l4 in level4.items():
        if dex in mega:
            mega[dex]["level4"] = {**l4, "cooldownH3": lv3_cooldown}
    return mega, upgrade


BASE_SUFFIXES = ("_shadow", "_mega_x", "_mega_y", "_mega", "_primal")


def base_id(sid):
    changed = True
    while changed:
        changed = False
        for suf in BASE_SUFFIXES:
            if sid.endswith(suf):
                sid, changed = sid[: -len(suf)], True
    return sid


# 連れ歩きの点数づけ（目安）
LIST_WEIGHT_MAIN, LIST_WEIGHT_TYPE = 1.0, 0.7          # 総合・ジム系のランキング / タイプ別のランキング
WALK_VALUE = {1: 0.4, 3: 0.8, 5: 1.0, 20: 0.5}          # 相棒の距離ごとの「歩いて集める価値」
MEGA_BONUS = 1.3            # メガシンカできる（歩くとメガエナジー。メガ中は同じタイプのアメが増える）
MEGA_L4_BONUS = 1.6         # メガレベル4に対応（解放に5000エナジー。アメ+3・XL30%・待ち時間24時間）
MEGA_BASE_U = 0.5           # ランキング外のメガでも「アメを増やす役」として役立つ分


def walk_value(km):
    if km in WALK_VALUE:
        return WALK_VALUE[km]
    return 0.4 if km < 3 else 0.8 if km < 5 else 1.0 if km < 20 else 0.5


def buddy_ranking(lists, by_id, mega, upgrade, n=40):
    """連れ歩きランキング。lists は [(表示名, ランキング, 重み)]。
    点数 = 役立ち度 × 歩いて集める価値（相棒の距離） × 距離の現実性 × メガ（メガシンカできれば1.3、メガレベル4対応なら1.6）
      メガシンカできるポケモンは、ランキング外でも役立ち度 0.5 で候補に入れる（メガ中は同じタイプのアメが増えるため）
      役立ち度 = ランキング各TOP10での「1位を100とした評価」/100 × リストの重み の最大値
      歩いて集める価値 = 1km 0.4（野生に多く、捕まえて集める方が早いことが多い）、3km 0.8、5km 1.0、20km 0.5（遅すぎる）
      距離の現実性 = 1 /（1 + 全部歩いて集める距離 / 1000km）"""
    best = {}
    for label, lst, w in lists:
        for rank, x in enumerate(lst[:10], 1):
            b = base_id(x["id"])
            bp = by_id.get(b)
            if not bp:
                continue
            dex = bp["dex"]
            u = x["pct"] / 100 * w
            cur = best.setdefault(dex, {"base": bp, "u": 0, "uses": [], "variant": None, "shadow": False, "megaUsed": False})
            cur["uses"].append({"list": label, "rank": rank, "name": x["name"], "w": w})
            if x["mega"]:
                cur["megaUsed"] = True
            if u > cur["u"]:
                cur.update(u=u, variant=x["name"], shadow=x["shadow"])
    # ランキングに入っていなくても、メガシンカできるポケモンは「アメを増やす役」として候補に入れる
    by_dex = {}
    for p in by_id.values():
        if p["speciesId"] == base_id(p["speciesId"]) and "shadow" not in p.get("tags", []):
            by_dex.setdefault(p["dex"], p)
    for dex in mega:
        if dex not in best and dex in by_dex:
            best[dex] = {"base": by_dex[dex], "u": MEGA_BASE_U, "uses": [], "variant": by_dex[dex]["speciesName"],
                         "shadow": False, "megaUsed": False}
        elif dex in best and best[dex]["u"] < MEGA_BASE_U:
            best[dex]["u"] = MEGA_BASE_U
    out = []
    for dex, c in best.items():
        bp = c["base"]
        km = bp.get("buddyDistance")
        if not km or not upgrade:
            continue
        evo_candy, _ = total_candy(dex, EVO)
        need = evo_candy + upgrade * (1.2 if c["shadow"] else 1)
        km_all = need * km
        m = mega.get(dex)
        mega_f = (MEGA_L4_BONUS if m.get("level4") else MEGA_BONUS) if m else 1
        score = c["u"] * walk_value(km) / (1 + km_all / 1000) * mega_f
        uses = sorted(c["uses"], key=lambda u: (-u["w"], u["rank"]))[:4]
        item = {
            "id": bp["speciesId"], "name": bp["speciesName"], "dex": dex, "types": [t for t in bp["types"] if t != "none"],
            "best": c["variant"], "uses": [{k: u[k] for k in ("list", "rank", "name")} for u in uses],
            "km": km, "candyNeed": round(need), "evoCandy": evo_candy, "kmAll": round(km_all),
            "useful": round(c["u"] * 100), "score": round(score * 100, 2), "shadowBuild": c["shadow"],
        }
        if m:
            per_km = m["award"] / km
            item["mega"] = {"perKm": per_km, "initial": m["initial"], "subsequent": m["subsequent"],
                            "kmFirst": round(m["initial"] / per_km), "kmNext": round(m["subsequent"] / per_km), "used": c["megaUsed"]}
            if m.get("level4"):
                l4 = m["level4"]
                item["mega"]["level4"] = {**l4, "kmUnlock": round((l4.get("unlock") or 0) / per_km)}
        out.append(item)
    out.sort(key=lambda x: -x["score"])
    return {"list": out[:n], "upgradeCandy": upgrade}


def ranking(items, n):
    items = sorted(items, key=lambda x: -x["score"])
    out, seen = [], set()
    for x in items:
        if x["id"] in seen:
            continue
        seen.add(x["id"])
        out.append(x)
        if len(out) >= n:
            break
    top = out[0]["score"] if out else 1
    for x in out:
        x["pct"] = round(x["score"] / top * 100, 1)
    return out


def load_mega_levels(gm):
    """メガレベルごとの効果（同じタイプのポケモンを捕まえたときのアメ追加など）"""
    out = {}
    for x in gm:
        m = x.get("data", {}).get("megaEvoLevelSettings")
        if m and m.get("level") is not None and x["templateId"].startswith("MEGA_EVOLUTION_LEVEL_") and x["templateId"].count("_") == 3:
            e = m.get("effects", {})
            out[str(m.get("level"))] = {"extraCandy": e.get("sameTypeExtraCatchCandy", 0), "xlChance": e.get("sameTypeExtraCatchCandyXlChance", 0),
                                        "extraXp": e.get("sameTypeExtraCatchXp", 0), "sameTypeAttack": e.get("sameTypeAttackBoost"),
                                        "otherTypeAttack": e.get("differentTypeAttackBoost")}
    return out


def load_type_boosts(gm):
    """ゲンシカイキ・メガレックウザなど、効果のあるタイプが別に決められているもの（PRIMAL_EVO_SETTINGS.typeBoosts）"""
    out = {}
    for x in gm:
        pe = x.get("data", {}).get("primalEvoSettings")
        if pe:
            for b in pe.get("typeBoosts", []):
                out[b["pokemonId"].lower()] = [t.replace("POKEMON_TYPE_", "").lower() for t in b.get("boostType", [])]
    return out


REGION_FORM = {"ALOLA": "Alolan", "GALARIAN": "Galarian", "HISUIAN": "Hisuian", "PALDEA": "Paldean"}


def load_catch_dust(gm):
    """捕まえたときに追加でもらえるほしのすな（encounter.bonusStardustCaptureReward）。
    (図鑑番号, リージョン名 or None) → 量"""
    out = {}
    for x in gm:
        ps = x.get("data", {}).get("pokemonSettings")
        if not ps:
            continue
        v = (ps.get("encounter") or {}).get("bonusStardustCaptureReward")
        if not v:
            continue
        try:
            dex = int(x["templateId"][1:5])
        except ValueError:
            continue
        form = str(ps.get("form") or "")
        region = None
        for k, name in REGION_FORM.items():
            if form.endswith("_" + k):
                region = name
        out.setdefault((dex, region), v)
    return out


def build_megas(pokemon, mega_cost, levels, boosts=None, catch_dust=None):
    """イベント画面用：メガシンカできるポケモンの一覧と、ポケモン名（英語）→タイプの表"""
    megas = []
    for p in pokemon:
        tags = p.get("tags", [])
        if "mega" not in tags or "shadow" in tags:
            continue
        c = mega_cost.get(p["dex"], {})
        types = [t for t in p["types"] if t != "none"]
        boost = (boosts or {}).get(base_id(p["speciesId"]))
        megas.append({"id": p["speciesId"], "name": p["speciesName"], "types": types, "boostTypes": boost or types,
                      "level4": bool(c.get("level4")),
                      "legendary": "legendary" in tags or "mythical" in tags,
                      "initial": c.get("initial"), "subsequent": c.get("subsequent")})
    types, buddy = {}, {}
    regional = {"Alolan": "Alolan", "Galarian": "Galarian", "Hisuian": "Hisuian", "Paldean": "Paldean"}
    for p in pokemon:
        if "shadow" in p.get("tags", []) or "mega" in p.get("tags", []):
            continue
        name = p["speciesName"]
        t = [x for x in p["types"] if x != "none"]
        if "(" not in name:
            types.setdefault(name, t)
            buddy.setdefault(name, p.get("buddyDistance"))
        else:
            base, form = name.split(" (", 1)
            form = form.rstrip(")")
            if form in regional:
                types.setdefault(f"{form} {base}", t)
                buddy.setdefault(f"{form} {base}", p.get("buddyDistance"))
            types.setdefault(base, t)   # フォルム違いは最初に見つかったものを代表に
            buddy.setdefault(base, p.get("buddyDistance"))
    # 捕まえたときに追加でもらえるほしのすな（英語名 → 量）
    dust = {}
    for p in pokemon:
        tags = p.get("tags", [])
        if "shadow" in tags or "mega" in tags:
            continue
        name = p["speciesName"]
        m = re.match(r"^(.+?) \((Alolan|Galarian|Hisuian|Paldean)\)$", name)
        key, region = (f"{m.group(2)} {m.group(1)}", m.group(2)) if m else (name.split(" (")[0], None)
        v = (catch_dust or {}).get((p["dex"], region)) or (None if region else (catch_dust or {}).get((p["dex"], None)))
        if v and key not in dust:
            dust[key] = v
    return {"schema": SCHEMA, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "levels": levels, "megas": megas, "types": types, "buddyKm": buddy, "catchDust": dust}


RAIDS_URL = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/raids.json"
HIGH_TIER = re.compile(r"5-Star|Mega|Elite|Primal|6-Star|Legendary|Ultra Beast", re.I)
BOSS_CPM = 0.79
WEATHER_JA = {"sunny": "晴れ", "clear": "晴れ", "rainy": "雨", "partly cloudy": "ときどきくもり", "cloudy": "くもり",
              "windy": "強風", "snow": "雪", "fog": "霧"}


def raid_name_candidates(name):
    """ScrapedDuck のボス名（"Shadow Tornadus (Incarnate)" "Mega Charizard Y" など）→ PvPoke の名前の候補"""
    s = name.strip()
    shadow = s.startswith("Shadow ")
    if shadow:
        s = s[len("Shadow "):]
    pre = None
    m = re.match(r"^(Mega|Primal) (.+?)(?: ([XY]))?$", s)
    if m:
        pre = "Mega " + m.group(3) if m.group(1) == "Mega" and m.group(3) else m.group(1)
        s = m.group(2)
    form = ""
    fm = re.match(r"^(.+?) (\(.+\))$", s)
    if fm:
        s, form = fm.group(1), " " + fm.group(2)
    reg = re.match(r"^(Alolan|Galarian|Hisuian|Paldean) (.+)$", s)
    region = ""
    if reg:
        region, s = f" ({reg.group(1)})", reg.group(2)
    tail = (f" ({pre})" if pre else "") + (" (Shadow)" if shadow else "")
    return [s + region + form + tail, s + region + tail, s + tail, s]


def usefulness_index(lists, max_rank=20):
    """speciesId → (役立ち度 0〜1, 代表の使い道)"""
    out = {}
    for label, lst, w in lists:
        for rank, x in enumerate(lst[:max_rank], 1):
            u = x["pct"] / 100 * w
            if u > out.get(x["id"], (0, None))[0]:
                out[x["id"]] = (u, f"{label} {rank}位")
    return out


def build_raids(pokemon, pve, move_ja, move_en, lists, mega):
    raw = json.loads(get(RAIDS_URL))
    by_name = {}
    for p in pokemon:
        by_name.setdefault(p["speciesName"], p)
    useful = usefulness_index(lists)
    bosses = []
    for r in raw:
        tier = r.get("tier") or ""
        if not HIGH_TIER.search(tier):
            continue
        p = next((by_name[c] for c in raid_name_candidates(r["name"]) if c in by_name), None)
        if not p:
            print(f"::warning::レイドボスが見つかりません: {r['name']}")
            continue
        tags = set(p.get("tags", []))
        shadow = r["name"].startswith("Shadow ")
        is_mega_raid = bool(re.search(r"Mega|Primal", tier, re.I)) or "mega" in tags
        boss_types = [t for t in p["types"] if t != "none"] or [t["name"] for t in r.get("types", [])]
        boss_def = (p["baseStats"]["def"] + 15) * BOSS_CPM
        # 有利なポケモン
        counters = []
        for a in pokemon:
            b = best_attack(a, pve, boss_def, boss_types)
            if b:
                counters.append(entry(a, b, move_ja, move_en))
        # 画面で「メガ・シャドウ・伝説を含めない」にしても3匹出せるよう、上位30匹に加えて
        # メガ・伝説以外の上位15匹、メガ・シャドウ・伝説以外の上位10匹も持っておく
        allc = ranking(counters, 400)
        plain1 = [x for x in allc if not x["mega"] and not (x["legendary"] or x["mythical"] or x["ultrabeast"])][:15]
        plain2 = [x for x in allc if not x["mega"] and not x["shadow"] and not (x["legendary"] or x["mythical"] or x["ultrabeast"])][:10]
        keep, seen_ids = [], set()
        for x in allc[:30] + plain1 + plain2:
            if x["id"] not in seen_ids:
                seen_ids.add(x["id"]); keep.append(x)
        counters = sorted(keep, key=lambda x: -x["score"])
        # 周回おすすめ度
        legend = bool({"legendary", "mythical", "ultrabeast"} & tags)
        base = by_name.get(p["speciesName"].split(" (")[0])
        pts, reasons = 0.0, []
        if shadow and legend:
            pts += 1.5; reasons.append("シャドウの伝説：シャドウレイドでしか手に入らず、開催も限られる")
        elif re.search(r"Elite", tier, re.I):
            pts += 1.5; reasons.append("エリートレイド：開催が少ない")
        elif is_mega_raid and legend:
            pts += 1; reasons.append("伝説のメガ・ゲンシのレイドは開催が限られる")
        elif legend:
            pts += 1; reasons.append("伝説：レイドでしか手に入らない")
        if legend:
            pts += 1; reasons.append("アメが集めにくい（相棒20km、ほぼレイド頼み）")
        elif base and (base.get("buddyDistance") or 0) >= 5:
            pts += 0.5; reasons.append(f"アメ集めがやや大変（相棒{base.get('buddyDistance')}km）")
        if is_mega_raid:
            u_mega, use_mega = useful.get(p["speciesId"], (0, None))
            m = mega.get(p["dex"], {})
            pts += 2 * u_mega
            if use_mega:
                reasons.append(f"メガ後が強い（{use_mega}）")
            if m.get("level4"):
                pts += 0.5; reasons.append("メガレベル4対応（エナジーが5000必要）")
            reasons.append("メガエナジーは主にメガレイドで集める")
        if "regional" in tags or (base and "regional" in base.get("tags", [])):
            pts += 1; reasons.append("地域限定ポケモン（地域によっては野生で出ない）")
        # 捕まえたポケモンを育てたときの恩恵
        caught_id = p["speciesId"] if (shadow or not is_mega_raid) else base_id(p["speciesId"])
        u_caught, use_caught = useful.get(caught_id, (0, None))
        if not is_mega_raid and not shadow:
            for v in (p["speciesId"] + "_mega", p["speciesId"] + "_mega_x", p["speciesId"] + "_mega_y", p["speciesId"] + "_primal"):
                if v in useful and useful[v][0] * 0.8 > u_caught:
                    u_caught, use_caught = useful[v][0] * 0.8, useful[v][1] + "（メガ・ゲンシ後）"
        pts += 2 * u_caught
        if use_caught and not is_mega_raid:
            reasons.append(f"育てると強い（{use_caught}）")
        if not use_caught and not is_mega_raid:
            reasons.append("攻撃・ジムのランキングには入っていない")
        stars = 1 if pts < 1.5 else 2 if pts < 2.5 else 3 if pts < 3.5 else 4 if pts < 4.5 else 5
        cp = r.get("combatPower") or {}
        bosses.append({
            "name": r["name"], "id": p["speciesId"], "speciesName": p["speciesName"], "tier": tier, "shadow": shadow, "mega": is_mega_raid,
            "types": boss_types, "shiny": bool(r.get("canBeShiny")), "image": r.get("image"),
            "weather": [WEATHER_JA.get((w.get("name") or "").lower(), w.get("name")) for w in r.get("boostedWeather", [])],
            "cp": cp.get("normal"), "cpBoosted": cp.get("boosted"),
            "rating": {"stars": stars, "points": round(pts, 2), "reasons": reasons},
            "counters": counters,
        })
    order = {"5": 0, "Mega": 1}
    bosses.sort(key=lambda b: (-b["rating"]["stars"], b["mega"], b["name"]))
    return {"schema": SCHEMA, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "bosses": bosses}


ROCKET_URL = "https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/rocketLineups.json"
ROCKET_JA = {"Giovanni": "サカキ", "Cliff": "クリフ", "Arlo": "アルロ", "Sierra": "シエラ"}


PVP_URL = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/all/overall/rankings-{cp}.json"
PVP_LEAGUES = [(1500, "スーパーリーグ", 100), (2500, "ハイパーリーグ", 100), (10000, "マスターリーグ", 50)]   # (CP上限, 名前, 何位までを「使える」とするか)


PVP_ALL = {}   # speciesId → {リーグ名: 順位}（基準以内）。load_pvp_ranks() が埋める
PVP_MOVES = {}  # speciesId → {リーグ名: [技1, 技2, 技2]}（PvPoke のおすすめ技構成）


def load_pvp_ranks():
    """speciesId → (リーグ名, 順位, 順位/基準) のうち、いちばん良いもの（基準以内のものだけ）"""
    out = {}
    for cp, name, limit in PVP_LEAGUES:
        try:
            data = json.loads(get(PVP_URL.format(cp=cp)))
        except Exception as ex:
            print(f"::warning::PvPランキング（{name}）を取得できませんでした: {ex}")
            continue
        for rank, x in enumerate(data[:limit], 1):
            PVP_ALL.setdefault(x["speciesId"], {})[name] = rank
            if x.get("moveset"):
                PVP_MOVES.setdefault(x["speciesId"], {})[name] = list(x["moveset"])
            r = (name, rank, rank / limit)
            if x["speciesId"] not in out or r[2] < out[x["speciesId"]][2]:
                out[x["speciesId"]] = r
    return out


# ===== GOバトルリーグ（gbl.json） =====
GBL_RANK_URL = "https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data/rankings/{cup}/overall/rankings-{cp}.json"
LEAGUE_WORDS = [("Little", 500), ("Great", 1500), ("Ultra", 2500), ("Master", 10000)]
GBL_TOP = 50          # 各リーグで保存する上位の数
GBL_FROM_LEVEL = 20   # 育成コストは、レイド・リサーチで捕まえたときのレベル20から数える
UPGRADE_COST = {}


def load_upgrade_costs(gm):
    for x in gm:
        if x.get("templateId") == "POKEMON_UPGRADE_SETTINGS":
            u = x["data"]["pokemonUpgrades"]
            return {"dust": u.get("stardustCost") or [], "candy": u.get("candyCost") or [], "xl": u.get("xlCandyCost") or [],
                    "shadow": u.get("shadowStardustMultiplier") or 1.2}
    return {}


def cpm_at(lv):
    i = int(lv) - 1
    if lv == int(lv):
        return CPM_TABLE[i]
    a, b = CPM_TABLE[i], CPM_TABLE[i + 1]
    return math.sqrt((a * a + b * b) / 2)


def cp_of(stats, iv, lv):
    a, d, h = stats
    m = cpm_at(lv)
    return max(10, math.floor((a + iv[0]) * math.sqrt(d + iv[1]) * math.sqrt(h + iv[2]) * m * m / 10))


def upgrade_cost(lv_from, lv_to, shadow=False):
    """レベル lv_from → lv_to の強化に必要な（ほしのすな, アメ, アメXL）"""
    dust = candy = xl = 0
    lv = lv_from
    while lv < lv_to - 1e-9:
        i = int(lv) - 1
        dust += UPGRADE_COST["dust"][i] if i < len(UPGRADE_COST["dust"]) else 0
        if int(lv) < 40:
            candy += UPGRADE_COST["candy"][i] if i < len(UPGRADE_COST["candy"]) else 0
        else:
            j = int(lv) - 40
            xl += UPGRADE_COST["xl"][j] if j < len(UPGRADE_COST["xl"]) else 0
        lv += 0.5
    if shadow:
        dust, candy, xl = round(dust * UPGRADE_COST.get("shadow", 1.2)), math.ceil(candy * 1.2), math.ceil(xl * 1.2)
    return dust, candy, xl


def gbl_target_level(stats, cap):
    """PvP向けによく使う個体（攻撃0・防御15・HP15）が、CP上限に収まる最大のレベル（50まで）。マスターリーグは40"""
    if cap >= 10000:
        return 40.0
    best = None
    lv = 1.0
    while lv <= 50:
        if cp_of(stats, (0, 15, 15), lv) <= cap:
            best = lv
        lv += 0.5
    return best


def gbl_rules(cup, by_id=None):
    """PvPoke のカップの決まり → 表示用（タイプ・タグ・使えないポケモン）"""
    r = {"includeTypes": [], "excludeTypes": [], "excludeTags": [], "excludeIds": [], "megaAllowed": True}
    for f in cup.get("include") or []:
        if f.get("filterType") == "type":
            r["includeTypes"] += f.get("values") or []
    for f in cup.get("exclude") or []:
        t, v = f.get("filterType"), f.get("values") or []
        if t == "type":
            r["excludeTypes"] += v
        elif t == "tag":
            r["excludeTags"] += v
        elif t == "id":
            r["excludeIds"] += v
    if "mega" in r["excludeTags"]:
        r["megaAllowed"] = False
    # 使えないポケモンは英語名でも持つ（画面で日本語にする）
    r["excludeNames"] = [(by_id or {}).get(i, {}).get("speciesName", i) for i in r["excludeIds"]]
    if len(set(r["includeTypes"])) >= 18:   # 全タイプが入っているのは「制限なし」と同じ
        r["includeTypes"] = []
    return r


def gbl_allowed(p, rules):
    """カップの決まり（使えるタイプ・使えないタイプ・使えないタグ・使えないポケモン）に合うか"""
    sid = p["speciesId"]
    types = {t for t in p["types"] if t != "none"}
    tags = set(p.get("tags") or [])
    if re.search(r"_(mega|mega_[xyz]|primal)$", sid):
        tags.add("mega")
    if sid in rules["excludeIds"]:
        return False
    if rules["excludeTypes"] and types & set(rules["excludeTypes"]):
        return False
    if rules["includeTypes"] and not types & set(rules["includeTypes"]):
        return False
    if tags & set(rules["excludeTags"]):
        return False
    return True


def split_gbl_name(name):
    """「Ultra League, Master League: Mega Edition, and 2026 GO LAIC Cup | Twilight Trails」→ リーグごとに分ける。
    「: Mega Edition」は、そのリーグだけにかかる（LeekDuck のイベントページの見出しが「Ultra League」「Master League: Mega Edition」と分かれているため）"""
    s = re.sub(r"\s*\|.*$", "", name or "").strip()
    return [p.strip() for p in re.split(r",\s*(?:and\s+)?|\s+and\s+", s) if p.strip()]


def gbl_cup_for(label, formats, cups):
    """リーグ名 → (PvPoke のカップ名, CP上限, 表示名用の種類)。見つからなければ None"""
    cp = next((c for w, c in LEAGUE_WORDS if re.search(rf"\b{w} League", label)), None)
    low = label.lower()
    if "catch cup" in low:
        f = next((f for f in formats if f.get("cup") == "catch"), None)
        return ("catch", cp or (f or {}).get("cp", 1500), "special")
    if "laic" in low:
        f = next((f for f in formats if "laic" in f.get("cup", "") and "gbl" in f.get("cup", "")), None) \
            or next((f for f in formats if "laic" in f.get("cup", "")), None)
        if f:
            return (f["cup"], cp or f.get("cp", 1500), "special")
    if re.search(r"mega edition|^mega ", low) and cp:
        return ("mega", cp, "mega")
    if cp and re.fullmatch(r"(Little|Great|Ultra|Master) League", label.strip()):
        return ("all", cp, "normal")
    # そのほかのカップ：PvPoke の形式名と単語で照らし合わせる
    words = set(re.findall(r"[a-z]+", low)) - {"cup", "league", "edition", "the", "go", "great", "ultra", "master"}
    for f in formats:
        fw = set(re.findall(r"[a-z]+", (f.get("title", "") + " " + f.get("cup", "")).lower()))
        if words and words & fw:
            return (f["cup"], cp or f.get("cp", 1500), "special")
    return None


def build_gbl(pv, move_ja, move_en, events):
    """今と、これから2週間のGOバトルリーグのリーグごとに、ルールとおすすめポケモン（PvPoke のランキング＋育成コスト）"""
    now = dt.datetime.now(dt.timezone.utc)
    by_id = {p["speciesId"]: p for p in pv["pokemon"]}
    cups = {c["name"]: c for c in pv.get("cups") or []}
    formats = pv.get("formats") or []
    evs, need = [], {}
    for e in events:
        if e.get("eventType") != "go-battle-league" or not e.get("start") or not e.get("end"):
            continue
        st = dt.datetime.fromisoformat(e["start"].replace("Z", "+00:00"))
        en = dt.datetime.fromisoformat(e["end"].replace("Z", "+00:00"))
        if st.tzinfo is None:   # 現地時間の書き方なら日本時間とみなす
            st, en = st.replace(tzinfo=dt.timezone(dt.timedelta(hours=9))), en.replace(tzinfo=dt.timezone(dt.timedelta(hours=9)))
        if en < now or st > now + dt.timedelta(days=14):
            continue
        leagues = []
        for label in split_gbl_name(e.get("name", "")):
            c = gbl_cup_for(label, formats, cups)
            if c:
                key = f"{c[0]}-{c[1]}"
                need[key] = c
            leagues.append({"label": label, "key": f"{c[0]}-{c[1]}" if c else None, "kind": c[2] if c else "unknown"})
        evs.append({"id": e.get("eventID"), "name": e.get("name"), "start": e["start"], "end": e["end"], "link": e.get("link"), "leagues": leagues})
    leagues = {}
    for key, (cup, cp, kind) in need.items():
        try:
            data = json.loads(get(GBL_RANK_URL.format(cup=cup, cp=cp)))
        except Exception as ex:
            print(f"::warning::GBL ランキング {cup}/{cp}: {ex}")
            continue
        c = cups.get(cup) or {}
        rules = gbl_rules(c, by_id) if c else None
        top = []
        for x in data:
            if len(top) >= GBL_TOP:
                break
            p = by_id.get(x["speciesId"])
            if not p:
                continue
            # PvPoke のランキングがカップの決まりより古いことがあるので、決まりに合わないポケモンは除く
            if rules and not gbl_allowed(p, rules):
                continue
            b = p["baseStats"]
            stats = (b["atk"], b["def"], b["hp"])
            shadow = "_shadow" in x["speciesId"]
            lv = gbl_target_level(stats, cp)
            dust, candy, xl = upgrade_cost(GBL_FROM_LEVEL, lv, shadow) if lv and lv > GBL_FROM_LEVEL else (0, 0, 0)
            elite = set(p.get("eliteMoves") or [])
            top.append({"id": x["speciesId"], "name": x["speciesName"], "score": x.get("score"), "types": [t for t in p["types"] if t != "none"],
                        "moves": [{"ja": move_ja.get(m), "en": move_en.get(m, m), "elite": m in elite} for m in x.get("moveset") or []],
                        "lv": lv, "dust": dust, "candy": candy, "xl": xl,
                        "tags": [t for t in ("legendary", "mythical", "ultrabeast", "mega", "shadow") if t in (p.get("tags") or [])]})
        f = next((f for f in formats if f.get("cup") == cup and f.get("cp") == cp), {})
        leagues[key] = {"cup": cup, "cp": cp, "kind": kind, "title": f.get("title") or c.get("title") or cup,
                        "rules": rules, "top": top}
    return {"schema": SCHEMA, "generatedAt": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
            "fromLevel": GBL_FROM_LEVEL, "events": evs, "leagues": leagues}


CPM_TABLE = []   # レベル1〜のCP補正値（ゲームデータの PLAYER_LEVEL_SETTINGS）


def load_cpm(gm):
    for x in gm:
        if x.get("templateId") == "PLAYER_LEVEL_SETTINGS":
            return list(x["data"]["playerLevel"].get("cpMultiplier") or [])
    return []


def build_pokedex(pokemon, pvp, move_ja=None, move_en=None, dmax=frozenset(), gmax=frozenset()):
    """ポケモン検索ページ用：実装済みのポケモンの名前・タイプ・進化系統・相棒の距離・PvPの順位"""
    species = []
    # 系統（family）が無いフォルム違い（ロトム・デオキシス・オドリドリなど）は、同じ図鑑番号でまとめる
    fam_by_dex = {}
    for p in pokemon:
        f = (p.get("family") or {}).get("id")
        if f:
            fam_by_dex.setdefault(p["dex"], f)
    for p in pokemon:
        tags = p.get("tags", [])
        fam = (p.get("family") or {}).get("id") or fam_by_dex.get(p["dex"]) or f"FAMILY_DEX_{p['dex']}"
        b = p["baseStats"]
        item = {"id": p["speciesId"], "name": p["speciesName"], "dex": p["dex"], "types": [t for t in p["types"] if t != "none"],
                "family": fam, "buddy": p.get("buddyDistance"), "stats": [b["atk"], b["def"], b["hp"]]}
        evo = (p.get("family") or {}).get("evolutions")
        if evo:
            item["evo"] = evo
        if PVP_ALL.get(p["speciesId"]):
            item["pvpAll"] = PVP_ALL[p["speciesId"]]
        if PVP_MOVES.get(p["speciesId"]):
            elite = set(p.get("eliteMoves", []))
            item["pvpMoves"] = {lg: [{"id": m, "ja": (move_ja or {}).get(m), "en": (move_en or {}).get(m, m), "elite": m in elite} for m in ms]
                                for lg, ms in PVP_MOVES[p["speciesId"]].items()}
        flags = [t for t in ("legendary", "mythical", "ultrabeast", "mega", "shadow", "regional") if t in tags]
        if p["speciesId"].startswith("necrozma") and "ultrabeast" in flags:   # ネクロズマは伝説（PvPoke ではウルトラビースト扱い）
            flags = ["legendary" if t == "ultrabeast" else t for t in flags]
        if flags:
            item["tags"] = flags
        if p["speciesId"] in dmax or p["speciesId"] in gmax:
            item["dmax"] = True
        if p["speciesId"] in gmax:
            item["gmax"] = True
        # 育成難易度（技の★は種族ごとには決まらないので入れない）
        item["diff"] = difficulty(p, {}, EVO)
        pr = pvp.get(p["speciesId"])
        if pr:
            item["pvp"] = [pr[0], pr[1]]
        species.append(item)
    return {"schema": SCHEMA, "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "cpm": CPM_TABLE[:51], "species": species}


# ===== 本編では進化するが、ポケモンGOにはまだ進化先がいないポケモン（ジュラルドン→ブリジュラスなど） =====
SPECIES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species.csv"
SPECIES_NAMES_CSV = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv"
# 本編で、地域の姿からだけ進化するもの（進化先の図鑑番号 → 進化できる姿の id の末尾）
REGIONAL_EVO_FORM = {862: "_galarian", 863: "_galarian", 864: "_galarian", 865: "_galarian", 866: "_galarian", 867: "_galarian",
                     903: "_hisuian", 904: "_hisuian", 980: "_paldean"}
# 本編での進化の決まりのうち、GOで進化できるかに関わるもの（進化先の図鑑番号 → 説明）
FUTURE_EVO_NOTE = {902: "本編では「しろすじのすがた」のバスラオだけが進化します"}


def add_future_evos(species, prev_path=None):
    """species（build_pokedex の結果）の各ポケモンに、本編にはいるがGOにはまだいない進化先を futureEvo として付ける。
    本編の進化のつながりは PokeAPI の表を使う。読めなければ前回の pokedex.json の値を使う"""
    go_dex = {x["dex"] for x in species}
    found = None
    try:
        rows = list(csv.DictReader(io.StringIO(get(SPECIES_CSV).decode("utf-8"))))
        names = {}
        for r in csv.reader(io.StringIO(get(SPECIES_NAMES_CSV).decode("utf-8"))):
            if len(r) >= 3 and r[1] in ("9", "11"):
                names.setdefault(r[0], {})["en" if r[1] == "9" else "ja"] = r[2]
        found = {}
        for r in rows:
            f = r.get("evolves_from_species_id")
            if not f:
                continue
            child = int(r["id"])
            if int(f) in go_dex and child not in go_dex:
                n = names.get(r["id"], {})
                ent = {"dex": child, "name": n.get("en") or r["identifier"].title(), "ja": n.get("ja") or ""}
                if child in FUTURE_EVO_NOTE:
                    ent["note"] = FUTURE_EVO_NOTE[child]
                found.setdefault(int(f), []).append(ent)
    except Exception as ex:
        print(f"::warning::本編の進化（PokeAPI）を読めませんでした: {ex}")
    if found is None:
        try:
            with open(prev_path, encoding="utf-8") as fp:
                prev = {x["id"]: x["futureEvo"] for x in json.load(fp).get("species", []) if x.get("futureEvo")}
            for x in species:
                if x["id"] in prev:
                    x["futureEvo"] = prev[x["id"]]
            print("futureEvo: 前回の値を使いました", len(prev))
        except Exception as ex:
            print(f"futureEvo: 前回の値も使えませんでした: {ex}")
        return
    n = 0
    for x in species:
        if "mega" in (x.get("tags") or []):
            continue
        evs = [e for e in found.get(x["dex"], [])
               if e["dex"] not in REGIONAL_EVO_FORM or x["id"].replace("_shadow", "").endswith(REGIONAL_EVO_FORM[e["dex"]])]
        # 地域の姿は、本編でその姿からだけ進化するもの以外は付けない（例：ガラルのすがたからしか進化しないもの）
        if re.search(r"_(alolan|galarian|hisuian|paldean)", x["id"]):
            evs = [e for e in evs if e["dex"] in REGIONAL_EVO_FORM]
        if evs:
            x["futureEvo"] = evs; n += 1
    print("futureEvo:", n, sorted({e["name"] for v in found.values() for e in v}))


def build_evo_use(pokemon, lists, pvp=None):
    """リサーチなどで出会うポケモン（通常の姿）が、進化・メガシンカ後にどれくらい役立つか。
    英語名（"Alolan Geodude" 形式）→ {"u": 役立ち度, "best": 役立つ姿, "use": 使い道}（役立ち度0のものは省略）"""
    by_id = {p["speciesId"]: p for p in pokemon}
    useful = usefulness_index(lists, max_rank=30)   # 通常の姿はシャドウより順位が下がりやすいので30位まで見る
    # アタッカー（レイド・ジム攻撃）だけの役立ち度：個体値が高いほど良い使い道。
    # リサーチなどの「個体値が最低10」の出会いで価値があるのはこちら（ジム防衛は個体値の影響が小さく、野生で捕まえても同じ）
    useful_atk = usefulness_index([l for l in lists if l[0] != "ジム防衛"], max_rank=30)
    out = {}
    for p in pokemon:
        tags = p.get("tags", [])
        if "shadow" in tags or "mega" in tags:
            continue
        best = (0.0, None, None)
        best_atk = (0.0, None, None)
        best_pvp = None
        best_ml = None
        todo, seen = [p], set()
        while todo:
            q = todo.pop()
            if q["speciesId"] in seen:
                continue
            seen.add(q["speciesId"])
            for vid, f in [(q["speciesId"], 1.0)] + [(q["speciesId"] + suf, 0.8) for suf in ("_mega", "_mega_x", "_mega_y", "_primal")]:
                if vid in useful and useful[vid][0] * f > best[0]:
                    best = (useful[vid][0] * f, by_id[vid]["speciesName"] if vid in by_id else q["speciesName"], useful[vid][1])
                if vid in useful_atk and useful_atk[vid][0] * f > best_atk[0]:
                    best_atk = (useful_atk[vid][0] * f, by_id[vid]["speciesName"] if vid in by_id else q["speciesName"], useful_atk[vid][1])
            pr = (pvp or {}).get(q["speciesId"])
            if pr and (best_pvp is None or pr[2] < best_pvp["ratio"]):
                best_pvp = {"league": pr[0], "rank": pr[1], "ratio": pr[2], "best": q["speciesName"]}
            # マスターリーグ（個体値が高いほど良い）
            ml = PVP_ALL.get(q["speciesId"], {}).get("マスターリーグ")
            if ml and (best_ml is None or ml < best_ml["rank"]):
                best_ml = {"rank": ml, "best": q["speciesName"]}
            for e in (q.get("family") or {}).get("evolutions") or []:
                if e in by_id:
                    todo.append(by_id[e])
        if best[0] <= 0 and not best_pvp:
            continue
        name = p["speciesName"]
        m = re.match(r"^(.+?) \((Alolan|Galarian|Hisuian|Paldean)\)$", name)
        key = f"{m.group(2)} {m.group(1)}" if m else name
        cur = out.get(key)
        if not cur or best[0] > cur["u"] or (best_pvp and not cur.get("pvp")):
            item = {"u": round(best[0], 3), "best": best[1], "use": best[2]}
            if best_atk[0] > 0:
                item["ua"] = round(best_atk[0], 3)
                item["bestA"], item["useA"] = best_atk[1], best_atk[2]
            if best_pvp:
                item["pvp"] = {k: best_pvp[k] for k in ("league", "rank", "best")}
            if best_ml:
                item["ml"] = best_ml
            out[key] = item
    return out


def build_rocket(pokemon, lists):
    """GOロケット団：倒すと捕まえられるシャドウポケモンの「育てたときの強さ」から、闘う優先度を出す。
    価値 = 進化後（シャドウ）のランキングでの強さ（リトレーン後は0.8倍）＋伝説 0.3 ＋ 野生で少ない（相棒5km以上）0.1
    したっぱは捕まえられる候補が複数あり、どれが出るかの確率は不明なので、同じ確率と仮定して平均する。"""
    raw = json.loads(get(ROCKET_URL))
    by_id = {p["speciesId"]: p for p in pokemon}
    all_by_name = {}
    for p in pokemon:
        all_by_name.setdefault(p["speciesName"], p)
    useful = usefulness_index(lists)

    def find(name):
        for c in raid_name_candidates(name):
            if c in all_by_name:
                return all_by_name[c]
        return None

    def descendants(p):
        out, todo, seen = [], [p], set()
        while todo:
            q = todo.pop()
            if q["speciesId"] in seen:
                continue
            seen.add(q["speciesId"]); out.append(q)
            for e in (q.get("family") or {}).get("evolutions") or []:
                if e in by_id:
                    todo.append(by_id[e])
        return out

    trainers = []
    for t in raw:
        title = t.get("title") or ""
        kind = "boss" if "Boss" in title else "leader" if "Leader" in title else "grunt"
        cands, seen = [], set()
        for slot in ("firstPokemon", "secondPokemon", "thirdPokemon"):
            for x in t.get(slot) or []:
                if x.get("isEncounter") and x["name"] not in seen:
                    seen.add(x["name"]); cands.append(x)
        if not cands or "Decoy" in (t.get("name") or ""):
            continue   # ニセモノのしたっぱ（サカキの変装）は自分で選んで戦えないので除外
        items = []
        for x in cands:
            p = find(x["name"])
            best_u, best_use, best_name = 0.0, None, None
            legend = False
            if p:
                legend = bool({"legendary", "mythical"} & set(p.get("tags", [])))
                for d in descendants(p):
                    sh = d["speciesId"] + "_shadow"
                    if sh in useful and useful[sh][0] > best_u:
                        best_u, best_use, best_name = useful[sh][0], useful[sh][1], by_id[sh]["speciesName"] if sh in by_id else d["speciesName"] + " (Shadow)"
                    if d["speciesId"] in useful and useful[d["speciesId"]][0] * 0.8 > best_u:
                        best_u, best_use, best_name = useful[d["speciesId"]][0] * 0.8, useful[d["speciesId"]][1] + "（リトレーン後）", d["speciesName"]
            rare = bool(p and (p.get("buddyDistance") or 0) >= 5)
            v = best_u + (0.3 if legend else 0) + (0.1 if rare else 0)
            items.append({"name": x["name"], "species": p["speciesName"] if p else x["name"], "image": x.get("image"),
                          "types": x.get("types") or [], "shiny": bool(x.get("canBeShiny")), "legendary": legend, "rare": rare,
                          "best": best_name, "use": best_use, "value": round(v, 3)})
        score = sum(i["value"] for i in items) / len(items)
        name = t.get("name") or ""
        trainers.append({"name": name, "nameJa": ROCKET_JA.get(name), "kind": kind, "type": t.get("type") or "",
                         "female": "Female" in name, "decoy": "Decoy" in name,
                         "score": round(score, 3), "best": max(items, key=lambda i: i["value"]),
                         "encounters": sorted(items, key=lambda i: -i["value"]),
                         "lineup": [[{"name": x["name"], "types": x.get("types") or []} for x in (t.get(sl) or [])]
                                    for sl in ("firstPokemon", "secondPokemon", "thirdPokemon")]})
    trainers.sort(key=lambda t: -t["score"])
    for i, t in enumerate(trainers, 1):
        t["rank"] = i
    return trainers


def main(prev_path, out_path, prev_megas_path=None, out_megas_path=None, prev_raids_path=None, out_raids_path=None):
    prev_megas = None
    if prev_megas_path:
        try:
            with open(prev_megas_path, encoding="utf-8") as f:
                prev_megas = json.load(f)
        except Exception:
            prev_megas = None
    try:
        with open(prev_path, encoding="utf-8") as f:
            prev = json.load(f)
        age = dt.datetime.now(dt.timezone.utc) - dt.datetime.fromisoformat(prev["generatedAt"].replace("Z", "+00:00"))
        megas_ok = not out_megas_path or (prev_megas and prev_megas.get("schema") == SCHEMA)
        if age < dt.timedelta(hours=FRESH_HOURS) and prev.get("raid") and prev.get("schema") == SCHEMA and megas_ok:
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(prev, f, ensure_ascii=False)
            if out_megas_path:
                with open(out_megas_path, "w", encoding="utf-8") as f:
                    json.dump(prev_megas, f, ensure_ascii=False)
            print(f"前回のランキングを再利用（{age} 前に計算）")
            return
    except Exception:
        prev = None
    megas_data = prev_megas
    pokedex_data = None
    gbl_data = None
    raids_data = None
    if prev_raids_path:
        try:
            with open(prev_raids_path, encoding="utf-8") as f:
                raids_data = json.load(f)
        except Exception:
            raids_data = None

    try:
        pv = json.loads(get(PVPOKE))
        gm = json.loads(get(GAME_MASTER))
        pve = load_pve_moves(gm)
        EVO.update(load_evolutions(gm))
        MEGA, UPGRADE = load_buddy_extra(gm)
        MEGA_LEVELS = load_mega_levels(gm)
        TYPE_BOOSTS = load_type_boosts(gm)
        CATCH_DUST = load_catch_dust(gm)
        CPM_TABLE[:] = load_cpm(gm)
        UPGRADE_COST.update(load_upgrade_costs(gm))
        MAX_FORMS = load_max_forms(gm, {q["speciesId"] for q in pv["pokemon"]})
        del gm
        try:
            move_ja = load_move_names()
        except Exception as ex:
            print(f"::warning::技の日本語名を取得できませんでした: {ex}")
            move_ja = {}
        move_en = {m["moveId"]: m["name"] for m in pv["moves"]}
        # 技の日本語名を取れなかったときは、前回の megas.json の対応表（英語名 → 日本語名）を使う
        if not move_ja and prev_megas and prev_megas.get("moveJa"):
            prev_ja = prev_megas["moveJa"]
            move_ja = {mid: prev_ja[en] for mid, en in move_en.items() if en in prev_ja}
            print(f"技の日本語名は前回のものを使います（{len(move_ja)}件）")
        # GO 独自の技名（ウェザーボールのタイプ違いなど）は元の技名に寄せる
        for mid in move_en:
            if mid not in move_ja and "~" + mid.replace("_", "") in move_ja:
                move_ja[mid] = move_ja["~" + mid.replace("_", "")]
            if mid not in move_ja:
                for base in ("WEATHER_BALL", "HIDDEN_POWER", "TECHNO_BLAST", "AURA_WHEEL"):
                    if mid.startswith(base + "_") and base in move_ja:
                        move_ja[mid] = move_ja[base]
        # それでも無いもの（AEGISLASH_CHARGE_PSYCHO_CUT など）は、英語名が同じ技の日本語名を使う
        ja_by_en = {move_en[m]: move_ja[m] for m in move_en if m in move_ja}
        for mid in move_en:
            if mid not in move_ja and move_en[mid] in ja_by_en:
                move_ja[mid] = ja_by_en[move_en[mid]]
            # 「Psybeam+」のような強化版の技は、もとの技の日本語名に「＋」
            elif mid not in move_ja and move_en[mid].endswith("+") and move_en[mid][:-1] in ja_by_en:
                move_ja[mid] = ja_by_en[move_en[mid][:-1]] + "＋"
        pokemon = [p for p in pv["pokemon"] if p.get("released") and "teambuilderexclude" not in p.get("tags", [])
                   and not p["speciesId"].endswith(("_xs", "_xl"))]

        raid = []
        by_type = {t: [] for t in TYPES}
        for p in pokemon:
            b = best_attack(p, pve, RAID_TARGET_DEF, [])
            if b:
                raid.append(entry(p, b, move_ja, move_en))
            for t in TYPES:
                bt = best_attack(p, pve, RAID_TARGET_DEF, [], only_type=t)
                if bt:
                    by_type[t].append(entry(p, bt, move_ja, move_en))

        no_gym = {"legendary", "mythical", "ultrabeast", "mega", "shadow"}
        # 攻撃役の候補：レイド総合の上位＋各タイプの上位
        pool_ids = [x["id"] for x in sorted(raid, key=lambda x: -x["score"])[:ATTACKER_POOL]]
        for t in TYPES:
            pool_ids += [x["id"] for x in sorted(by_type[t], key=lambda x: -x["score"])[:15]]
        by_id = {p["speciesId"]: p for p in pokemon}
        attackers = [by_id[i] for i in dict.fromkeys(pool_ids) if i in by_id]
        defense = []
        for p in pokemon:
            if no_gym & set(p.get("tags", [])):
                continue
            b = best_defense(p, pve, attackers)
            if b:
                defense.append(entry(p, b, move_ja, move_en))
        defense_top = ranking(defense, KEEP["defense"])

        # ジム攻撃：防衛ランキング上位を相手にした評価の重み付き平均
        targets = [next(p for p in pokemon if p["speciesId"] == d["id"]) for d in defense_top[:GYM_TARGETS]]
        weights = [GYM_TARGETS - i for i in range(len(targets))]
        gym = []
        for p in pokemon:
            total, best_any = 0.0, None
            per = []
            for tp, w in zip(targets, weights):
                tdef = stats(tp)[1]
                b = best_attack(p, pve, tdef, tp["types"])
                if not b:
                    break
                per.append((b, w))
            if len(per) != len(targets):
                continue
            # 技はいちばん重い相手（1位）に対する組み合わせで代表させる
            rep = dict(per[0][0])
            rep["score"] = sum(b["score"] * w for b, w in per) / sum(weights)
            gym.append(entry(p, rep, move_ja, move_en))

        type_ja = {"normal": "ノーマル", "fire": "ほのお", "water": "みず", "electric": "でんき", "grass": "くさ", "ice": "こおり",
                   "fighting": "かくとう", "poison": "どく", "ground": "じめん", "flying": "ひこう", "psychic": "エスパー", "bug": "むし",
                   "rock": "いわ", "ghost": "ゴースト", "dragon": "ドラゴン", "dark": "あく", "steel": "はがね", "fairy": "フェアリー"}
        raid_top = ranking(raid, KEEP["raid"])
        type_top = {t: ranking(v, KEEP["type"]) for t, v in by_type.items()}
        gym_top = ranking(gym, KEEP["gym"])
        all_by_id = {p["speciesId"]: p for p in pokemon}
        buddy = buddy_ranking([("レイド総合", raid_top, LIST_WEIGHT_MAIN), ("ジム攻撃", gym_top, LIST_WEIGHT_MAIN),
                               ("ジム防衛", defense_top, LIST_WEIGHT_MAIN)]
                              + [(f"レイド・{type_ja[t]}", type_top[t], LIST_WEIGHT_TYPE) for t in TYPES], all_by_id, MEGA, UPGRADE)
        data = {
            "schema": SCHEMA,
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "source": {"pvpoke": pv.get("timestamp"), "note": "PvPoke gamemaster + PokeMiners GAME_MASTER + PokeAPI"},
            "raid": raid_top,
            "raidByType": type_top,
            "gymAttack": gym_top,
            "buddy": buddy,
            "gymAttackTargets": [d["id"] for d in defense_top[:GYM_TARGETS]],
            "gymDefense": defense_top,
        }
        megas_data = build_megas(pokemon, MEGA, MEGA_LEVELS, TYPE_BOOSTS, CATCH_DUST)
        lists_all = [("レイド総合", raid_top, LIST_WEIGHT_MAIN), ("ジム攻撃", gym_top, LIST_WEIGHT_MAIN), ("ジム防衛", defense_top, LIST_WEIGHT_MAIN)] \
            + [(f"レイド・{type_ja[t]}", type_top[t], LIST_WEIGHT_TYPE) for t in TYPES]
        PVP = load_pvp_ranks()
        megas_data["evoUse"] = build_evo_use(pokemon, lists_all, PVP)
        # PvPoke はバトルに出られないポケモンを「未実装」としているので、ポケモンGOに実装済みのものは足す
        extra = [q for q in pv["pokemon"] if q["speciesId"] in NON_BATTLE_RELEASED]
        # ダイマックス・キョダイマックス：ゲームデータ＋前回までに見つけた分＋イベント名＋LeekDuck のマックスバトルのページ
        ids = {q["speciesId"] for q in pokemon}
        dmax, gmax = MAX_FORMS
        name2id = {}
        for q in pokemon:
            if "_shadow" in q["speciesId"] or "_mega" in q["speciesId"]:
                continue
            name2id.setdefault(q["speciesName"], q["speciesId"])
        try:
            prev_pd_path = os.path.join(os.path.dirname(prev_megas_path or "") or ".", "prev_pokedex.json")
            with open(prev_pd_path, encoding="utf-8") as f:
                for x in json.load(f).get("species", []):
                    if x.get("id") in ids:
                        if x.get("dmax"):
                            dmax.add(x["id"])
                        if x.get("gmax"):
                            gmax.add(x["id"])
        except Exception as ex:
            print(f"前回の pokedex.json は使えませんでした: {ex}")
        # イベント名（ScrapedDuck）と、同じワークフローで先に集めた LeekDuck のイベントページの本文（out/bonuses.json）
        texts = []
        try:
            texts.append(" | ".join(e.get("name", "") for e in json.loads(get(EVENTS_URL))))
        except Exception as ex:
            print(f"::warning::ダイマックス情報（イベント名）: {ex}")
        try:
            with open(os.path.join(os.path.dirname(out_path) or ".", "bonuses.json"), encoding="utf-8") as f:
                bon = json.load(f)
            for ev in (bon.get("events") or {}).values():
                texts += [b.get("text", "") for b in ev.get("bonuses") or []] + list(ev.get("notes") or [])
                for g in ev.get("spawns") or []:
                    texts += list(g.get("context") or []) + [p.get("name", "") for p in g.get("pokemon") or []]
        except Exception as ex:
            print(f"ダイマックス情報（イベントページ）は使えませんでした: {ex}")
        d2, g2 = max_names_from_text(" | ".join(texts), name2id)
        dmax |= d2; gmax |= g2
        # ダイマックスの個体は、進化してもダイマックスできる（進化先にも付ける）
        by_sid = {q["speciesId"]: q for q in pokemon}
        todo = list(dmax)
        while todo:
            q = by_sid.get(todo.pop())
            for e in ((q or {}).get("family") or {}).get("evolutions") or []:
                if e in by_sid and e not in dmax:
                    dmax.add(e); todo.append(e)
        print("dynamax:", len(dmax), "gigantamax:", len(gmax))
        try:
            gbl_data = build_gbl(pv, move_ja, move_en, json.loads(get(EVENTS_URL)))
            print("gbl:", [(e["name"][:50], [l["key"] for l in e["leagues"]]) for e in gbl_data["events"]])
        except Exception as ex:
            print(f"::warning::GBL: {ex}")
        pokedex_data = build_pokedex(pokemon + extra, PVP, move_ja, move_en, dmax, gmax)
        add_future_evos(pokedex_data["species"], os.path.join(os.path.dirname(prev_megas_path or "") or ".", "prev_pokedex.json"))
        # 技名（英語 → 日本語）。イベントページの「レガシー技」の説明を訳すのに使う
        megas_data["moveJa"] = {move_en[mid]: move_ja[mid] for mid in move_en if mid in move_ja and move_ja[mid]}
        if out_raids_path:
            try:
                lists = [("レイド総合", raid_top, LIST_WEIGHT_MAIN), ("ジム攻撃", gym_top, LIST_WEIGHT_MAIN), ("ジム防衛", defense_top, LIST_WEIGHT_MAIN)] \
                    + [(f"レイド・{type_ja[t]}", type_top[t], LIST_WEIGHT_TYPE) for t in TYPES]
                raids_data = build_raids(pokemon, pve, move_ja, move_en, lists, MEGA)
                try:
                    raids_data["rocket"] = build_rocket(pokemon, lists)
                    print("rocket:", [(t["name"], t["score"]) for t in raids_data["rocket"][:10]])
                except Exception as ex:
                    print(f"::warning::rocket: {ex}")
                print("raids:", [(b["name"], b["rating"]["stars"], [c["id"] for c in b["counters"][:3]]) for b in raids_data["bosses"]])
            except Exception as ex:
                print(f"::warning::raids: {ex}")
        print("megas:", len(megas_data["megas"]), "types:", len(megas_data["types"]), "levels:", megas_data["levels"])
        print("raid:", [x["id"] for x in data["raid"][:15]])
        print("gymAttack:", [x["id"] for x in data["gymAttack"][:15]])
        print("gymDefense:", [(x["id"], x["seconds"]) for x in data["gymDefense"][:15]])
    except Exception as ex:
        print(f"::warning::rankings: {ex}")
        if not prev:
            sys.exit("前回のデータも無いため終了します")
        data = prev
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    if out_megas_path and megas_data:
        with open(out_megas_path, "w", encoding="utf-8") as f:
            json.dump(megas_data, f, ensure_ascii=False)
        if gbl_data:   # GOバトルリーグのページ用
            with open(os.path.join(os.path.dirname(out_megas_path) or ".", "gbl.json"), "w", encoding="utf-8") as f:
                json.dump(gbl_data, f, ensure_ascii=False, separators=(",", ":"))
        if pokedex_data:   # ポケモン検索ページ用（megas.json と同じ場所に置く）
            with open(os.path.join(os.path.dirname(out_megas_path) or ".", "pokedex.json"), "w", encoding="utf-8") as f:
                json.dump(pokedex_data, f, ensure_ascii=False, separators=(",", ":"))
    if out_raids_path and raids_data and raids_data.get("bosses") is not None:
        with open(out_raids_path, "w", encoding="utf-8") as f:
            json.dump(raids_data, f, ensure_ascii=False)


if __name__ == "__main__":
    main(*sys.argv[1:7])
