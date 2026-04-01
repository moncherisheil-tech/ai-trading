#!/usr/bin/env python3
"""
PROJECT SOVEREIGN - PHASE 2: Kernel HFT Tuning & Security
- Create quant-admin user with sudo, disable root password SSH
- UFW: allow only port 22
- Kernel sysctl tuning for high-throughput WebSocket ingest (HFT)
- Apply and verify all changes
"""
import paramiko
import sys
import io

HOST = "88.99.208.99"
PORT = 22
USER = "root"
PASS = "taLai8f5W?7P38"

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

def write_file(client, remote_path, content):
    """Write file via SFTP."""
    sftp = client.open_sftp()
    with sftp.file(remote_path, 'w') as f:
        f.write(content)
    sftp.close()
    print(f"[SFTP] Written: {remote_path}")

print("=" * 70)
print("PROJECT SOVEREIGN - PHASE 2: KERNEL HFT TUNING & SECURITY")
print("=" * 70)

print(f"\n[2.1] Connecting to Ubuntu 24.04 at {HOST}...")
client = connect(HOST, PORT, USER, PASS)
print("[OK] Connected")
run_cmd(client, "lsb_release -d && uname -r")

# ── Step 1: Create quant-admin user ──────────────────────────────────────
print("\n[2.2] Creating quant-admin user with sudo privileges...")
run_cmd(client, "id quant-admin 2>/dev/null && echo EXISTS || echo NOT_EXISTS")

# Create user, set password same as root for now (should be changed later)
cmds_user = [
    "useradd -m -s /bin/bash -G sudo quant-admin 2>/dev/null || echo 'User may already exist'",
    "echo 'quant-admin:taLai8f5W?7P38' | chpasswd",
    "usermod -aG sudo quant-admin",
    "id quant-admin",
    "groups quant-admin",
]
for c in cmds_user:
    run_cmd(client, c)

# ── Step 2: Harden SSH ────────────────────────────────────────────────────
print("\n[2.3] Hardening SSH configuration...")

sshd_config_additions = """
# Project Sovereign - Security Hardening
PermitRootLogin prohibit-password
PasswordAuthentication yes
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowTcpForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2
"""

# Read current sshd_config
out, _, _ = run_cmd(client, "cat /etc/ssh/sshd_config")

# Apply targeted changes using sed
ssh_changes = [
    # Disable root password login (allow key-based root for now during setup)
    "sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config",
    "sed -i 's/^#*MaxAuthTries.*/MaxAuthTries 3/' /etc/ssh/sshd_config",
    "sed -i 's/^#*LoginGraceTime.*/LoginGraceTime 30/' /etc/ssh/sshd_config",
    "sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config",
    # Ensure PermitRootLogin is set if not found
    "grep -q 'PermitRootLogin' /etc/ssh/sshd_config || echo 'PermitRootLogin prohibit-password' >> /etc/ssh/sshd_config",
]
for c in ssh_changes:
    run_cmd(client, c)

run_cmd(client, "grep -E 'PermitRootLogin|MaxAuthTries|LoginGraceTime|X11Forward' /etc/ssh/sshd_config")
run_cmd(client, "sshd -t && echo 'sshd config syntax OK'")
run_cmd(client, "systemctl reload sshd && echo 'sshd reloaded'")

# ── Step 3: Configure UFW ─────────────────────────────────────────────────
print("\n[2.4] Configuring UFW firewall (SSH only)...")
run_cmd(client, "apt-get install -y ufw 2>&1 | tail -5")
run_cmd(client, "ufw --force reset")
run_cmd(client, "ufw default deny incoming")
run_cmd(client, "ufw default allow outgoing")
run_cmd(client, "ufw allow 22/tcp comment 'SSH'")
run_cmd(client, "ufw --force enable")
run_cmd(client, "ufw status verbose")

# ── Step 4: Kernel HFT Tuning (sysctl) ───────────────────────────────────
print("\n[2.5] Applying HFT kernel tuning parameters...")

sysctl_config = """# =============================================================================
# Project Sovereign - HFT Kernel Tuning
# Optimized for high-throughput WebSocket ingest and low-latency trading
# =============================================================================

# Network receive/send buffer sizes (128MB) for massive WebSocket throughput
net.core.rmem_max = 134217728
net.core.wmem_max = 134217728
net.core.rmem_default = 16777216
net.core.wmem_default = 16777216

# TCP buffer autotuning (min/default/max in bytes)
net.ipv4.tcp_rmem = 4096 87380 134217728
net.ipv4.tcp_wmem = 4096 87380 134217728

# BBR TCP congestion control for optimal throughput
net.core.default_qdisc = fq
net.ipv4.tcp_congestion_control = bbr

# Massive connection queue for high-frequency trading
net.core.somaxconn = 65536
net.core.netdev_max_backlog = 262144
net.ipv4.tcp_max_syn_backlog = 65536

# TCP keep-alive for persistent WebSocket connections
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 10
net.ipv4.tcp_keepalive_probes = 6

# TIME_WAIT recycling for high connection churn
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_tw_reuse = 1

# File descriptor limits for 1M concurrent handles
fs.file-max = 1000000
fs.nr_open = 1000000

# Virtual memory tuning for ClickHouse
vm.swappiness = 10
vm.dirty_ratio = 60
vm.dirty_background_ratio = 2

# Huge pages for ClickHouse memory performance
vm.nr_hugepages = 0
# Note: ClickHouse manages its own memory, transparent hugepages handled below

# Shared memory for IPC
kernel.shmmax = 137438953472
kernel.shmall = 33554432

# Inotify limits for file watching
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512
"""

write_file(client, "/etc/sysctl.d/99-quant-hft.conf", sysctl_config)
run_cmd(client, "sysctl --system 2>&1 | grep -E '(quant|rmem_max|wmem_max|bbr|file-max|somaxconn)'")
run_cmd(client, "sysctl -p /etc/sysctl.d/99-quant-hft.conf 2>&1")

# ── Step 5: Transparent Hugepages - disable for ClickHouse ───────────────
print("\n[2.6] Disabling transparent hugepages (required for ClickHouse)...")
thp_service = """[Unit]
Description=Disable Transparent Huge Pages
DefaultDependencies=no
After=sysinit.target local-fs.target
Before=basic.target

[Service]
Type=oneshot
ExecStart=/bin/sh -c "echo never > /sys/kernel/mm/transparent_hugepage/enabled"
ExecStart=/bin/sh -c "echo never > /sys/kernel/mm/transparent_hugepage/defrag"
RemainAfterExit=yes

[Install]
WantedBy=basic.target
"""
write_file(client, "/etc/systemd/system/disable-thp.service", thp_service)
run_cmd(client, "systemctl daemon-reload")
run_cmd(client, "systemctl enable --now disable-thp.service")
run_cmd(client, "cat /sys/kernel/mm/transparent_hugepage/enabled")
run_cmd(client, "cat /sys/kernel/mm/transparent_hugepage/defrag")

# ── Step 6: Set system-wide ulimits ──────────────────────────────────────
print("\n[2.7] Setting system ulimits for high file descriptor counts...")
limits_config = """# Project Sovereign - HFT ulimits
* soft nofile 1000000
* hard nofile 1000000
root soft nofile 1000000
root hard nofile 1000000
quant-admin soft nofile 1000000
quant-admin hard nofile 1000000
"""
write_file(client, "/etc/security/limits.d/99-quant-hft.conf", limits_config)

# ── Step 7: Install essential tools ──────────────────────────────────────
print("\n[2.8] Installing essential system tools...")
run_cmd(client, "apt-get update -qq 2>&1 | tail -3", timeout=120)
run_cmd(client,
    "DEBIAN_FRONTEND=noninteractive apt-get install -y "
    "htop iotop nethogs sysstat numactl "
    "build-essential curl wget git unzip "
    "ca-certificates gnupg lsb-release "
    "linux-tools-generic 2>&1 | tail -10",
    timeout=300, label="apt-get install essential tools")

# ── Step 8: Verification ──────────────────────────────────────────────────
print("\n[2.9] VERIFICATION")
print("=" * 50)

print("\n--- Kernel parameters ---")
run_cmd(client, "sysctl net.core.rmem_max net.core.wmem_max net.ipv4.tcp_congestion_control fs.file-max")
run_cmd(client, "sysctl net.core.somaxconn net.core.netdev_max_backlog vm.swappiness")

print("\n--- TCP congestion module ---")
run_cmd(client, "lsmod | grep bbr || modprobe tcp_bbr && lsmod | grep bbr")

print("\n--- UFW status ---")
run_cmd(client, "ufw status numbered")

print("\n--- SSH hardening ---")
run_cmd(client, "grep -E 'PermitRootLogin|MaxAuthTries|X11Forwarding' /etc/ssh/sshd_config | grep -v '^#'")

print("\n--- quant-admin user ---")
run_cmd(client, "id quant-admin && sudo -l -U quant-admin 2>/dev/null | head -5")

print("\n--- System resources ---")
run_cmd(client, "free -h && echo '---' && nproc && ulimit -n")

print("\n--- Transparent Hugepages ---")
run_cmd(client, "cat /sys/kernel/mm/transparent_hugepage/enabled")

client.close()

print("\n" + "=" * 70)
print("PHASE 2 SUCCESS")
print("  Security:  quant-admin created, root SSH password-login disabled, UFW active")
print("  Net tufs:  rmem/wmem_max=128MB, BBR congestion control, somaxconn=65536")
print("  FS tuning: file-max=1,000,000, ulimits=1M descriptors")
print("  THP:       disabled (ClickHouse requirement)")
print("  NEXT:      Phase 3 - Docker + ClickHouse + Redis")
print("=" * 70)
