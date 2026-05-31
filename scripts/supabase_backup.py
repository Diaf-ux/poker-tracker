#!/usr/bin/env python3
"""
supabase_backup.py
Backs up all public-schema tables via the Supabase REST API (PostgREST).
No pg_dump, no direct DB connection required -- only URL + service_role key.

Usage:
    python supabase_backup.py \
        --url  https://xxxx.supabase.co \
        --key  your-service-role-key \
        --out  backup.sql

Optional:
    --tables users,games,hands   # only backup specific tables (empty = all)
    --chunk  500                 # rows per request (default 500)
"""

import argparse
import json
import sys
import urllib.request
import urllib.parse
from datetime import datetime, timezone


def _get(url, headers):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def fetch_json(url, headers):
    status, body = _get(url, headers)
    if status not in (200, 206):
        raise RuntimeError(f"HTTP {status} for {url}: {body.decode()[:300]}")
    return json.loads(body)


def discover_tables(base_url, headers):
    spec = fetch_json(f"{base_url}/rest/v1/", headers)
    tables = sorted(spec.get("definitions", {}).keys())
    if not tables:
        print("WARN: OpenAPI returned no definitions -- check your service_role key.", file=sys.stderr)
    return tables


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


def main():
    p = argparse.ArgumentParser(description="Backup Supabase tables to SQL via REST API")
    p.add_argument("--url",    required=True, help="https://xxxx.supabase.co")
    p.add_argument("--key",    required=True, help="service_role key")
    p.add_argument("--out",    default="backup.sql", help="output file (default: backup.sql)")
    p.add_argument("--tables", default="", help="comma-separated table names; empty = all")
    p.add_argument("--chunk",  type=int, default=500, help="rows per request (default 500)")
    args = p.parse_args()

    base = args.url.rstrip("/")
    headers = {
        "apikey":        args.key,
        "Authorization": f"Bearer {args.key}",
        "Content-Type":  "application/json",
    }

    if args.tables:
        tables = [t.strip() for t in args.tables.split(",") if t.strip()]
        print(f"Using explicit tables: {tables}")
    else:
        print("Discovering tables via PostgREST OpenAPI...")
        tables = discover_tables(base, headers)
        print(f"Found {len(tables)} table(s): {tables}")

    if not tables:
        print("Nothing to backup.", file=sys.stderr)
        sys.exit(1)

    now = datetime.now(timezone.utc).isoformat()
    lines = [
        "-- ============================================================",
        "-- Supabase REST API backup",
        f"-- Project : {base}",
        f"-- Created : {now}",
        f"-- Tables  : {', '.join(tables)}",
        "-- Restore : psql $DATABASE_URL -f backup.sql",
        "--         or paste into Supabase Dashboard -> SQL Editor",
        "-- ============================================================",
        "",
        "BEGIN;",
        "",
    ]

    total = 0
    for table in tables:
        print(f"  -> {table} ...", end=" ", flush=True)
        rows = fetch_all_rows(base, table, headers, args.chunk)
        print(f"{len(rows)} rows")
        total += len(rows)
        lines.append(f"-- {table}  ({len(rows)} rows)")
        lines.extend(rows_to_sql(table, rows))
        lines.append("")

    lines += [
        "COMMIT;",
        "",
        f"-- Total rows backed up: {total}",
    ]

    with open(args.out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"\nDone -- {total} rows written to {args.out}")
    print(f'Restore: psql "$DATABASE_URL" -f {args.out}')


if __name__ == "__main__":
    main()
