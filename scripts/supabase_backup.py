#!/usr/bin/env python3
"""
supabase_backup.py

Full backup of a Supabase project via REST API only.
No pg_dump, no direct DB connection -- only URL + service_role key.

Requires the helper function installed once in Supabase Dashboard -> SQL Editor:

  CREATE OR REPLACE FUNCTION public.supabase_backup_schema_info(target_tables text[] DEFAULT NULL)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
    DECLARE
    result jsonb;
    BEGIN
    SELECT jsonb_build_object(
        'columns', (
        SELECT jsonb_agg(row_to_json(c)) FROM (
            SELECT table_name, column_name, ordinal_position, column_default,
                is_nullable, data_type, udt_name,
                character_maximum_length, numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema = 'public'
            AND (target_tables IS NULL OR table_name = ANY(target_tables))
            ORDER BY table_name, ordinal_position
        ) c
        ),
        'constraints', (
        SELECT jsonb_agg(row_to_json(c)) FROM (
            SELECT constraint_name, table_name, constraint_type
            FROM information_schema.table_constraints
            WHERE table_schema = 'public'
            AND (target_tables IS NULL OR table_name = ANY(target_tables))
        ) c
        ),
        'key_columns', (
        SELECT jsonb_agg(row_to_json(k)) FROM (
            SELECT constraint_name, table_name, column_name, ordinal_position
            FROM information_schema.key_column_usage
            WHERE table_schema = 'public'
            AND (target_tables IS NULL OR table_name = ANY(target_tables))
            ORDER BY constraint_name, ordinal_position
        ) k
        ),
        'referential', (
        SELECT jsonb_agg(row_to_json(r)) FROM (
            SELECT constraint_name, unique_constraint_name, delete_rule, update_rule
            FROM information_schema.referential_constraints
            WHERE constraint_schema = 'public'
        ) r
        ),
        'indexes', (
        SELECT jsonb_agg(row_to_json(i)) FROM (
            SELECT indexname, tablename, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND (target_tables IS NULL OR tablename = ANY(target_tables))
            AND indexname NOT LIKE '%_pkey'
            AND indexname NOT LIKE '%_key'
        ) i
        ),
        'identity_columns', (SELECT jsonb_agg(row_to_json(ic)) FROM (
        SELECT
            c.relname  AS table_name,
            a.attname  AS column_name,
            a.attidentity AS identity_type   -- 'a' = ALWAYS, 'd' = BY DEFAULT
        FROM pg_catalog.pg_attribute a
        JOIN pg_catalog.pg_class     c ON c.oid = a.attrelid
        JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname   = 'public'
            AND a.attidentity IN ('a', 'd')
            AND (target_tables IS NULL OR c.relname = ANY(target_tables))
        ) ic
        )
    ) INTO result;
    RETURN result;
    END; $$;

Usage:
    python supabase_backup.py \
        --url  https://xxxx.supabase.co \
        --key  your-service-role-key \
        --out  backup.sql

Optional:
    --tables      users,games,hands   comma-separated; empty = all public tables
    --chunk       500                 rows per REST request (default 500)
    --data-only                       skip schema, dump data only
    --schema-only                     skip data, dump schema only
"""

import argparse
import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from collections import defaultdict, deque

HELPER_FN = "supabase_backup_schema_info"


def _request(url, headers, data=None, method=None):
    if data is not None:
        data = json.dumps(data).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def http_get(url, headers):
    status, body = _request(url, headers)
    if status not in (200, 206):
        raise RuntimeError(f"HTTP {status} GET {url}: {body.decode()[:300]}")
    return json.loads(body)


def http_post(url, headers, payload):
    h = {**headers, "Content-Type": "application/json"}
    status, body = _request(url, h, data=payload, method="POST")
    return status, body


def fetch_schema_via_rpc(base, headers, tables):
    url = f"{base}/rest/v1/rpc/{HELPER_FN}"
    status, body = http_post(url, headers, {"target_tables": tables})
    if status not in (200, 201):
        raise RuntimeError(
            f"RPC call to {HELPER_FN} failed (HTTP {status}): {body.decode()[:300]}\n"
            f"Make sure you have created the helper function in Supabase SQL Editor."
        )
    result = json.loads(body)
    if isinstance(result, str):
        result = json.loads(result)
    return result


def discover_tables(base, headers):
    spec   = http_get(f"{base}/rest/v1/", headers)
    tables = sorted(spec.get("definitions", {}).keys())
    if not tables:
        print("WARN: OpenAPI spec has no definitions. Check your service_role key.", file=sys.stderr)
    return spec, tables

def col_type_sql(row):
    dt  = row["data_type"]
    udt = row.get("udt_name", "")
    if dt == "character varying":
        ml = row.get("character_maximum_length")
        return f"varchar({ml})" if ml else "text"
    if dt == "character":
        ml = row.get("character_maximum_length")
        return f"char({ml})" if ml else "char"
    if dt == "numeric":
        p = row.get("numeric_precision")
        s = row.get("numeric_scale")
        return f"numeric({p},{s})" if (p and s) else "numeric"
    if dt == "USER-DEFINED":
        return f'"{udt}"'
    if dt == "ARRAY":
        return f"{udt.lstrip('_')}[]"
    return dt


def topological_sort(tables, fk_edges):
    """
    Return tables ordered so that referenced (parent) tables come before
    referencing (child) tables. Uses Kahn's algorithm.
    Falls back to the original order if a cycle is detected.

    fk_edges: list of (child_table, parent_table) pairs.
    """
    table_set  = set(tables)
    dependents = defaultdict(set)   # parent -> set of children
    dep_count  = {t: 0 for t in tables}

    for child, parent in fk_edges:
        if child in table_set and parent in table_set and child != parent:
            if child not in dependents[parent]:
                dependents[parent].add(child)
                dep_count[child] += 1

    queue  = deque(sorted(t for t in tables if dep_count[t] == 0))
    result = []
    while queue:
        t = queue.popleft()
        result.append(t)
        for child in sorted(dependents[t]):
            dep_count[child] -= 1
            if dep_count[child] == 0:
                queue.append(child)

    if len(result) != len(tables):
        print("WARN: Circular FK dependencies detected; using original table order.", file=sys.stderr)
        return list(tables)
    return result


def _build_ctype_and_kcu(constraints, key_columns):
    """
    Returns:
      ctype_map:  constraint_name -> (constraint_type, table_name)   (deduplicated)
      kcu_map:    constraint_name -> ordered list of column names
    """
    kcu_map = defaultdict(list)
    for row in sorted(key_columns, key=lambda r: r["ordinal_position"]):
        kcu_map[row["constraint_name"]].append(row["column_name"])

    ctype_map = {}
    for row in constraints:
        cname = row["constraint_name"]
        if cname not in ctype_map:
            ctype_map[cname] = (row["constraint_type"], row["table_name"])

    return ctype_map, kcu_map


def build_schema(schema_info, tables):
    """
    Emit SQL in restore-safe order:
      1. CREATE TABLE  (columns only, no inline constraints)
      2. PRIMARY KEY + UNIQUE  ALTER TABLE statements
      3. FOREIGN KEY           ALTER TABLE statements
      4. CREATE INDEX          statements

    Every constraint name is tracked so it is emitted exactly once,
    preventing the "multiple primary keys" / duplicate FK errors.
    """
    columns     = schema_info.get("columns")     or []
    constraints = schema_info.get("constraints") or []
    key_columns = schema_info.get("key_columns") or []
    referential = schema_info.get("referential") or []
    indexes     = schema_info.get("indexes")     or []
    identity_raw = schema_info.get("identity_columns") or []


    identity_map = {
        (r["table_name"], r["column_name"]): r["identity_type"]
        for r in identity_raw
    }

    table_cols = defaultdict(list)
    for row in columns:
        table_cols[row["table_name"]].append(row)

    ctype_map, kcu_map = _build_ctype_and_kcu(constraints, key_columns)

    fk_ref_map = {}
    for row in referential:
        fk_ref_map[row["constraint_name"]] = row

    lines = []
    emitted_constraints = set()

    # ------------------------------------------------------------------ #
    # 1. CREATE TABLE (columns only – no inline PRIMARY KEY / UNIQUE)
    # ------------------------------------------------------------------ #
    for table in tables:
        cols = sorted(table_cols.get(table, []), key=lambda r: r["ordinal_position"])
        if not cols:
            lines.append(f'-- WARNING: no column info found for "{table}"')
            continue
        col_lines = []
        for col in cols:
            cname      = col["column_name"]
            ctype      = col_type_sql(col)
            id_type    = identity_map.get((table, cname))
            if id_type == 'a':
                col_lines.append(f'    "{cname}" {ctype} GENERATED ALWAYS AS IDENTITY')
            elif id_type == 'd':
                col_lines.append(f'    "{cname}" {ctype} GENERATED BY DEFAULT AS IDENTITY')
            else:
                notnull = " NOT NULL" if col["is_nullable"] == "NO" else ""
                default = f" DEFAULT {col['column_default']}" if col.get("column_default") else ""
                col_lines.append(f'    "{cname}" {ctype}{notnull}{default}')
        lines.append(f'CREATE TABLE IF NOT EXISTS "{table}" (')
        lines.append(",\n".join(col_lines))
        lines.append(");")
        lines.append("")

    # ------------------------------------------------------------------ #
    # 2. PRIMARY KEY and UNIQUE constraints
    # ------------------------------------------------------------------ #
    for cname, (ctype, tname) in ctype_map.items():
        if tname not in tables:
            continue
        if cname in emitted_constraints:
            continue
        cols_involved = kcu_map.get(cname, [])
        if not cols_involved:
            continue
        col_list = ", ".join(f'"{c}"' for c in cols_involved)
        if ctype == "PRIMARY KEY":
            lines.append(
                f'ALTER TABLE "{tname}" ADD CONSTRAINT "{cname}" PRIMARY KEY ({col_list});')
            emitted_constraints.add(cname)
        elif ctype == "UNIQUE":
            lines.append(
                f'ALTER TABLE "{tname}" ADD CONSTRAINT "{cname}" UNIQUE ({col_list});')
            emitted_constraints.add(cname)

    lines.append("")

    # ------------------------------------------------------------------ #
    # 3. FOREIGN KEY constraints  (after all PKs / UNIQUEs are in place)
    # ------------------------------------------------------------------ #
    for cname, (ctype, tname) in ctype_map.items():
        if tname not in tables:
            continue
        if cname in emitted_constraints:
            continue
        if ctype != "FOREIGN KEY":
            continue
        cols_involved = kcu_map.get(cname, [])
        if not cols_involved:
            continue
        col_list  = ", ".join(f'"{c}"' for c in cols_involved)
        ref       = fk_ref_map.get(cname, {})
        ref_cname = ref.get("unique_constraint_name", "")
        del_rule  = ref.get("delete_rule", "NO ACTION")
        upd_rule  = ref.get("update_rule", "NO ACTION")
        ref_cols  = kcu_map.get(ref_cname, [])
        ref_table = ctype_map.get(ref_cname, (None, None))[1]
        if ref_table and ref_cols:
            ref_col_list = ", ".join(f'"{c}"' for c in ref_cols)
            lines.append(
                f'ALTER TABLE "{tname}" ADD CONSTRAINT "{cname}" '
                f'FOREIGN KEY ({col_list}) REFERENCES "{ref_table}" ({ref_col_list}) '
                f'ON DELETE {del_rule} ON UPDATE {upd_rule};')
            emitted_constraints.add(cname)

    # ------------------------------------------------------------------ #
    # 4. Indexes
    # ------------------------------------------------------------------ #
    seen_indexes = set()
    for idx in indexes:
        key = idx["indexname"]
        if key not in seen_indexes:
            lines.append(f"{idx['indexdef']};")
            seen_indexes.add(key)
    if indexes:
        lines.append("")

    return lines


def build_schema_from_openapi(spec, tables):
    lines = [
        "-- NOTE: approximate types from OpenAPI spec.",
        "-- Install the helper function for exact types (see script docstring).", ""
    ]
    defs        = spec.get("definitions", {})
    pg_type_map = {"integer": "integer", "number": "numeric", "string": "text",
                   "boolean": "boolean", "object": "jsonb", "array": "jsonb"}
    fmt_map     = {"bigint": "bigint", "integer": "integer", "uuid": "uuid",
                   "timestamp with time zone": "timestamptz", "date": "date",
                   "json": "jsonb", "jsonb": "jsonb", "numeric": "numeric"}
    for table in tables:
        props = defs.get(table, {}).get("properties", {})
        if not props:
            continue
        col_defs = []
        for col, info in props.items():
            pg_type = fmt_map.get(info.get("format", ""),
                                  pg_type_map.get(info.get("type", "string"), "text"))
            col_defs.append(f'    "{col}" {pg_type}')
        lines.append(f'CREATE TABLE IF NOT EXISTS "{table}" (')
        lines.append(",\n".join(col_defs))
        lines.append(");")
        lines.append("")
    return lines


def fetch_all_rows(base, table, headers, chunk):
    rows, offset = [], 0
    while True:
        url = (f"{base}/rest/v1/{urllib.parse.quote(table)}"
               f"?select=*&limit={chunk}&offset={offset}")
        h = {**headers, "Prefer": "count=exact"}
        status, body = _request(url, h)
        if status not in (200, 206):
            print(f"  WARN: HTTP {status} on {table} at offset {offset}", file=sys.stderr)
            break
        batch = json.loads(body)
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < chunk:
            break
        offset += chunk
    return rows


def sql_literal(v):
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v).replace("'", "''") + "'"
    return "'" + str(v).replace("'", "''") + "'"


def rows_to_sql(table, rows, identity_cols=None):
    if not rows:
        return [f"-- (no rows in {table})"]
    identity_cols = identity_cols or set()
    all_cols = list(rows[0].keys())
    cols = ", ".join(f'"{c}"' for c in all_cols)
    override = " OVERRIDING SYSTEM VALUE" if any(c in identity_cols for c in all_cols) else ""
    statements = [
        f'INSERT INTO "{table}" ({cols}){override} VALUES '
        f'({", ".join(sql_literal(v) for v in row.values())}) ON CONFLICT DO NOTHING;'
        for row in rows
    ]
    # Reset identity sequences so next app insert continues from correct value
    for col in identity_cols:
        if col in all_cols:
            statements.append(
                f"SELECT setval(pg_get_serial_sequence('\"{table}\"', '{col}'), "
                f"COALESCE((SELECT MAX(\"{col}\") FROM \"{table}\"), 0) + 1, false);"
            )
    return statements


def main():
    p = argparse.ArgumentParser(
        description="Full Supabase backup via REST API (no pg_dump)")
    p.add_argument("--url",         required=True)
    p.add_argument("--key",         required=True)
    p.add_argument("--out",         default="backup.sql")
    p.add_argument("--tables",      default="")
    p.add_argument("--chunk",       type=int, default=500)
    p.add_argument("--data-only",   action="store_true")
    p.add_argument("--schema-only", action="store_true")
    args = p.parse_args()

    base    = args.url.rstrip("/")
    headers = {
        "apikey":        args.key,
        "Authorization": f"Bearer {args.key}",
        "Content-Type":  "application/json",
    }

    print("Fetching OpenAPI spec...")
    spec, all_tables = discover_tables(base, headers)
    tables = ([t.strip() for t in args.tables.split(",") if t.strip()]
              if args.tables else all_tables)

    if not tables:
        print("No tables found.", file=sys.stderr)
        sys.exit(1)

    # ------------------------------------------------------------------ #
    # Fetch schema early so we can topologically sort tables by FK deps.
    # Parent tables must be created and populated before child tables.
    # ------------------------------------------------------------------ #
    schema_info = None
    print("\nFetching schema via RPC helper...")
    try:
        schema_info = fetch_schema_via_rpc(base, headers, tables)
        col_count   = len(schema_info.get("columns") or [])
        idx_count   = len(schema_info.get("indexes") or [])
        print(f"  Exact schema: {col_count} columns, {idx_count} indexes.")
    except RuntimeError as e:
        print(f"  WARN: {e}", file=sys.stderr)
        print("  Falling back to OpenAPI-derived schema (approximate).", file=sys.stderr)

    # Build FK edges for topological sort
    fk_edges = []
    if schema_info:
        referential = schema_info.get("referential") or []
        constraints = schema_info.get("constraints") or []
        key_columns = schema_info.get("key_columns") or []
        ctype_map, _ = _build_ctype_and_kcu(constraints, key_columns)
        fk_ref_map   = {r["constraint_name"]: r for r in referential}
        for cname, (ctype, tname) in ctype_map.items():
            if ctype == "FOREIGN KEY":
                ref       = fk_ref_map.get(cname, {})
                ref_cname = ref.get("unique_constraint_name", "")
                parent    = ctype_map.get(ref_cname, (None, None))[1]
                if tname and parent:
                    fk_edges.append((tname, parent))

    tables = topological_sort(tables, fk_edges)
    print(f"Tables ({len(tables)}, topological order): {tables}")

    lines = [
        "-- ============================================================",
        "-- Supabase REST API backup (schema + data)",
        f"-- Project : {base}",
        f"-- Created : {datetime.now(timezone.utc).isoformat()}",
        f"-- Tables  : {', '.join(tables)}",
        '-- Restore : psql "$DATABASE_URL" -f backup.sql',
        "--         or paste into Supabase Dashboard -> SQL Editor",
        "-- ============================================================", "",
    ]

    if not args.data_only:
        lines += ["-- SCHEMA", ""]
        if schema_info:
            lines += ["-- (exact, from information_schema + pg_catalog)", ""]
            lines += build_schema(schema_info, tables)
        else:
            lines += ["-- (approximate, from OpenAPI spec)", ""]
            lines += build_schema_from_openapi(spec, tables)

    if not args.schema_only:
        lines += [
            "-- ============================================================",
            "-- DATA",
            "-- ============================================================", "",
            "BEGIN;", "",
        ]

        identity_raw = (schema_info.get("identity_columns") or []) if schema_info else []
        identity_cols_by_table = defaultdict(set)
        for r in identity_raw:
            identity_cols_by_table[r["table_name"]].add(r["column_name"])

        total = 0
        for table in tables:
            print(f"  -> {table} ...", end=" ", flush=True)
            rows = fetch_all_rows(base, table, headers, args.chunk)
            print(f"{len(rows)} rows")
            total += len(rows)
            lines.append(f"-- {table}  ({len(rows)} rows)")
            lines += rows_to_sql(table, rows, identity_cols=identity_cols_by_table.get(table))
            lines.append("")
        lines += ["COMMIT;", "", f"-- Total rows: {total}"]

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"\nDone -> {args.out}")
    print(f'Restore: psql "$DATABASE_URL" -f {args.out}')


if __name__ == "__main__":
    main()
