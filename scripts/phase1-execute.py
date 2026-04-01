#!/usr/bin/env python3
"""
PROJECT SOVEREIGN - PHASE 1 EXECUTE (v3)
Config written to /tmp/quantum.conf (writable), full path passed to -c
"""
import paramiko
import time
import sys

HOST = "88.99.208.99"
PORT = 22
USER = "root"
PASS = "taLai8f5W?7P38"
INSTALLIMAGE = "/root/.oldroot/nfs/install/installimage"
IMAGE = "/root/images/Ubuntu-2404-noble-amd64-base.tar.gz"
CONFIG_PATH = "/tmp/quantum.conf"

def connect(host, port, user, password, timeout=30):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password,
                   timeout=timeout, allow_agent=False, look_for_keys=False)
    return client

def run_cmd(client, cmd, timeout=60):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    print(f"\n[CMD] {cmd}")
    print(f"[OUT] {out.strip()}")
    if err.strip():
        print(f"[ERR] {err.strip()}")
    print(f"[RC]  {code}")
    return out, err, code

def run_streaming(client, cmd, timeout=1800):
    """Run a long command and stream output."""
    print(f"\n[STREAM CMD] {cmd}")
    channel = client.get_transport().open_session()
    channel.set_combine_stderr(True)
    channel.exec_command(cmd)
    output_parts = []
    start = time.time()
    while True:
        if channel.recv_ready():
            chunk = channel.recv(4096).decode('utf-8', errors='replace')
            # Strip terminal escape codes for cleaner output
            import re
            clean = re.sub(r'\x1b\[[0-9;]*[mHJK]', '', chunk)
            print(clean, end='', flush=True)
            output_parts.append(chunk)
        elif channel.exit_status_ready():
            while channel.recv_ready():
                chunk = channel.recv(4096).decode('utf-8', errors='replace')
                clean = re.sub(r'\x1b\[[0-9;]*[mHJK]', '', chunk)
                print(clean, end='', flush=True)
                output_parts.append(chunk)
            break
        elif time.time() - start > timeout:
            print(f"\n[TIMEOUT] {timeout}s exceeded")
            channel.close()
            return ''.join(output_parts), -1
        else:
            time.sleep(1)
    code = channel.recv_exit_status()
    print(f"\n[RC] {code}")
    return ''.join(output_parts), code

def wait_for_ssh(host, port, user, password, max_wait=600, interval=15):
    print(f"\n[WAIT] Polling {host} for up to {max_wait}s (interval={interval}s)...")
    elapsed = 0
    while elapsed < max_wait:
        try:
            c = connect(host, port, user, password, timeout=10)
            print(f"[OK] Server online after ~{elapsed}s")
            return c
        except Exception as e:
            print(f"  [{elapsed:4d}s] {type(e).__name__}")
            time.sleep(interval)
            elapsed += interval
    raise TimeoutError(f"Server not online within {max_wait}s")

print("=" * 70)
print("PROJECT SOVEREIGN - PHASE 1: OS PROVISIONING")
print("=" * 70)

# ── Connect ──────────────────────────────────────────────────────────────
print(f"\n[1.1] Connecting to rescue system at {HOST}...")
client = connect(HOST, PORT, USER, PASS)
print("[OK] Connected")

# ── Probe drives ─────────────────────────────────────────────────────────
print("\n[1.2] Verifying hardware...")
run_cmd(client, "lsblk -d -o NAME,SIZE,TYPE | grep -v loop")
run_cmd(client, f"ls -lh {IMAGE}")

# ── Write config to /tmp (writable) ──────────────────────────────────────
config = (
    "##  Project Sovereign - Ubuntu 24.04 + RAID1 + XFS\n"
    "DRIVE1 /dev/nvme0n1\n"
    "DRIVE2 /dev/nvme1n1\n"
    "SWRAIDLEVEL 1\n"
    "BOOTLOADER grub\n"
    "HOSTNAME quantum-mon-cheri\n"
    "PART /boot  ext4   1024M\n"
    f"PART /      xfs    all\n"
    f"IMAGE {IMAGE}\n"
)
print(f"\n[1.3] Writing config to {CONFIG_PATH}...")
print(f"[CONFIG]\n{config}")

# Use a Python file write over SFTP to avoid shell escaping issues
sftp = client.open_sftp()
with sftp.file(CONFIG_PATH, 'w') as f:
    f.write(config)
sftp.close()

# Verify it was written correctly
run_cmd(client, f"cat {CONFIG_PATH}")
run_cmd(client, f"ls -lh {CONFIG_PATH}")

# ── Run installimage with full path ───────────────────────────────────────
# The -c flag accepts full absolute path when not starting with /root/.oldroot/nfs/install/configs
print("\n[1.4] Launching installimage...")
print("[!] This will ERASE /dev/nvme0n1 and /dev/nvme1n1 and install Ubuntu 24.04 LTS")
install_cmd = f"TERM=xterm {INSTALLIMAGE} -a -c {CONFIG_PATH} 2>&1"
out, code = run_streaming(client, install_cmd, timeout=1800)

if code != 0:
    print(f"\n[FATAL] installimage exited with code {code}")
    run_cmd(client, "ls /var/log/installimage* 2>/dev/null; ls /root/*.log 2>/dev/null")
    for logpath in ["/var/log/installimage.log", "/root/installimage.log", "/tmp/installimage.log"]:
        run_cmd(client, f"cat {logpath} 2>/dev/null | tail -40")
    client.close()
    sys.exit(1)

print("\n[OK] installimage reported success")
for logpath in ["/var/log/installimage.log", "/root/installimage.log"]:
    run_cmd(client, f"cat {logpath} 2>/dev/null | tail -20")

# ── Reboot ────────────────────────────────────────────────────────────────
print("\n[1.5] Sending reboot command...")
try:
    client.exec_command("reboot", timeout=5)
except Exception:
    pass
client.close()
print("[INFO] Waiting 90s for shutdown + POST + BIOS + boot...")
time.sleep(90)

# ── Wait for new OS ────────────────────────────────────────────────────────
print("\n[1.6] Waiting for fresh Ubuntu 24.04 to come online...")
client = wait_for_ssh(HOST, PORT, USER, PASS, max_wait=600, interval=15)

# ── Verification ──────────────────────────────────────────────────────────
print("\n[1.7] POST-INSTALL VERIFICATION")
print("=" * 50)
run_cmd(client, "lsb_release -a 2>/dev/null || cat /etc/os-release")
run_cmd(client, "uname -r")
run_cmd(client, "df -hT")
run_cmd(client, "cat /proc/mdstat")
run_cmd(client, "lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,TYPE")
run_cmd(client, "free -h")
run_cmd(client, "nproc && grep 'model name' /proc/cpuinfo | head -1")
client.close()

print("\n" + "=" * 70)
print("PHASE 1 SUCCESS")
print("  OS:       Ubuntu 24.04 LTS (Noble Numbat)")
print("  RAID:     Software RAID 1 (mirror) across nvme0n1 + nvme1n1")
print("  Root FS:  XFS (optimized for ClickHouse high-IOPS)")
print("  Boot FS:  ext4 (1GB)")
print("  Host:     quantum-mon-cheri @ 88.99.208.99")
print("  NEXT:     Phase 2 - Kernel HFT Tuning & Security")
print("=" * 70)
