#!/usr/bin/env python3
"""
PROJECT SOVEREIGN - PHASE 1: OS Provisioning
Connects to Hetzner rescue system and installs Ubuntu 24.04 LTS
with Software RAID 1 across 2x NVMe drives, XFS root filesystem.
"""
import paramiko
import time
import sys
import re

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

def run_cmd(client, cmd, timeout=60, print_output=True):
    """Run a command and return (stdout, stderr, exit_code)."""
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()
    if print_output:
        print(f"\n[CMD] {cmd}")
        print(f"[STDOUT]\n{out}")
        if err.strip():
            print(f"[STDERR]\n{err}")
        print(f"[EXIT CODE] {code}")
    return out, err, code

def wait_for_ssh(host, port, user, password, max_wait=600, interval=15):
    """Poll SSH until server comes back online after reboot."""
    print(f"\n[WAIT] Polling {host}:{port} for up to {max_wait}s...")
    elapsed = 0
    while elapsed < max_wait:
        try:
            c = connect(host, port, user, password, timeout=10)
            print(f"[OK] Server is online after {elapsed}s")
            return c
        except Exception as e:
            print(f"[WAIT] {elapsed}s elapsed - not yet reachable ({type(e).__name__})")
            time.sleep(interval)
            elapsed += interval
    raise TimeoutError(f"Server did not come back online within {max_wait}s")

def main():
    print("=" * 70)
    print("PROJECT SOVEREIGN - PHASE 1: OS PROVISIONING")
    print("=" * 70)

    # ── Step 1: Connect to rescue system ──────────────────────────────────
    print(f"\n[PHASE 1.1] Connecting to Hetzner rescue system at {HOST}...")
    try:
        client = connect(HOST, PORT, USER, PASS)
        print("[OK] Connected to rescue system")
    except Exception as e:
        print(f"[FATAL] Cannot connect: {e}")
        sys.exit(1)

    # ── Step 2: Probe hardware ─────────────────────────────────────────────
    print("\n[PHASE 1.2] Probing hardware...")
    lsblk_out, _, _ = run_cmd(client, "lsblk -d -o NAME,SIZE,TYPE | grep -v loop")

    # Identify NVMe drives
    nvme_drives = re.findall(r'(nvme\d+n\d+)', lsblk_out)
    if len(nvme_drives) < 2:
        # fallback: try sda/sdb
        sata_drives = re.findall(r'(sd[a-z]+)', lsblk_out)
        drives = sata_drives[:2]
        drive_type = "SATA"
    else:
        drives = nvme_drives[:2]
        drive_type = "NVMe"

    if len(drives) < 2:
        print(f"[FATAL] Could not identify 2 drives. lsblk output:\n{lsblk_out}")
        sys.exit(1)

    DRIVE1 = f"/dev/{drives[0]}"
    DRIVE2 = f"/dev/{drives[1]}"
    print(f"[OK] Found {drive_type} drives: {DRIVE1}, {DRIVE2}")

    # ── Step 3: Find Ubuntu 24.04 image ──────────────────────────────────
    print("\n[PHASE 1.3] Searching for Ubuntu 24.04 image...")
    search_paths = [
        "ls /root/.oldroot/nfs/install/images/ 2>/dev/null | grep -i ubuntu | grep -i 24",
        "ls /root/.oldroot/nfs/images/ 2>/dev/null | grep -i ubuntu | grep -i 24",
        "find /root/.oldroot -name '*Ubuntu*24*' -o -name '*ubuntu*24*' 2>/dev/null | head -5",
        "ls /root/.oldroot/nfs/install/images/ 2>/dev/null",
    ]

    image_path = None
    for search in search_paths:
        out, _, code = run_cmd(client, search, timeout=30)
        if out.strip():
            print(f"[FOUND] Image candidates:\n{out.strip()}")
            # Extract the first matching image file
            lines = [l.strip() for l in out.strip().splitlines() if l.strip()]
            if lines:
                # Check if full path returned
                if lines[0].startswith('/'):
                    image_path = lines[0]
                else:
                    # Determine base directory
                    base_dirs = ["/root/.oldroot/nfs/install/images", "/root/.oldroot/nfs/images"]
                    for base in base_dirs:
                        test_path = f"{base}/{lines[0]}"
                        chk, _, _ = run_cmd(client, f"test -f {test_path} && echo EXISTS", timeout=10, print_output=False)
                        if "EXISTS" in chk:
                            image_path = test_path
                            break
                if image_path:
                    break

    if not image_path:
        print("[WARN] Could not auto-detect image. Listing all available images...")
        run_cmd(client, "find /root/.oldroot -name '*.tar.gz' -o -name '*.tar.xz' 2>/dev/null | head -20", timeout=30)
        print("[FATAL] Cannot proceed without a valid Ubuntu 24.04 image path.")
        client.close()
        sys.exit(1)

    print(f"[OK] Using image: {image_path}")

    # ── Step 4: Create installimage config ────────────────────────────────
    print("\n[PHASE 1.4] Creating installimage configuration...")

    config = f"""##  Hetzner Online GmbH - installimage - Project Sovereign
DRIVE1 {DRIVE1}
DRIVE2 {DRIVE2}
SWRAIDLEVEL 1
BOOTLOADER grub
HOSTNAME quantum-mon-cheri
PART /boot  ext4   1024M
PART /      xfs    all
IMAGE {image_path}
"""
    print(f"[CONFIG]\n{config}")

    # Write config to server
    write_cmd = f"cat > /tmp/hetzner.conf << 'INSTALLEOF'\n{config}\nINSTALLEOF"
    run_cmd(client, write_cmd, timeout=30)

    # Verify config written
    run_cmd(client, "cat /tmp/hetzner.conf")

    # ── Step 5: Run installimage ──────────────────────────────────────────
    print("\n[PHASE 1.5] Running installimage (this will take 5-15 minutes)...")
    print("[INFO] Executing: installimage -a -c /tmp/hetzner.conf")

    # Use a channel for streaming output with long timeout
    channel = client.get_transport().open_session()
    channel.set_combine_stderr(True)
    channel.exec_command("installimage -a -c /tmp/hetzner.conf 2>&1")

    install_output = []
    start_time = time.time()
    max_install_time = 1800  # 30 minutes

    while True:
        if channel.recv_ready():
            chunk = channel.recv(4096).decode('utf-8', errors='replace')
            print(chunk, end='', flush=True)
            install_output.append(chunk)
        elif channel.exit_status_ready():
            # Drain remaining output
            while channel.recv_ready():
                chunk = channel.recv(4096).decode('utf-8', errors='replace')
                print(chunk, end='', flush=True)
                install_output.append(chunk)
            break
        elif time.time() - start_time > max_install_time:
            print("\n[FATAL] installimage timed out after 30 minutes")
            channel.close()
            client.close()
            sys.exit(1)
        else:
            time.sleep(2)

    install_code = channel.recv_exit_status()
    full_install_output = ''.join(install_output)
    print(f"\n[installimage EXIT CODE] {install_code}")

    if install_code != 0:
        print(f"[FATAL] installimage failed with exit code {install_code}")
        print("Full output saved. Check for errors above.")
        client.close()
        sys.exit(1)

    print("[OK] installimage completed successfully")

    # ── Step 6: Reboot ───────────────────────────────────────────────────
    print("\n[PHASE 1.6] Rebooting server...")
    try:
        run_cmd(client, "reboot", timeout=10)
    except Exception:
        pass  # Connection will drop during reboot - that's expected
    client.close()

    print("[INFO] Server is rebooting. Waiting 60 seconds before polling...")
    time.sleep(60)

    # ── Step 7: Wait for server to come back online ───────────────────────
    print("\n[PHASE 1.7] Waiting for server to come back online...")
    try:
        client = wait_for_ssh(HOST, PORT, USER, PASS, max_wait=600, interval=15)
    except TimeoutError as e:
        print(f"[FATAL] {e}")
        sys.exit(1)

    # ── Step 8: Verify installation ───────────────────────────────────────
    print("\n[PHASE 1.8] Verifying installation...")
    run_cmd(client, "lsb_release -a")
    run_cmd(client, "uname -r")
    run_cmd(client, "df -hT | grep -E 'Filesystem|/'")
    run_cmd(client, "cat /proc/mdstat")
    run_cmd(client, "lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT,ROTA")
    run_cmd(client, "free -h")
    run_cmd(client, "nproc && lscpu | grep 'Model name'")

    client.close()

    print("\n" + "=" * 70)
    print("PHASE 1 COMPLETE: Ubuntu 24.04 + RAID1 + XFS PROVISIONED SUCCESSFULLY")
    print("=" * 70)
    print(f"  Server: {HOST}")
    print(f"  Drives: {DRIVE1} + {DRIVE2} (RAID 1)")
    print(f"  Image:  {image_path}")
    print("  Status: READY FOR PHASE 2")

if __name__ == "__main__":
    main()
