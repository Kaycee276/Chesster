#!/usr/bin/env bash
#
# backup.sh — Automated PostgreSQL backup & encrypted snapshot export
#
# Dumps the Chesster PostgreSQL schema + data and writes an encrypted,
# timestamped snapshot for disaster recovery. Designed to be idempotent
# and safe to run repeatedly (e.g. via cron).
#
# Requirements:
#   - pg_dump           (provided by the postgresql-client package)
#   - gpg               (for encryption; openssl used as a fallback)
#
# Configuration (all optional — sensible defaults for local dev):
#   PGHOST            Database host            (default: localhost)
#   PGPORT            Database port            (default: 5432)
#   PGUSER            Database user            (default: chesster_user)
#   PGPASSWORD        Database password        (default: chesster_password)
#   PGDATABASE        Database name            (default: chesster_db)
#   BACKUP_DIR        Snapshot output directory (default: ./backups)
#   BACKUP_PASSPHRASE Passphrase used to encrypt the snapshot.
#                     If unset, a random passphrase is generated and printed.
#   RETENTION         Number of snapshots to keep (default: 7)
#   USE_OPENSSL       Set to "1" to force openssl encryption instead of gpg.
#
# Usage:
#   ./backup.sh                 # create an encrypted snapshot
#   ./backup.sh --no-encrypt    # create a plain (unencrypted) snapshot
#   ./backup.sh --verify        # decrypt + validate the latest snapshot
#
set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration (env-overridable)
# ---------------------------------------------------------------------------
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-chesster_user}"
PGPASSWORD="${PGPASSWORD:-chesster_password}"
PGDATABASE="${PGDATABASE:-chesster_db}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$SCRIPT_DIR/backups}"
RETENTION="${RETENTION:-7}"

NO_ENCRYPT=0
VERIFY=0
USE_OPENSSL="${USE_OPENSSL:-0}"

for arg in "$@"; do
  case "$arg" in
    --no-encrypt) NO_ENCRYPT=1 ;;
    --verify)     VERIFY=1 ;;
    --openssl)    USE_OPENSSL=1 ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^#\s\?//'
      exit 0
      ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# ---------------------------------------------------------------------------
# Dependency checks
# ---------------------------------------------------------------------------
require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: required command '$1' is not installed." >&2
    exit 1
  fi
}

require_cmd pg_dump
if [ "$NO_ENCRYPT" -eq 0 ]; then
  if [ "$USE_OPENSSL" -eq 1 ]; then
    require_cmd openssl
  else
    require_cmd gpg
  fi
fi

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
timestamp="$(date +%Y%m%d-%H%M%S)"
snapshot_name="chesster_db-${timestamp}"
dump_file="${BACKUP_DIR}/${snapshot_name}.sql"
archive_file="${BACKUP_DIR}/${snapshot_name}.sql.gz"

mkdir -p "$BACKUP_DIR"

export PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE

# ---------------------------------------------------------------------------
# Verify mode: validate the most recent snapshot
# ---------------------------------------------------------------------------
if [ "$VERIFY" -eq 1 ]; then
  latest="$(ls -1t "${BACKUP_DIR}"/chesster_db-*.sql.gz* 2>/dev/null | head -n1 || true)"
  if [ -z "$latest" ]; then
    echo "Error: no snapshots found in ${BACKUP_DIR} to verify." >&2
    exit 1
  fi
  echo "Verifying snapshot: $latest"
  if [[ "$latest" == *.gpg ]]; then
    if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
      echo "Error: BACKUP_PASSPHRASE must be set to verify an encrypted snapshot." >&2
      exit 1
    fi
    tmp="$(mktemp)"
    gpg --batch --yes --quiet --passphrase "$BACKUP_PASSPHRASE" \
      --decrypt "$latest" | gzip -d > "$tmp"
    result="$tmp"
  elif [[ "$latest" == *.enc ]]; then
    if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
      echo "Error: BACKUP_PASSPHRASE must be set to verify an encrypted snapshot." >&2
      exit 1
    fi
    tmp="$(mktemp)"
    openssl enc -d -aes-256-cbc -pbkdf2 -salt \
      -pass env:BACKUP_PASSPHRASE -in "$latest" | gzip -d > "$tmp"
    result="$tmp"
  else
    tmp="$(mktemp)"
    gzip -d -c "$latest" > "$tmp"
    result="$tmp"
  fi
  if grep -q "CREATE TABLE" "$result"; then
    echo "✅ Snapshot is valid (contains schema DDL)."
    rm -f "$tmp"
    exit 0
  else
    echo "❌ Snapshot appears corrupt (no schema DDL found)." >&2
    rm -f "$tmp"
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# 1. Dump schema + data
# ---------------------------------------------------------------------------
echo "==> Dumping schema + data from ${PGUSER}@${PGHOST}:${PGPORT}/${PGDATABASE}"
pg_dump \
  --host="$PGHOST" \
  --port="$PGPORT" \
  --username="$PGUSER" \
  --dbname="$PGDATABASE" \
  --schema-public \
  --no-owner \
  --clean --if-exists \
  --format=plain \
  --file="$dump_file"

# Compress the dump to keep snapshots small.
gzip -f "$dump_file"
echo "    Dump written to: $archive_file"

# ---------------------------------------------------------------------------
# 2. Encrypt the snapshot (unless disabled)
# ---------------------------------------------------------------------------
if [ "$NO_ENCRYPT" -eq 0 ]; then
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    BACKUP_PASSPHRASE="$(openssl rand -hex 24 2>/dev/null || head -c 48 /dev/urandom | base64)"
    echo "    Generated random passphrase: ${BACKUP_PASSPHRASE}"
    echo "    ⚠️  Store this passphrase safely — it is required to restore."
  fi
  export BACKUP_PASSPHRASE

  if [ "$USE_OPENSSL" -eq 1 ]; then
    encrypted_file="${archive_file}.enc"
    openssl enc -e -aes-256-cbc -pbkdf2 -salt \
      -pass env:BACKUP_PASSPHRASE -in "$archive_file" -out "$encrypted_file"
    rm -f "$archive_file"
    final_file="$encrypted_file"
  else
    encrypted_file="${archive_file}.gpg"
    gpg --batch --yes --quiet \
      --passphrase "$BACKUP_PASSPHRASE" \
      --symmetric --cipher-algo AES256 \
      --output "$encrypted_file" "$archive_file"
    rm -f "$archive_file"
    final_file="$encrypted_file"
  fi
  echo "    Encrypted snapshot: $final_file"
else
  final_file="$archive_file"
  echo "    Plain (unencrypted) snapshot: $final_file"
fi

# ---------------------------------------------------------------------------
# 3. Apply retention policy (keep the newest RETENTION snapshots)
# ---------------------------------------------------------------------------
echo "==> Enforcing retention (keeping latest ${RETENTION})"
ls -1t "${BACKUP_DIR}"/chesster_db-* 2>/dev/null | tail -n +"$((RETENTION + 1))" | while read -r old; do
  echo "    Removing old snapshot: $old"
  rm -f "$old"
done

echo "✅ Backup complete: $final_file"
echo "    Restore example (gpg):"
echo "      gpg --batch --yes --passphrase \"\$BACKUP_PASSPHRASE\" --decrypt $final_file | gunzip | psql $PGDATABASE"
