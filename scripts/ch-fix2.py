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
print("CONNECTED as quant-admin")

def sudo(cmd, timeout=60):
    full = f"echo '{PASS}' | sudo -S sh -c {repr(cmd)}"
    sin, sout, serr = client.exec_command(full, timeout=timeout)
    o = sout.read().decode('utf-8','replace')
    e = serr.read().decode('utf-8','replace')
    rc = sout.channel.recv_exit_status()
    e2 = '\n'.join(l for l in e.splitlines() if 'sudo' not in l.lower() and 'password' not in l.lower())
    print(f"\nCMD: {cmd[:70]}")
    print(f"OUT: {o.strip()[:600]}" if o.strip() else "OUT: (empty)")
    if e2.strip(): print(f"ERR: {e2.strip()[:400]}")
    print(f"RC: {rc}")
    return o, rc

# The fix: remove <users_config> tag - ClickHouse 26.x manages users internally
# Also verified: max_server_memory_usage is the correct tag (not max_memory_usage at server level)
config_fixed = f"""<clickhouse>
    <logger>
        <level>information</level>
        <log>/var/log/clickhouse-server/clickhouse-server.log</log>
        <errorlog>/var/log/clickhouse-server/clickhouse-server.err.log</errorlog>
        <size>500M</size>
        <count>10</count>
    </logger>

    <listen_host>0.0.0.0</listen_host>
    <http_port>8123</http_port>
    <tcp_port>9000</tcp_port>
    <interserver_http_port>9009</interserver_http_port>

    <path>/var/lib/clickhouse/</path>
    <tmp_path>/var/lib/clickhouse/tmp/</tmp_path>
    <user_files_path>/var/lib/clickhouse/user_files/</user_files_path>
    <format_schema_path>/var/lib/clickhouse/format_schemas/</format_schema_path>

    <!-- Lock 96GB for ClickHouse server-wide -->
    <max_server_memory_usage>{CLICKHOUSE_MAX_MEM}</max_server_memory_usage>

    <max_concurrent_queries>200</max_concurrent_queries>
    <max_connections>4096</max_connections>
    <keep_alive_timeout>600</keep_alive_timeout>
    <background_pool_size>32</background_pool_size>
    <background_schedule_pool_size>16</background_schedule_pool_size>

    <!-- Uncompressed block cache 32GB, mark cache 8GB -->
    <uncompressed_cache_size>34359738368</uncompressed_cache_size>
    <mark_cache_size>8589934592</mark_cache_size>

    <distributed_ddl>
        <path>/clickhouse/task_queue/ddl</path>
    </distributed_ddl>
</clickhouse>
"""

# Write config
sftp = client.open_sftp()
with sftp.file("/tmp/ch_config2.xml", 'w') as f:
    f.write(config_fixed)
sftp.close()
print("Config written to /tmp/ch_config2.xml")

sudo(f"cp /tmp/ch_config2.xml {INFRA_DIR}/clickhouse/config/config.xml")
sudo(f"cat {INFRA_DIR}/clickhouse/config/config.xml")

# Restart
print("\n--- Restarting ClickHouse with fixed config ---")
sudo(f"cd {INFRA_DIR} && docker compose restart clickhouse 2>&1")

print("\nWaiting 60s for ClickHouse to start...")
time.sleep(60)

sudo("docker ps -a --format 'table {{.Names}}\t{{.Status}}'")
sudo("docker logs --tail 20 clickhouse 2>&1")

# Test
print("\n--- Testing ClickHouse ---")
for i in range(8):
    o, rc = sudo("docker exec clickhouse clickhouse-client --query 'SELECT version(), uptime()' 2>&1")
    if rc == 0 and o.strip() and '.' in o and 'Error' not in o:
        print(f"\nCLICKHOUSE IS UP: {o.strip()}")
        break
    print(f"  attempt {i+1}/8, waiting 10s...")
    time.sleep(10)

# Get max_memory_usage setting
sudo("docker exec clickhouse clickhouse-client --query 'SELECT getSetting(\"max_memory_usage\")' 2>&1")
sudo("docker exec clickhouse clickhouse-client --query 'SELECT value FROM system.server_settings WHERE name = \"max_server_memory_usage\"' 2>&1")
sudo("docker exec clickhouse clickhouse-client --query 'CREATE DATABASE IF NOT EXISTS quant' 2>&1")
sudo("docker exec clickhouse clickhouse-client --query 'SHOW DATABASES' 2>&1")
sudo("docker exec redis redis-cli ping 2>&1")
sudo("docker exec redis redis-cli config get maxmemory 2>&1")
sudo("docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'")
sudo("free -h")

client.close()
print("\n=== PHASE 3 COMPLETE ===")
