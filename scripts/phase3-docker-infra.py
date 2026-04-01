#!/usr/bin/env python3
"""
PROJECT SOVEREIGN - PHASE 3: Docker + ClickHouse + Redis
- Install Docker Engine (latest stable) + Docker Compose plugin
- Create /opt/quant-engine/infrastructure
- Deploy ClickHouse (96GB RAM lock, XFS NVMe data volume)
- Deploy Redis (optimized for ultra-low latency pub/sub)
- Verify both containers are healthy
"""
import paramiko
import time
import sys

HOST = "88.99.208.99"
PORT = 22
USER = "root"
PASS = "taLai8f5W?7P38"
INFRA_DIR = "/opt/quant-engine/infrastructure"

def connect(host, port, user, password, timeout=30):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password,
                   timeout=timeout, allow_agent=False, look_for_keys=False)
    return client

def run_cmd(client, cmd, timeout=120, label=None):
    lbl = label or cmd[:80]
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    print(f"\n[CMD] {lbl}")
    print(f"[OUT] {out.strip()}" if out.strip() else "[OUT] (empty)")
    if err.strip():
        print(f"[ERR] {err.strip()}")
    print(f"[RC]  {code}")
    return out, err, code

def run_streaming(client, cmd, timeout=600, label=None):
    lbl = label or cmd[:80]
    print(f"\n[STREAM] {lbl}")
    channel = client.get_transport().open_session()
    channel.set_combine_stderr(True)
    channel.exec_command(cmd)
    output_parts = []
    start = time.time()
    while True:
        if channel.recv_ready():
            chunk = channel.recv(4096).decode('utf-8', errors='replace')
            print(chunk, end='', flush=True)
            output_parts.append(chunk)
        elif channel.exit_status_ready():
            while channel.recv_ready():
                chunk = channel.recv(4096).decode('utf-8', errors='replace')
                print(chunk, end='', flush=True)
                output_parts.append(chunk)
            break
        elif time.time() - start > timeout:
            print(f"\n[TIMEOUT] {timeout}s exceeded")
            channel.close()
            return ''.join(output_parts), -1
        else:
            time.sleep(2)
    code = channel.recv_exit_status()
    print(f"\n[RC] {code}")
    return ''.join(output_parts), code

def write_file(client, remote_path, content):
    sftp = client.open_sftp()
    with sftp.file(remote_path, 'w') as f:
        f.write(content)
    sftp.close()
    print(f"[SFTP] Written: {remote_path}")

print("=" * 70)
print("PROJECT SOVEREIGN - PHASE 3: DOCKER + CLICKHOUSE + REDIS")
print("=" * 70)

print(f"\n[3.1] Connecting to {HOST}...")
client = connect(HOST, PORT, USER, PASS)
print("[OK] Connected")
run_cmd(client, "lsb_release -d && uname -r")

# ── Step 1: Install Docker Engine ────────────────────────────────────────
print("\n[3.2] Installing Docker Engine (official apt repository)...")
docker_install_script = """
# Remove any old Docker packages
apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install prerequisites
apt-get update -qq
apt-get install -y ca-certificates curl gnupg

# Add Docker official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
apt-get update -qq
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Enable and start Docker
systemctl enable --now docker
"""
run_streaming(client, docker_install_script, timeout=300, label="Install Docker Engine")

# Verify Docker
run_cmd(client, "docker --version && docker compose version")
run_cmd(client, "systemctl is-active docker")

# Add quant-admin to docker group
run_cmd(client, "usermod -aG docker quant-admin && echo 'quant-admin added to docker group'")

# ── Step 2: Create directory structure ───────────────────────────────────
print(f"\n[3.3] Creating directory structure at {INFRA_DIR}...")
run_cmd(client, f"mkdir -p {INFRA_DIR}/clickhouse/data")
run_cmd(client, f"mkdir -p {INFRA_DIR}/clickhouse/logs")
run_cmd(client, f"mkdir -p {INFRA_DIR}/clickhouse/config")
run_cmd(client, f"mkdir -p {INFRA_DIR}/redis/data")
run_cmd(client, f"ls -la {INFRA_DIR}")

# ── Step 3: ClickHouse custom config (96GB RAM lock) ─────────────────────
print("\n[3.4] Writing ClickHouse configuration (96GB memory lock)...")

# 96GB = 103,079,215,104 bytes
CLICKHOUSE_MAX_MEM = 103_079_215_104  # 96 * 1024^3

clickhouse_config = f"""<clickhouse>
    <logger>
        <level>information</level>
        <log>/var/log/clickhouse-server/clickhouse-server.log</log>
        <errorlog>/var/log/clickhouse-server/clickhouse-server.err.log</errorlog>
        <size>500M</size>
        <count>10</count>
    </logger>

    <!-- Memory Configuration: Lock 96GB for ClickHouse -->
    <max_memory_usage>{CLICKHOUSE_MAX_MEM}</max_memory_usage>
    <max_memory_usage_for_user>{CLICKHOUSE_MAX_MEM}</max_memory_usage_for_user>
    <max_memory_usage_for_all_queries>{CLICKHOUSE_MAX_MEM}</max_memory_usage_for_all_queries>

    <!-- Enable memory locking to prevent swap -->
    <mlock_executable>true</mlock_executable>

    <!-- Storage paths on XFS NVMe volume -->
    <path>/var/lib/clickhouse/</path>
    <tmp_path>/var/lib/clickhouse/tmp/</tmp_path>
    <user_files_path>/var/lib/clickhouse/user_files/</user_files_path>
    <format_schema_path>/var/lib/clickhouse/format_schemas/</format_schema_path>

    <!-- Network -->
    <listen_host>0.0.0.0</listen_host>
    <http_port>8123</http_port>
    <tcp_port>9000</tcp_port>
    <interserver_http_port>9009</interserver_http_port>

    <!-- Performance tuning for NVMe + HFT -->
    <max_concurrent_queries>200</max_concurrent_queries>
    <max_connections>4096</max_connections>
    <keep_alive_timeout>600</keep_alive_timeout>

    <!-- Thread pool for background operations -->
    <background_pool_size>32</background_pool_size>
    <background_merges_mutations_concurrency_ratio>2</background_merges_mutations_concurrency_ratio>
    <background_schedule_pool_size>16</background_schedule_pool_size>

    <!-- Uncompressed block cache: 32GB -->
    <uncompressed_cache_size>34359738368</uncompressed_cache_size>
    <!-- Mark cache: 8GB -->
    <mark_cache_size>8589934592</mark_cache_size>

    <!-- Disable core dumps -->
    <core_dump>
        <size_limit>0</size_limit>
    </core_dump>

    <!-- Default database -->
    <default_database>quant</default_database>

    <users_config>users.xml</users_config>

    <distributed_ddl>
        <path>/clickhouse/task_queue/ddl</path>
    </distributed_ddl>
</clickhouse>
"""

write_file(client, f"{INFRA_DIR}/clickhouse/config/config.xml", clickhouse_config)

# ── Step 4: Redis configuration ───────────────────────────────────────────
print("\n[3.5] Writing Redis configuration (ultra-low latency pub/sub)...")

redis_config = """# Project Sovereign - Redis HFT Configuration
# Optimized for ultra-low latency pub/sub (inter-process messaging)

# Network
bind 0.0.0.0
port 6379
tcp-backlog 65536
timeout 0
tcp-keepalive 60

# Latency optimization
latency-monitor-threshold 1
latency-tracking yes
slowlog-log-slower-than 1000
slowlog-max-len 1024

# Disable persistence for pure in-memory pub/sub (HFT use case)
# Note: Enable AOF/RDB if persistence is needed for order books
save ""
appendonly no

# Memory
maxmemory 8gb
maxmemory-policy allkeys-lru

# Performance
hz 100
dynamic-hz yes
aof-use-rdb-preamble yes
lazyfree-lazy-eviction yes
lazyfree-lazy-expire yes
lazyfree-lazy-server-del yes
replica-lazy-flush yes

# Threading (use multiple I/O threads for high throughput)
io-threads 4
io-threads-do-reads yes

# Disable protected-mode (we're behind UFW)
protected-mode no

# Pub/Sub channel limits
client-output-buffer-limit pubsub 256mb 64mb 60

# Logging
loglevel notice
logfile ""

# Database count (1 is sufficient for pub/sub)
databases 16
"""

write_file(client, f"{INFRA_DIR}/redis/redis.conf", redis_config)

# ── Step 5: Docker Compose file ───────────────────────────────────────────
print("\n[3.6] Writing docker-compose.yml...")

compose_content = f"""version: '3.8'

# Project Sovereign - Infrastructure Stack
# ClickHouse (96GB RAM) + Redis (8GB, ultra-low latency pub/sub)

networks:
  quant-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/24

services:

  # ─────────────────────────────────────────────────────────────────────
  # ClickHouse: Institutional-grade OLAP for trade data storage
  # Memory: 96GB locked | Storage: XFS NVMe /dev/md1
  # ─────────────────────────────────────────────────────────────────────
  clickhouse:
    image: clickhouse/clickhouse-server:latest
    container_name: clickhouse
    hostname: clickhouse
    restart: unless-stopped
    networks:
      quant-net:
        ipv4_address: 172.20.0.10
    ports:
      - "127.0.0.1:8123:8123"   # HTTP interface (localhost only)
      - "127.0.0.1:9000:9000"   # Native protocol (localhost only)
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
    deploy:
      resources:
        limits:
          memory: 100G    # Container memory ceiling (slightly above 96GB config)
        reservations:
          memory: 96G     # Reserve 96GB upfront
    healthcheck:
      test: ["CMD", "clickhouse-client", "--query", "SELECT 1"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s

  # ─────────────────────────────────────────────────────────────────────
  # Redis: Ultra-low latency pub/sub for inter-service messaging
  # Memory: 8GB | Persistence: disabled (pure in-memory)
  # ─────────────────────────────────────────────────────────────────────
  redis:
    image: redis:7-alpine
    container_name: redis
    hostname: redis
    restart: unless-stopped
    networks:
      quant-net:
        ipv4_address: 172.20.0.20
    ports:
      - "127.0.0.1:6379:6379"   # Redis (localhost only)
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
    deploy:
      resources:
        limits:
          memory: 10G
        reservations:
          memory: 8G
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 10s
"""

write_file(client, f"{INFRA_DIR}/docker-compose.yml", compose_content)
run_cmd(client, f"cat {INFRA_DIR}/docker-compose.yml")

# ── Step 6: Fix sshd service name (Ubuntu uses ssh not sshd) ─────────────
run_cmd(client, "systemctl reload ssh && echo 'SSH config reloaded' || systemctl reload sshd && echo 'sshd reloaded'")

# ── Step 7: Pull images and start containers ──────────────────────────────
print("\n[3.7] Pulling Docker images...")
run_streaming(client,
    f"cd {INFRA_DIR} && docker compose pull 2>&1",
    timeout=300, label="docker compose pull")

print("\n[3.8] Starting infrastructure containers...")
run_streaming(client,
    f"cd {INFRA_DIR} && docker compose up -d 2>&1",
    timeout=120, label="docker compose up -d")

# ── Step 8: Wait for containers to be healthy ─────────────────────────────
print("\n[3.9] Waiting for containers to reach healthy state (up to 60s)...")
for attempt in range(12):
    time.sleep(5)
    out, _, _ = run_cmd(client, "docker ps --format 'table {{.Names}}\\t{{.Status}}\\t{{.Ports}}'")
    if "healthy" in out or "(health:" in out:
        print(f"[OK] Containers reporting health after {(attempt+1)*5}s")
        if out.count("healthy") >= 2:
            break
    print(f"  [wait] attempt {attempt+1}/12...")

# ── Step 9: Verify ClickHouse and Redis ───────────────────────────────────
print("\n[3.10] VERIFICATION")
print("=" * 50)

print("\n--- Docker containers ---")
run_cmd(client, "docker ps -a --format 'table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}'")

print("\n--- ClickHouse connectivity ---")
run_cmd(client, "docker exec clickhouse clickhouse-client --query 'SELECT version(), uptime()'", timeout=30)
run_cmd(client, "docker exec clickhouse clickhouse-client --query 'SELECT getSetting(\"max_memory_usage\")'", timeout=15)
run_cmd(client, "docker exec clickhouse clickhouse-client --query 'SHOW DATABASES'", timeout=15)

print("\n--- Redis connectivity ---")
run_cmd(client, "docker exec redis redis-cli ping", timeout=10)
run_cmd(client, "docker exec redis redis-cli info server | grep -E 'redis_version|uptime|hz'", timeout=10)
run_cmd(client, "docker exec redis redis-cli info memory | grep -E 'used_memory_human|maxmemory_human'", timeout=10)

print("\n--- System memory after containers ---")
run_cmd(client, "free -h")
run_cmd(client, "docker stats --no-stream --format 'table {{.Name}}\\t{{.MemUsage}}\\t{{.CPUPerc}}'")

print("\n--- Storage on XFS ---")
run_cmd(client, "df -hT /opt/quant-engine/")

client.close()

print("\n" + "=" * 70)
print("PHASE 3 SUCCESS")
print("  Docker:     Engine + Compose installed, quant-admin in docker group")
print(f"  InfraDir:   {INFRA_DIR}")
print(f"  ClickHouse: Running on 127.0.0.1:8123/9000, max_memory={CLICKHOUSE_MAX_MEM//1024//1024//1024}GB")
print("  Redis:      Running on 127.0.0.1:6379, 8GB cap, io-threads=4, persistence OFF")
print("  Network:    quant-net 172.20.0.0/24 (isolated bridge)")
print("  NEXT:       Phase 4 - Rust toolchain + ingestion engine scaffold")
print("=" * 70)
