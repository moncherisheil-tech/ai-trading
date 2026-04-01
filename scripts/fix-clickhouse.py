#!/usr/bin/env python3
"""
PROJECT SOVEREIGN - Fix ClickHouse crash loop
Connect as quant-admin (root SSH password auth now disabled by Phase 2 hardening)
"""
import paramiko
import time
import sys

HOST = "88.99.208.99"
PORT = 22
# Root password login is now disabled - use quant-admin
USER = "quant-admin"
PASS = "taLai8f5W?7P38"
INFRA_DIR = "/opt/quant-engine/infrastructure"

def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, PORT, username=USER, password=PASS, allow_agent=False, look_for_keys=False)
    return client

def run_cmd(client, cmd, timeout=60, label=None, sudo=True):
    lbl = label or cmd[:80]
    full_cmd = f"echo '{PASS}' | sudo -S bash -c {repr(cmd)}" if sudo else cmd
    stdin, stdout, stderr = client.exec_command(full_cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    # Strip sudo password prompt from stderr
    err_clean = '\n'.join(l for l in err.splitlines() if '[sudo]' not in l and 'password for' not in l.lower())
    code = stdout.channel.recv_exit_status()
    print(f"\n[CMD] {lbl}")
    print(f"[OUT] {out.strip()}" if out.strip() else "[OUT] (empty)")
    if err_clean.strip():
        print(f"[ERR] {err_clean.strip()}")
    print(f"[RC]  {code}")
    return out, err_clean, code

def write_file_sudo(client, remote_path, content):
    """Write via SFTP to /tmp then sudo move."""
    import io
    tmp = f"/tmp/_qc_write_{abs(hash(remote_path))}.tmp"
    sftp = client.open_sftp()
    with sftp.file(tmp, 'w') as f:
        f.write(content)
    sftp.close()
    run_cmd(client, f"mv {tmp} {remote_path}", label=f"move to {remote_path}")
    print(f"[SFTP+sudo] Written: {remote_path}")

client = connect()
print(f"[OK] Connected as {USER}")

# Get ClickHouse crash logs
print("\n[DIAG] ClickHouse crash investigation...")
run_cmd(client, "docker logs --tail 60 clickhouse 2>&1", timeout=20, label="docker logs clickhouse")
run_cmd(client, "docker inspect clickhouse --format '{{.State.ExitCode}} {{.State.Error}}'")

# Check ClickHouse error log inside volume
run_cmd(client, f"ls -la {INFRA_DIR}/clickhouse/logs/ 2>/dev/null | head -10")
run_cmd(client, f"tail -50 {INFRA_DIR}/clickhouse/logs/clickhouse-server.err.log 2>/dev/null", label="ClickHouse error log")
run_cmd(client, f"tail -50 {INFRA_DIR}/clickhouse/logs/clickhouse-server.log 2>/dev/null | head -50", label="ClickHouse server log")

print("\n[FIX] Writing corrected ClickHouse config...")

CLICKHOUSE_MAX_MEM = 103_079_215_104  # 96 GB

# Minimal valid config for ClickHouse 24.x
# Memory limits belong in profiles for per-query limits
# max_server_memory_usage controls total server memory
clickhouse_config_fixed = f"""<clickhouse>
    <logger>
        <level>information</level>
        <log>/var/log/clickhouse-server/clickhouse-server.log</log>
        <errorlog>/var/log/clickhouse-server/clickhouse-server.err.log</errorlog>
        <size>500M</size>
        <count>10</count>
    </logger>

    <!-- Network -->
    <listen_host>0.0.0.0</listen_host>
    <http_port>8123</http_port>
    <tcp_port>9000</tcp_port>
    <interserver_http_port>9009</interserver_http_port>

    <!-- Storage paths on XFS NVMe volume -->
    <path>/var/lib/clickhouse/</path>
    <tmp_path>/var/lib/clickhouse/tmp/</tmp_path>
    <user_files_path>/var/lib/clickhouse/user_files/</user_files_path>
    <format_schema_path>/var/lib/clickhouse/format_schemas/</format_schema_path>

    <!-- Server-level memory limit (96GB) -->
    <max_server_memory_usage>{CLICKHOUSE_MAX_MEM}</max_server_memory_usage>

    <!-- Performance tuning -->
    <max_concurrent_queries>200</max_concurrent_queries>
    <max_connections>4096</max_connections>
    <keep_alive_timeout>600</keep_alive_timeout>
    <background_pool_size>32</background_pool_size>
    <background_schedule_pool_size>16</background_schedule_pool_size>

    <!-- Caches: Uncompressed=32GB, Mark=8GB -->
    <uncompressed_cache_size>34359738368</uncompressed_cache_size>
    <mark_cache_size>8589934592</mark_cache_size>

    <!-- Users config -->
    <users_config>users.xml</users_config>

    <!-- Default user memory quota -->
    <profiles>
        <default>
            <max_memory_usage>{CLICKHOUSE_MAX_MEM}</max_memory_usage>
        </default>
    </profiles>

    <distributed_ddl>
        <path>/clickhouse/task_queue/ddl</path>
    </distributed_ddl>
</clickhouse>
"""

write_file_sudo(client, f"{INFRA_DIR}/clickhouse/config/config.xml", clickhouse_config_fixed)

# Fix docker-compose.yml - remove version key and use mem_limit
compose_fixed = f"""services:

  clickhouse:
    image: clickhouse/clickhouse-server:latest
    container_name: clickhouse
    hostname: clickhouse
    restart: unless-stopped
    networks:
      quant-net:
        ipv4_address: 172.20.0.10
    ports:
      - "127.0.0.1:8123:8123"
      - "127.0.0.1:9000:9000"
    volumes:
      - {INFRA_DIR}/clickhouse/data:/var/lib/clickhouse
      - {INFRA_DIR}/clickhouse/logs:/var/log/clickhouse-server
      - {INFRA_DIR}/clickhouse/config/config.xml:/etc/clickhouse-server/config.xml:ro
    environment:
      - CLICKHOUSE_DB=quant
      - CLICKHOUSE_USER=default
      - CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1
    ulimits:
      nofile:
        soft: 1000000
        hard: 1000000
      memlock:
        soft: -1
        hard: -1
    cap_add:
      - IPC_LOCK
      - SYS_NICE
    mem_limit: 100g
    healthcheck:
      test: ["CMD-SHELL", "clickhouse-client --query 'SELECT 1' || exit 1"]
      interval: 15s
      timeout: 10s
      retries: 10
      start_period: 60s

  redis:
    image: redis:7-alpine
    container_name: redis
    hostname: redis
    restart: unless-stopped
    networks:
      quant-net:
        ipv4_address: 172.20.0.20
    ports:
      - "127.0.0.1:6379:6379"
    volumes:
      - {INFRA_DIR}/redis/redis.conf:/usr/local/etc/redis/redis.conf:ro
      - {INFRA_DIR}/redis/data:/data
    command: redis-server /usr/local/etc/redis/redis.conf
    sysctls:
      - net.core.somaxconn=65536
    ulimits:
      nofile:
        soft: 1000000
        hard: 1000000
    mem_limit: 10g
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s

networks:
  quant-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/24
"""

write_file_sudo(client, f"{INFRA_DIR}/docker-compose.yml", compose_fixed)

# Restart ClickHouse
print("\n[FIX] Restarting ClickHouse...")
run_cmd(client, f"cd {INFRA_DIR} && docker compose stop clickhouse && docker compose rm -f clickhouse 2>&1", timeout=30, label="stop/rm clickhouse")
run_cmd(client, f"cd {INFRA_DIR} && docker compose up -d clickhouse 2>&1", timeout=60, label="start clickhouse")

print("\n[WAIT] Waiting 75s for ClickHouse to initialize and pass health checks...")
time.sleep(75)

# Check
run_cmd(client, "docker ps -a --format 'table {{.Names}}\\t{{.Status}}'")
run_cmd(client, "docker logs --tail 30 clickhouse 2>&1", label="clickhouse logs (post-restart)")

# Try to connect
print("\n[TEST] Testing ClickHouse connectivity...")
connected = False
for i in range(8):
    out, err, code = run_cmd(client, "docker exec clickhouse clickhouse-client --query 'SELECT version(), uptime()' 2>&1", timeout=15, label=f"CH ping {i+1}/8")
    if code == 0 and out.strip() and '.' in out:
        print(f"[OK] ClickHouse responding: {out.strip()}")
        connected = True
        break
    time.sleep(10)

if not connected:
    # One more diagnostic
    run_cmd(client, f"tail -100 {INFRA_DIR}/clickhouse/logs/clickhouse-server.err.log 2>/dev/null", label="ClickHouse error log (final)")
    print("[WARN] ClickHouse still not responding - check error log above")

# Final verification
print("\n[FINAL VERIFICATION]")
run_cmd(client, "docker exec clickhouse clickhouse-client --query 'SELECT version(), uptime()'")
run_cmd(client, "docker exec clickhouse clickhouse-client --query 'SELECT getSetting(\"max_memory_usage\")'")
run_cmd(client, "docker exec clickhouse clickhouse-client --query 'CREATE DATABASE IF NOT EXISTS quant'")
run_cmd(client, "docker exec clickhouse clickhouse-client --query 'SHOW DATABASES'")
run_cmd(client, "docker exec redis redis-cli ping")
run_cmd(client, "docker exec redis redis-cli config get maxmemory | tail -1")
run_cmd(client, "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'")

client.close()
print("\n[DONE] Phase 3 verification complete")
