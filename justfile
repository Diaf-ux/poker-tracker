set dotenv-load

backup_dir := "backup"

default:
    @just --list

# Run development environment
up:
    docker compose up --build -d

# Runs development environment and restore latest anonymized backup
up-anonymized:
    @ls {{backup_dir}}/backup-latest-anonymized.sql > /dev/null 2>&1 || (echo "backup-latest-anonymized.sql not found. Run 'just backup-anonymize' to fetch it" && exit 1)
    @docker compose up --build -d
    @echo "Waiting for postgres to be ready..."
    @until docker exec poker-db pg_isready -U poker -d poker > /dev/null 2>&1; do sleep 1; done
    @echo "Restoring {{backup_dir}}/backup-latest-anonymized.sql..."
    docker exec -i poker-db psql -U poker -d poker < {{backup_dir}}/backup-latest-anonymized.sql
    @echo "Done. Latest anonymized backup restored"

# Remove all the containers and preserve volumes
down:
    docker compose down

# Shutdown dev-env with removing all the volumes, specifically PostgreSQL one
down-flush:
    docker compose down --volumes

# Rebuilds the app
rebuild-app:
    docker compose down app
    docker compose up --build -d

[doc("""
WSL-compatible way to run repomix and copy tp clipboard
""")]
repomix:
    repomix
    cat repomix-output.md | clip.exe

[doc("""
Backup Supabase DB to backup/backup-TIMESTAMP.sql using custom script
Also copies created backup to backup-latest.sql
""")]
backup:
    #!/usr/bin/env bash
    set -euo pipefail
    timestamp=$(date +%Y%m%d%H%M%S)
    python scripts/supabase_backup.py --url ${SUPABASE_URL_PROD} --key ${SUPABASE_SECRET_KEY_PROD} --out {{backup_dir}}/backup-${timestamp}.sql
    cp {{backup_dir}}/backup-${timestamp}.sql {{backup_dir}}/backup-latest.sql

[doc("""
Backs up Supabase DB, anonymizes data and save into {{backup_dir}}/backup-latest-anonymized.sql
""")]
backup-anonymize: backup
    python scripts/anonymize_backup.py {{backup_dir}}/backup-latest.sql --out {{backup_dir}}/backup-latest-anonymized.sql

# Remove old backups, keeping the 5 most recent
backup-clean:
    #!/usr/bin/env bash
    set -euo pipefail
    backups_to_preserve=3
    ls -1t {{backup_dir}}/backup-*.sql 2>/dev/null \
        | grep -v "backup-latest\.sql" \
        | grep -v "backup-latest-anonymized\.sql" \
        | tail -n +$((backups_to_preserve + 1)) \
        | xargs -r rm --
    echo "Cleanup done. Kept ${backups_to_preserve} backups."
