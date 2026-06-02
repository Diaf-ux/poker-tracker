#!/usr/bin/env python3
"""
anonymize_backup.py  <input.sql>  --out <output.sql>

Replaces all player names in INSERT statements for game_players and payments
tables, and all game names in the games table, with pseudonyms. Aliases are:
  - consistent within a single run (same real value -> same alias)
  - different across runs (random salt baked in at startup)
"""

import argparse
import hashlib
import os
import re

ADJECTIVES = [
    "Ace", "Bold", "Calm", "Dark", "East", "Fast", "Gold", "High",
    "Iron", "Just", "Keen", "Lime", "Mint", "Noir", "Oval", "Pale",
    "Quad", "Rich", "Safe", "Tall", "Ursa", "Veil", "Wild", "Xeno",
    "Yale", "Zinc", "Blue", "Cool", "Deep", "Even", "Firm", "Gray",
    "Hard", "Icy", "Jade", "Kind", "Lazy", "Mega", "Nice", "Open",
    "Pink", "Quiet", "Rare", "Soft", "True", "Ugly", "Vast", "Warm",
    "Amber", "Brave", "Crisp", "Drift", "Ember", "Frost", "Gloom", "Haze",
    "Indigo", "Jewel", "Knack", "Lush", "Mist", "Noble", "Onyx", "Plum",
    "Quest", "Rogue", "Slate", "Thorn", "Ultra", "Vivid", "Wavy", "Xenon",
    "Young", "Zeal", "Ashen", "Blaze", "Crest", "Dusk", "Ebon", "Flint",
    "Gale", "Halo", "Iris", "Jolly", "Kraft", "Lunar", "Murk", "Neon",
    "Opal", "Plush", "Raven", "Storm", "Tawny", "Umbra", "Velvet", "Wisp",
]

NOUNS = [
    "Ace", "Bet", "Card", "Deal", "Edge", "Flop", "Grit", "Hand",
    "Imp", "Jack", "King", "Luck", "Muck", "Nuts", "Odds", "Pair",
    "Quad", "Raja", "Suit", "Tilt", "Unit", "Vein", "Wand", "Xtra",
    "Yard", "Zero", "Bluff", "Call", "Draw", "Five", "Hole", "Joker",
    "Kite", "Limp", "Meld", "Nine", "Over", "Pot", "Rake", "Shove",
    "Turn", "Urge", "Vale", "Wile", "Xray", "York", "Zone", "Ante",
    "Arch", "Buck", "Chip", "Dice", "Echo", "Fold", "Gem", "Heap",
    "Icon", "Jest", "Knot", "Lore", "Mark", "Node", "Orb", "Pawn",
    "Quirk", "Rift", "Shard", "Trap", "Urn", "Volt", "Wave", "Xenon",
    "Yarn", "Zest", "Bolt", "Cue", "Dash", "Flux", "Hash", "Ivory",
    "Jinx", "Key", "Loop", "Myth", "Null", "Oval", "Pike", "Quip",
    "Root", "Skip", "Tide", "Unix", "Vibe", "Wisp", "Xor", "Yoke",
]

# One random salt per process lifetime — makes every run produce different aliases
# while keeping them stable within the run.
_RUN_SALT = os.urandom(16).hex()


def _salted_hash(name: str) -> int:
    """SHA-256 of (salt + name), returned as a big integer."""
    payload = f"{_RUN_SALT}:{name}".encode()
    return int(hashlib.sha256(payload).hexdigest(), 16)


def _candidate_alias(name: str, attempt: int = 0) -> str:
    """
    Derive a player alias from name.  attempt > 0 is used only when the first
    candidate collides with an already-assigned alias.
    """
    h = _salted_hash(f"{name}\x00{attempt}")
    adj = ADJECTIVES[h % len(ADJECTIVES)]
    noun = NOUNS[(h // len(ADJECTIVES)) % len(NOUNS)]
    return f"{adj}{noun}"


def _candidate_game_alias(name: str, attempt: int = 0) -> str:
    """
    Derive a game alias — "Game <Adjective><Noun>" — visually distinct
    from player aliases so the two namespaces don't get confused.
    """
    h = _salted_hash(f"game\x00{name}\x00{attempt}")
    adj = ADJECTIVES[h % len(ADJECTIVES)]
    noun = NOUNS[(h // len(ADJECTIVES)) % len(NOUNS)]
    return f"Game {adj}{noun}"


# ---------------------------------------------------------------------------
# SQL parsing helpers
# ---------------------------------------------------------------------------

def _parse_values(values_str: str) -> list:
    tokens = []
    current = []
    in_quote = False
    i = 0
    while i < len(values_str):
        c = values_str[i]
        if c == "'" and not in_quote:
            in_quote = True
            current.append(c)
        elif c == "'" and in_quote:
            if i + 1 < len(values_str) and values_str[i + 1] == "'":
                current.append("''")
                i += 2
                continue
            in_quote = False
            current.append(c)
        elif c == "," and not in_quote:
            tokens.append("".join(current).strip())
            current = []
        else:
            current.append(c)
        i += 1
    if current:
        tokens.append("".join(current).strip())
    return tokens


def _unquote(s: str) -> str:
    s = s.strip()
    if s.startswith("'") and s.endswith("'"):
        s = s[1:-1].replace("''", "'")
    return s


def _quote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


# ---------------------------------------------------------------------------
# Alias map construction
# ---------------------------------------------------------------------------

def _build_map(raw_names: set[str], candidate_fn) -> dict[str, str]:
    """Generic alias-map builder; candidate_fn(name, attempt) -> alias string."""
    alias_map: dict[str, str] = {}
    used_aliases: set[str] = set()
    for name in sorted(raw_names):   # sorted = deterministic collision-resolution order
        attempt = 0
        alias = candidate_fn(name, attempt)
        while alias in used_aliases:
            attempt += 1
            alias = candidate_fn(name, attempt)
        alias_map[name] = alias
        used_aliases.add(alias)
    return alias_map


def build_name_map(sql: str) -> dict[str, str]:
    names: set[str] = set()

    for _, _, _, values_str, col_names in _find_values_blocks(sql, "game_players"):
        vals = _parse_values(values_str)
        idx = col_names.index("name") if "name" in col_names else None
        if idx is not None and idx < len(vals):
            names.add(_unquote(vals[idx]))

    for _, _, _, values_str, col_names in _find_values_blocks(sql, "payments"):
        vals = _parse_values(values_str)
        for col in ("from_name", "to_name"):
            idx = col_names.index(col) if col in col_names else None
            if idx is not None and idx < len(vals):
                names.add(_unquote(vals[idx]))

    return _build_map(names, _candidate_alias)


def build_game_map(sql: str) -> dict[str, str]:
    names: set[str] = set()

    for _, _, _, values_str, col_names in _find_values_blocks(sql, "games"):
        vals = _parse_values(values_str)
        idx = col_names.index("name") if "name" in col_names else None
        if idx is not None and idx < len(vals):
            names.add(_unquote(vals[idx]))

    return _build_map(names, _candidate_game_alias)

# ---------------------------------------------------------------------------
# SQL rewriting
# ---------------------------------------------------------------------------

def _find_values_blocks(sql: str, table: str):
    """
    Yield (start, end, values_str) for every
        INSERT INTO "<table>" (...) VALUES (...)
    using a paren-depth counter so names with ')' inside are handled correctly.
    start/end are the positions of the outer '(' and the matching ')'.
    """
    prefix_re = re.compile(
    r'INSERT INTO "' + re.escape(table) + r'" \(([^)]+)\)(?:\s+OVERRIDING\s+\S+\s+VALUE)?\s+VALUES \('
)
    for m in prefix_re.finditer(sql):
        col_names = [c.strip().strip('"') for c in m.group(1).split(",")]
        open_pos = m.end() - 1          # position of the opening '('
        depth = 0
        in_quote = False
        i = open_pos
        while i < len(sql):
            c = sql[i]
            if c == "'" and not in_quote:
                in_quote = True
            elif c == "'" and in_quote:
                if i + 1 < len(sql) and sql[i + 1] == "'":
                    i += 2              # escaped quote — skip both chars
                    continue
                in_quote = False
            elif not in_quote:
                if c == "(":
                    depth += 1
                elif c == ")":
                    depth -= 1
                    if depth == 0:
                        close_pos = i
                        values_str = sql[open_pos + 1 : close_pos]
                        yield m.group(0)[: -1], open_pos, close_pos, values_str, col_names
                        break
            i += 1


def _rewrite_table(sql: str, table: str, replacer) -> str:
    blocks = list(_find_values_blocks(sql, table))
    parts = list(sql)
    for prefix, open_pos, close_pos, values_str, col_names in reversed(blocks):
        new_vals = replacer(prefix, values_str, col_names)
        parts[open_pos : close_pos + 1] = list(f"({new_vals})")
    return "".join(parts)


def replace_names_in_sql(sql: str, name_map: dict, game_map: dict) -> str:
    def replace_game_players(prefix, values_str, col_names):
        vals = _parse_values(values_str)
        idx = col_names.index("name") if "name" in col_names else None
        if idx is not None and idx < len(vals):
            original = _unquote(vals[idx])
            vals[idx] = _quote(name_map.get(original, original))
        return ', '.join(vals)

    def replace_payments(prefix, values_str, col_names):
        vals = _parse_values(values_str)
        for col in ("from_name", "to_name"):
            idx = col_names.index(col) if col in col_names else None
            if idx is not None and idx < len(vals):
                original = _unquote(vals[idx])
                vals[idx] = _quote(name_map.get(original, original))
        return ', '.join(vals)

    def replace_games(prefix, values_str, col_names):
        vals = _parse_values(values_str)
        idx = col_names.index("name") if "name" in col_names else None
        if idx is not None and idx < len(vals):
            original = _unquote(vals[idx])
            vals[idx] = _quote(game_map.get(original, original))
        return ', '.join(vals)

    sql = _rewrite_table(sql, "game_players", replace_game_players)
    sql = _rewrite_table(sql, "payments",     replace_payments)
    sql = _rewrite_table(sql, "games",        replace_games)
    return sql


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Anonymize player names in a Supabase backup SQL file."
    )
    parser.add_argument("input", help="Path to input SQL backup file")
    parser.add_argument("--out", required=True, help="Path to output anonymized SQL file")
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as f:
        sql = f.read()

    name_map = build_name_map(sql)
    game_map = build_game_map(sql)

    print(f"Run salt: {_RUN_SALT}")
    print(f"Found {len(name_map)} unique player names to anonymize:")
    for original, alias in sorted(name_map.items()):
        print(f"  {original!r:30s} -> {alias!r}")
    print(f"Found {len(game_map)} unique game names to anonymize:")
    for original, alias in sorted(game_map.items()):
        print(f"  {original!r:40s} -> {alias!r}")

    anonymized = replace_names_in_sql(sql, name_map, game_map)

    with open(args.out, "w", encoding="utf-8") as f:
        f.write(anonymized)

    print(f"\nDone. Anonymized file written to: {args.out}")


if __name__ == "__main__":
    main()
