#!/usr/bin/env bash
# ============================================================
#  QUANTUM MON CHERI — German Server Postgres Remote-Access Setup
#  Run this script AS ROOT (or via sudo) on the server at 88.99.208.99
#
#  Usage:
#    chmod +x setup-remote-postgres.sh
#    sudo bash setup-remote-postgres.sh
# ============================================================
set -euo pipefail

# ── CONFIG ──────────────────────────────────────────────────
PG_VERSION=""          # Auto-detected below
PG_USER="postgres"
CLIENT_CIDR="0.0.0.0/0"   # Allow any IP; tighten to your app server IP in prod
AUTH_METHOD="scram-sha-256"
# ────────────────────────────────────────────────────────────

echo "==> [1/5] Detecting installed PostgreSQL version..."
if command -v pg_lsclusters &>/dev/null; then
  # Debian/Ubuntu with pg_ctlcluster
  PG_VERSION=$(pg_lsclusters --no-header | awk '{print $1; exit}')
  CLUSTER_NAME=$(pg_lsclusters --no-header | awk '{print $2; exit}')
  CONF_DIR="/etc/postgresql/${PG_VERSION}/main"
  PG_HBA="${CONF_DIR}/pg_hba.conf"
  PG_CONF="${CONF_DIR}/postgresql.conf"
  RESTART_CMD="pg_ctlcluster ${PG_VERSION} ${CLUSTER_NAME} restart"
else
  # Fallback: find the data directory from a running postgres process
  PGDATA=$(psql -U postgres -tAc "SHOW data_directory;" 2>/dev/null || true)
  if [[ -z "$PGDATA" ]]; then
    echo "ERROR: Cannot locate PostgreSQL data directory. Set PGDATA manually."
    exit 1
  fi
  PG_HBA="${PGDATA}/pg_hba.conf"
  PG_CONF="${PGDATA}/postgresql.conf"
  RESTART_CMD="systemctl restart postgresql"
fi
echo "    Detected config dir: ${CONF_DIR:-$PGDATA}"

# ── STEP 2: UFW ──────────────────────────────────────────────
echo "==> [2/5] Opening port 5432 in UFW..."
if command -v ufw &>/dev/null; then
  ufw allow 5432/tcp
  ufw --force reload
  echo "    UFW rule added: 5432/tcp ALLOW"
else
  echo "    WARN: ufw not found. If using iptables, run:"
  echo "          iptables -A INPUT -p tcp --dport 5432 -j ACCEPT"
fi

# ── STEP 3: listen_addresses ─────────────────────────────────
echo "==> [3/5] Setting listen_addresses = '*' in postgresql.conf..."
# Backup first
cp "${PG_CONF}" "${PG_CONF}.bak.$(date +%Y%m%d%H%M%S)"

if grep -qE "^#?\s*listen_addresses" "${PG_CONF}"; then
  sed -i "s|^#*\s*listen_addresses\s*=.*|listen_addresses = '*'|" "${PG_CONF}"
else
  echo "listen_addresses = '*'" >> "${PG_CONF}"
fi

# While here, also bump tcp_keepalives for long-running cross-border connections:
if grep -qE "^#?\s*tcp_keepalives_idle" "${PG_CONF}"; then
  sed -i "s|^#*\s*tcp_keepalives_idle\s*=.*|tcp_keepalives_idle = 60|" "${PG_CONF}"
else
  echo "tcp_keepalives_idle = 60" >> "${PG_CONF}"
fi
if grep -qE "^#?\s*tcp_keepalives_interval" "${PG_CONF}"; then
  sed -i "s|^#*\s*tcp_keepalives_interval\s*=.*|tcp_keepalives_interval = 10|" "${PG_CONF}"
else
  echo "tcp_keepalives_interval = 10" >> "${PG_CONF}"
fi
if grep -qE "^#?\s*tcp_keepalives_count" "${PG_CONF}"; then
  sed -i "s|^#*\s*tcp_keepalives_count\s*=.*|tcp_keepalives_count = 6|" "${PG_CONF}"
else
  echo "tcp_keepalives_count = 6" >> "${PG_CONF}"
fi
echo "    postgresql.conf updated."

# ── STEP 4: pg_hba.conf ──────────────────────────────────────
echo "==> [4/5] Adding remote-access rule to pg_hba.conf..."
cp "${PG_HBA}" "${PG_HBA}.bak.$(date +%Y%m%d%H%M%S)"

# Idempotent: only add if no matching line already exists
HBA_LINE="host    all             ${PG_USER}          ${CLIENT_CIDR}          ${AUTH_METHOD}"
if grep -qF "${HBA_LINE}" "${PG_HBA}"; then
  echo "    Rule already present — skipping."
else
  # Insert BEFORE the first 'host' line so it takes precedence
  sed -i "0,/^host/{s|^host|${HBA_LINE}\nhost|}" "${PG_HBA}" || echo "${HBA_LINE}" >> "${PG_HBA}"
  echo "    pg_hba.conf updated:"
  echo "    ${HBA_LINE}"
fi

# ── STEP 5: Restart Postgres ─────────────────────────────────
echo "==> [5/5] Restarting PostgreSQL..."
eval "${RESTART_CMD}"
echo "    PostgreSQL restarted."

# ── VERIFICATION ─────────────────────────────────────────────
echo ""
echo "==> Verification:"
echo "    Port 5432 status:"
ss -tlnp | grep 5432 || netstat -tlnp 2>/dev/null | grep 5432 || echo "    (ss/netstat unavailable)"
echo ""
echo "    UFW status:"
ufw status numbered 2>/dev/null | grep 5432 || echo "    (ufw status unavailable)"
echo ""
echo "==> Done. Test from your app server:"
echo "    psql \"postgresql://postgres:<PASSWORD>@88.99.208.99:5432/postgres?sslmode=disable\""
