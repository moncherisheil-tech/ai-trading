"""
ClickHouse fix: Use config.d/ override (correct ClickHouse 26.x pattern)
Instead of replacing config.xml entirely, place a partial override in config.d/
This preserves all ClickHouse defaults including users.xml loading.
"""
import paramiko, time, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HOST = "88.99.208.99"
USER = "quant-admin"
PASS = "taLai8f5W?7P38"
INFRA_DIR = "/opt/quant-engine/infrastructure"
CLICKHOUSE_MAX_MEM = 103_079_215_104  # 96 GB

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, allow_agent=False, look_for_keys=False)
print("CONNECTED")

def sudo(cmd, timeout=60):
    full = f"echo '{PASS}' | sudo -S sh -c {repr(cmd)}"
    sin, sout, serr = client.exec_command(full, timeout=timeout)
    o = sout.read().decode('utf-8','replace')
    e = serr.read().decode('utf-8','replace')
    rc = sout.channel.recv_exit_status()
    e2 = '\n'.join(l for l in e.splitlines() if 'sudo' not in l.lower() and 'password' not in l.lower())
    print(f"\nCMD: {cmd[:70]}")
    print(f"OUT: {o.strip()[:800]}" if o.strip() else "OUT: (empty)")
    if e2.strip(): print(f"ERR: {e2.strip()[:400]}")
    print(f"RC: {rc}")
    return o, rc

# The correct pattern: put custom settings in config.d/
# config.d files are MERGED with the default config.xml (not replacing it)
custom_override = f"""<clickhouse>
    <!-- Project Sovereign: Memory + Performance Override -->

    <!-- Lock 96GB (103,079,215,104 bytes) for ClickHouse -->
    <max_server_memory_usage>{CLICKHOUSE_MAX_MEM}</max_server_memory_usage>

    <!-- Cache tuning: 32GB uncompressed + 8GB mark cache -->
    <uncompressed_cache_size>34359738368</uncompressed_cache_size>
    <mark_cache_size>8589934592</mark_cache_size>

    <!-- Connection tuning for HFT -->
    <max_concurrent_queries>200</max_concurrent_queries>
    <max_connections>4096</max_connections>
    <keep_alive_timeout>600</keep_alive_timeout>
    <background_pool_size>32</background_pool_size>
    <background_schedule_pool_size>16</background_schedule_pool_size>
</clickhouse>
"""

# Create config.d directory structure
sudo(f"mkdir -p {INFRA_DIR}/clickhouse/config.d")
print("Writing override to /tmp/quant_override.xml...")
sftp = client.open_sftp()
with sftp.file("/tmp/quant_override.xml", 'w') as f:
    f.write(custom_override)
sftp.close()
sudo(f"cp /tmp/quant_override.xml {INFRA_DIR}/clickhouse/config.d/quant_override.xml")
sudo(f"cat {INFRA_DIR}/clickhouse/config.d/quant_override.xml")

# Update docker-compose.yml:
# 1. Remove full config.xml mount (broken)
# 2. Add config.d directory mount (correct pattern)
compose_v2 = f"""services:

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
      - {INFRA_DIR}/clickhouse/config.d/quant_override.xml:/etc/clickhouse-server/config.d/quant_override.xml:ro
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

sftp = client.open_sftp()
with sftp.file("/tmp/compose_v2.yml", 'w') as f:
    f.write(compose_v2)
sftp.close()
sudo(f"cp /tmp/compose_v2.yml {INFRA_DIR}/docker-compose.yml")
print("docker-compose.yml updated")

# Recreate ClickHouse container with new compose config
print("\n--- Recreating ClickHouse container ---")
sudo(f"cd {INFRA_DIR} && docker compose stop clickhouse 2>&1")
sudo(f"cd {INFRA_DIR} && docker compose rm -f clickhouse 2>&1")
sudo(f"cd {INFRA_DIR} && docker compose up -d clickhouse 2>&1")

print("\nWaiting 90s for ClickHouse 26.x to initialize...")
time.sleep(90)

sudo("docker ps -a --format 'table {{.Names}}\t{{.Status}}'")
sudo("docker logs --tail 30 clickhouse 2>&1")

# Test connectivity
print("\n--- Testing ClickHouse connectivity ---")
connected = False
for i in range(10):
    o, rc = sudo("docker exec clickhouse clickhouse-client --query 'SELECT version(), uptime()' 2>&1")
    if rc == 0 and o.strip() and 'Error' not in o and 'Exception' not in o:
        print(f"\nCLICKHOUSE IS ALIVE: {o.strip()}")
        connected = True
        break
    print(f"  [{i+1}/10] Not ready, waiting 10s...")
    time.sleep(10)

if connected:
    sudo("docker exec clickhouse clickhouse-client --query 'SELECT value FROM system.server_settings WHERE name = \"max_server_memory_usage\"' 2>&1")
    sudo("docker exec clickhouse clickhouse-client --query 'CREATE DATABASE IF NOT EXISTS quant' 2>&1")
    sudo("docker exec clickhouse clickhouse-client --query 'SHOW DATABASES' 2>&1")
else:
    sudo("docker logs --tail 50 clickhouse 2>&1")
    print("[WARN] ClickHouse still not responding")

sudo("docker exec redis redis-cli ping 2>&1")
sudo("docker exec redis redis-cli config get maxmemory 2>&1")
sudo("docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'")
sudo("free -h")

client.close()
print("\n=== FIX3 COMPLETE ===")
