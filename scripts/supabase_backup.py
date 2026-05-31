#!/usr/bin/env python3
"""
supabase_backup.py

Full backup of a Supabase project via REST API only.
No pg_dump, no direct DB connection -- only URL + service_role key.

Produces a single SQL file containing:
  1. CREATE TABLE (with column types, nullability, defaults)
  2. ALTER TABLE  (primary keys, foreign keys, unique constraints)
  3. INSERT INTO  (all row data, paginated)

Usage:
    python supabase_backup.py \
        --url  https://xxxx.supabase.co \
        --key  your-service-role-key \
        --out  backup.sql

Optional:
    --tables users,games,hands   comma-separated; empty = all public tables
    --chunk  500                 rows per REST request (default 500)
    --data-only                  skip schema, dump data only
    --schema-only                skip data, dump schema only
"""

import argparse
import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone
from collections import defaultdict


def _get(url, headers):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def http_get_json(url, headers):
    status, body = _get(url, headers)
    if status not in (200, 206):
        raise RuntimeError(f"HTTP {status} GET {url}: {body.decode()[:300]}")
    return json.loads(body)


# ── Table discovery ────────────────────────────────────────────────────────

def discover_tables(base_url, headers):
    spec = http_get_json(f"{base_url}/rest/v1/", headers)
    tables = sorted(spec.get("definitions", {}).keys())
    if not tables:
        print("WARN: OpenAPI spec has no definitions. Check your service_role key.", file=sys.stderr)
    return spec, tables


# ── Schema: information_schema approach ───────────────────────────────────

def fetch_columns(base_url, headers, tables):
    url = (
        f"{base_url}/rest/v1/information_schema.columns"
        f"?select=table_name,column_name,ordinal_position,column_default,"
        f"is_nullable,data_type,udt_name,character_maximum_length,"
        f"numeric_precision,numeric_scale"
        f"&table_schema=eq.public"
        f"&table_name=in.({urllib.parse.quote(','.join(tables))})"
        f"&order=table_name,ordinal_position"
    )
    try:
        return http_get_json(url, headers)
    except Exception:
        return []


def fetch_constraints(base_url, headers, tables):
    try:
        tc = http_get_json(
            f"{base_url}/rest/v1/information_schema.table_constraints"
            f"?select=constraint_name,table_name,constraint_type"
            f"&table_schema=eq.public"
            f"&table_name=in.({urllib.parse.quote(','.join(tables))})",
            headers
        )
        kcu = http_get_json(
            f"{base_url}/rest/v1/information_schema.key_column_usage"
            f"?select=constraint_name,table_name,column_name,ordinal_position"
            f"&table_schema=eq.public"
            f"&table_name=in.({urllib.parse.quote(','.join(tables))})"
            f"&order=constraint_name,ordinal_position",
            headers
        )
        ref = http_get_json(
            f"{base_url}/rest/v1/information_schema.referential_constraints"
            f"?select=constraint_name,unique_constraint_name,delete_rule,update_rule"
            f"&constraint_schema=eq.public",
            headers
        )
        return tc, kcu, ref
    except Exception as e:
        print(f"  WARN: Could not fetch constraints: {e}", file=sys.stderr)
        return [], [], []


def col_type_sql(row):
    dt = row["data_type"]
    udt = row["udt_name"]
    if dt == "character varying":
        ml = row.get("character_maximum_length")
        return f"varchar({ml})" if ml else "text"
    if dt == "character":
        ml = row.get("character_maximum_length")
        return f"char({ml})" if ml else "char"
    if dt == "numeric":
        p = row.get("numeric_precision")
        s = row.get("numeric_scale")
        return f"numeric({p},{s})" if p and s else "numeric"
    if dt == "USER-DEFINED":
        return f'"{udt}"'
    if dt == "ARRAY":
        return f"{udt.lstrip('_')}[]"
    return dt


def build_schema_from_information_schema(columns, constraints, kcu, ref_constraints, tables):
    lines = []
    table_cols = defaultdict(list)
    for row in columns:
        table_cols[row["table_name"]].append(row)

    kcu_map = defaultdict(list)
    for row in kcu:
        kcu_map[row["constraint_name"]].append(row["column_name"])

    ctype_map = {}
    for row in constraints:
        ctype_map[row["constraint_name"]] = (row["constraint_type"], row["table_name"])

    fk_ref_map = {}
    for row in ref_constraints:
        fk_ref_map[row["constraint_name"]] = row

    for table in tables:
        cols = table_cols.get(table, [])
        if not cols:
            continue
        lines.append(f'CREATE TABLE IF NOT EXISTS "{table}" (')
        col_lines = []
        for col in sorted(cols, key=lambda r: r["ordinal_position"]):
            cname = col["column_name"]
            ctype = col_type_sql(col)
            nullable = "" if col["is_nullable"] == "YES" else " NOT NULL"
            default = f" DEFAULT {col['column_default']}" if col.get("column_default") else ""
            col_lines.append(f'    "{cname}" {ctype}{nullable}{default}')
        lines.append(",\n".join(col_lines))
        lines.append(");")
        lines.append("")

    for cname, (ctype, tname) in ctype_map.items():
        if tname not in tables:
            continue
        cols_involved = kcu_map.get(cname, [])
        if not cols_involved:
            continue
        col_list = ", ".join(f'"{c}"' for c in cols_involved)
        if ctype == "PRIMARY KEY":
            lines.append(f'ALTER TABLE "{tname}" ADD CONSTRAINT "{cname}" PRIMARY KEY ({col_list});')
        elif ctype == "UNIQUE":
            lines.append(f'ALTER TABLE "{tname}" ADD CONSTRAINT "{cname}" UNIQUE ({col_list});')
        elif ctype == "FOREIGN KEY":
            ref = fk_ref_map.get(cname, {})
            ref_cname = ref.get("unique_constraint_name", "")
            del_rule = ref.get("delete_rule", "NO ACTION")
            upd_rule = ref.get("update_rule", "NO ACTION")
            ref_cols = kcu_map.get(ref_cname, [])
            ref_table = ctype_map.get(ref_cname, (None, None))[1]
            if ref_table and ref_cols:
                ref_col_list = ", ".join(f'"{c}"' for c in ref_cols)
                lines.append(
                    f'ALTER TABLE "{tname}" ADD CONSTRAINT "{cname}" '
                    f'FOREIGN KEY ({col_list}) REFERENCES "{ref_table}" ({ref_col_list}) '
                    f'ON DELETE {del_rule} ON UPDATE {upd_rule};'
                )
    lines.append("")
    return lines


def build_schema_from_openapi(spec, tables):
    """Fallback: reconstruct approximate CREATE TABLE from OpenAPI spec."""
    lines = []
    defs = spec.get("definitions", {})
    pg_type_map = {
        "integer": "integer", "number": "numeric",
        "string": "text", "boolean": "boolean",
        "object": "jsonb", "array": "jsonb",
    }
    fmt_map = {
        "bigint": "bigint", "integer": "integer", "uuid": "uuid",
        "timestamp with time zone": "timestamptz", "date": "date",
        "json": "jsonb", "jsonb": "jsonb", "numeric": "numeric",
    }
    for table in tables:
        defn = defs.get(table, {})
        props = defn.get("properties", {})
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


# ── Data ───────────────────────────────────────────────────────────────────

def fetch_all_rows(base_url, table, headers, chunk):
    rows = []
    offset = 0
    while True:
        url = (f"{base_url}/rest/v1/{urllib.parse.quote(table)}"
               f"?select=*&limit={chunk}&offset={offset}")
        h = {**headers, "Prefer": "count=exact"}
        status, body = _get(url, h)
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


def rows_to_sql(table, rows):
    if not rows:
        return [f"-- (no rows in {table})"]
    cols = ", ".join(f'"{c}"' for c in rows[0])
    out = []
    for row in rows:
        vals = ", ".join(sql_literal(v) for v in row.values())
        out.append(f'INSERT INTO "{table}" ({cols}) VALUES ({vals}) ON CONFLICT DO NOTHING;')
    return out


# ── Main ───────────────────────────────────────────────────────────────────

def main():
    p = argparse.ArgumentParser(description="Full Supabase backup via REST API (no pg_dump)")
    p.add_argument("--url",         required=True, help="https://xxxx.supabase.co")
    p.add_argument("--key",         required=True, help="service_role key")
    p.add_argument("--out",         default="backup.sql")
    p.add_argument("--tables",      default="", help="comma-separated; empty = all")
    p.add_argument("--chunk",       type=int, default=500)
    p.add_argument("--data-only",   action="store_true")
    p.add_argument("--schema-only", action="store_true")
    args = p.parse_args()

    base = args.url.rstrip("/")
    headers = {
        "apikey":        args.key,
        "Authorization": f"Bearer {args.key}",
        "Content-Type":  "application/json",
    }

    print("Fetching OpenAPI spec...")
    spec, all_tables = discover_tables(base, headers)
    tables = [t.strip() for t in args.tables.split(",") if t.strip()] if args.tables else all_tables

    if not tables:
        print("No tables found. Check your service_role key.", file=sys.stderr)
        sys.exit(1)

    print(f"Tables ({len(tables)}): {tables}")

    lines = [
        "-- ============================================================",
        "-- Supabase REST API backup (schema + data)",
        f"-- Project : {base}",
        f"-- Created : {datetime.now(timezone.utc).isoformat()}",
        f"-- Tables  : {', '.join(tables)}",
        '-- Restore : psql "$DATABASE_URL" -f backup.sql',
        "--         or paste into Supabase Dashboard -> SQL Editor",
        "-- ============================================================",
        "",
    ]

    if not args.data_only:
        print("\nFetching schema...")
        columns = fetch_columns(base, headers, tables)
        if columns:
            print(f"  {len(columns)} columns via information_schema.")
            tc, kcu, ref = fetch_constraints(base, headers, tables)
            schema_lines = build_schema_from_information_schema(columns, tc, kcu, ref, tables)
            lines += ["-- SCHEMA (from information_schema)", ""]
        else:
            print("  information_schema not exposed. Falling back to OpenAPI spec (approximate types).")
            schema_lines = build_schema_from_openapi(spec, tables)
            lines += ["-- SCHEMA (from OpenAPI spec -- review types before restoring)", ""]
        lines += schema_lines

    if not args.schema_only:
        lines += ["-- DATA", "", "BEGIN;", ""]
        total = 0
        for table in tables:
            print(f"  -> {table} ...", end=" ", flush=True)
            rows = fetch_all_rows(base, table, headers, args.chunk)
            print(f"{len(rows)} rows")
            total += len(rows)
            lines.append(f"-- {table}  ({len(rows)} rows)")
            lines += rows_to_sql(table, rows)
            lines.append("")
        lines += ["COMMIT;", "", f"-- Total rows: {total}"]

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"\nDone -> {args.out}")
    print(f'Restore: psql "$DATABASE_URL" -f {args.out}')


if __name__ == "__main__":
    main()
