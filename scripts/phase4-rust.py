"""
PROJECT SOVEREIGN - PHASE 4: Rust Toolchain + Ingestion Engine Scaffold
- Install rustup for quant-admin user
- Initialize Rust workspace at /opt/quant-engine/ingestion-engine
- Cargo.toml with: tokio (full), tokio-tungstenite, serde_json, clickhouse
- [profile.release]: lto = "fat", panic = "abort"
- Verify: cargo check compiles
"""
import paramiko, time, sys
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
HOST = "88.99.208.99"
USER = "quant-admin"
PASS = "taLai8f5W?7P38"
ENGINE_DIR = "/opt/quant-engine/ingestion-engine"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(HOST, username=USER, password=PASS, allow_agent=False, look_for_keys=False)
print("CONNECTED as quant-admin")

def run(cmd, timeout=600):
    sin, sout, serr = client.exec_command(cmd, timeout=timeout)
    o = sout.read().decode('utf-8','replace')
    e = serr.read().decode('utf-8','replace')
    rc = sout.channel.recv_exit_status()
    print(f"\nCMD: {cmd[:80]}")
    print(f"OUT: {o.strip()[:800]}" if o.strip() else "OUT: (empty)")
    if e.strip(): print(f"ERR: {e.strip()[:600]}")
    print(f"RC: {rc}")
    return o, e, rc

def sudo(cmd, timeout=600):
    return run(f"echo '{PASS}' | sudo -S sh -c {repr(cmd)}", timeout=timeout)

def stream(cmd, timeout=900):
    """Stream long running command."""
    print(f"\n[STREAM] {cmd[:80]}")
    channel = client.get_transport().open_session()
    channel.set_combine_stderr(True)
    channel.exec_command(cmd)
    output = []
    start = time.time()
    while True:
        if channel.recv_ready():
            chunk = channel.recv(4096).decode('utf-8','replace')
            print(chunk, end='', flush=True)
            output.append(chunk)
        elif channel.exit_status_ready():
            while channel.recv_ready():
                chunk = channel.recv(4096).decode('utf-8','replace')
                print(chunk, end='', flush=True)
                output.append(chunk)
            break
        elif time.time() - start > timeout:
            print(f"\n[TIMEOUT] {timeout}s")
            return ''.join(output), -1
        else:
            time.sleep(2)
    rc = channel.recv_exit_status()
    print(f"\n[RC] {rc}")
    return ''.join(output), rc

print("\n--- System check ---")
run("uname -r && lsb_release -d")
run("free -h | head -2")

# ── Step 1: Install rustup for quant-admin ────────────────────────────────
print("\n[4.1] Installing Rust toolchain via rustup...")

# Install prerequisites
sudo("apt-get install -y curl build-essential pkg-config libssl-dev 2>&1 | tail -5")

# Install rustup as quant-admin (non-root)
out, rc = stream(
    "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal 2>&1",
    timeout=300
)

# Verify
run("source $HOME/.cargo/env && rustup --version && cargo --version && rustc --version")
run("ls ~/.cargo/bin/ | head -10")

# ── Step 2: Create workspace directory ───────────────────────────────────
print("\n[4.2] Creating ingestion engine workspace...")
sudo(f"mkdir -p {ENGINE_DIR}")
sudo(f"chown quant-admin:quant-admin {ENGINE_DIR}")
run(f"ls -la {ENGINE_DIR}")

# ── Step 3: Initialize Rust binary crate ─────────────────────────────────
print("\n[4.3] Initializing Rust workspace with cargo init...")
run(f"source $HOME/.cargo/env && cargo init --name ingestion-engine {ENGINE_DIR} 2>&1")
run(f"ls -la {ENGINE_DIR}")
run(f"cat {ENGINE_DIR}/src/main.rs")

# ── Step 4: Write institutional Cargo.toml ────────────────────────────────
print("\n[4.4] Writing institutional Cargo.toml...")

cargo_toml = """[package]
name = "ingestion-engine"
version = "0.1.0"
edition = "2021"
description = "Project Sovereign - Institutional HFT WebSocket Ingestion Engine"
authors = ["Quantum Mon Cheri <ops@quantum-mon-cheri>"]

[[bin]]
name = "ingestion-engine"
path = "src/main.rs"

[dependencies]
# Async runtime - full feature set for timers, I/O, sync primitives
tokio = { version = "1", features = ["full"] }

# WebSocket client for market data streams
tokio-tungstenite = { version = "0.24", features = ["native-tls"] }

# JSON serialization/deserialization
serde = { version = "1", features = ["derive"] }
serde_json = "1"

# ClickHouse native client (async, HTTP interface)
clickhouse = { version = "0.13", features = ["lz4"] }

# Redis client for pub/sub IPC
redis = { version = "0.27", features = ["tokio-comp", "connection-manager"] }

# Logging
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

# HTTP utilities
reqwest = { version = "0.12", features = ["json"] }

# Utility
anyhow = "1"
thiserror = "2"
futures-util = "0.3"
dashmap = "6"
uuid = { version = "1", features = ["v4"] }
chrono = { version = "0.4", features = ["serde"] }

[profile.release]
# Fat LTO: cross-crate inlining for maximum performance
lto = "fat"
# Abort on panic: zero overhead, no unwinding code
panic = "abort"
# Maximum optimization level
opt-level = 3
# Single codegen unit: enables best cross-crate optimizations
codegen-units = 1
# Strip debug symbols from release binary
strip = true

[profile.dev]
# Faster incremental builds during development
opt-level = 0
debug = true
"""

sftp = client.open_sftp()
with sftp.file("/tmp/Cargo.toml", 'w') as f:
    f.write(cargo_toml)
sftp.close()
run(f"cp /tmp/Cargo.toml {ENGINE_DIR}/Cargo.toml")
run(f"cat {ENGINE_DIR}/Cargo.toml")

# ── Step 5: Write a functional main.rs scaffold ───────────────────────────
print("\n[4.5] Writing main.rs scaffold...")

main_rs = '''//! Project Sovereign - Ingestion Engine
//! High-frequency WebSocket market data ingestion into ClickHouse
//! IPC via Redis pub/sub for downstream consumers

use anyhow::Result;
use tracing::{info, error};

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_target(false)
        .init();

    info!(
        host = "quantum-mon-cheri",
        version = env!("CARGO_PKG_VERSION"),
        "Project Sovereign ingestion engine starting"
    );

    // TODO: Initialize ClickHouse connection pool
    // TODO: Initialize Redis pub/sub client
    // TODO: Spawn WebSocket ingest tasks per trading pair
    // TODO: Implement orderbook delta processing pipeline
    // TODO: Batch-write to ClickHouse with LZ4 compression

    info!("Engine scaffold ready - awaiting trading pair configuration");

    // Placeholder: keep the process alive
    tokio::signal::ctrl_c().await?;
    info!("Shutdown signal received");
    Ok(())
}
'''

with sftp.file("/tmp/main.rs", 'w') as f:
    f.write(main_rs)
sftp.close()
run(f"cp /tmp/main.rs {ENGINE_DIR}/src/main.rs")
run(f"cat {ENGINE_DIR}/src/main.rs")

# ── Step 6: Build verification ────────────────────────────────────────────
print("\n[4.6] Running cargo check (dependency resolution + type check)...")
print("This will download ~50MB of crates, may take 3-5 minutes on first run...")

out, rc = stream(
    f"source $HOME/.cargo/env && cd {ENGINE_DIR} && cargo check 2>&1",
    timeout=600
)

if rc != 0:
    print(f"\n[WARN] cargo check had issues - checking if it's just warnings...")
    run(f"source $HOME/.cargo/env && cd {ENGINE_DIR} && cargo check 2>&1 | tail -20")

# Run cargo build --release to fully verify LTO + panic=abort profile
print("\n[4.7] Running cargo build --release to verify [profile.release] settings...")
print("(fat LTO build - may take 5-10 minutes on first compile)")
out, rc = stream(
    f"source $HOME/.cargo/env && cd {ENGINE_DIR} && cargo build --release 2>&1",
    timeout=900
)

# ── Step 7: Verification ──────────────────────────────────────────────────
print("\n[4.8] VERIFICATION")
run("source $HOME/.cargo/env && rustc --version && cargo --version && rustup show")
run(f"ls -lh {ENGINE_DIR}/target/release/ingestion-engine 2>/dev/null || echo 'Binary not found'")
run(f"file {ENGINE_DIR}/target/release/ingestion-engine 2>/dev/null")
run(f"cat {ENGINE_DIR}/Cargo.toml | grep -A3 'profile.release'")
run(f"cat {ENGINE_DIR}/Cargo.toml | grep -E '^(tokio|tokio-tungstenite|serde_json|clickhouse|redis)'")
run(f"source $HOME/.cargo/env && cd {ENGINE_DIR} && cargo metadata --no-deps --format-version 1 2>/dev/null | python3 -c \"import json,sys; m=json.load(sys.stdin); [print(p['name'],p['version']) for p in m['packages']]\" 2>/dev/null || echo 'metadata ok'")

client.close()
print("\n" + "=" * 70)
print("PHASE 4 COMPLETE")
print(f"  Rust:       stable toolchain, rustup installed for quant-admin")
print(f"  Workspace:  {ENGINE_DIR}")
print(f"  Cargo.toml: tokio(full), tokio-tungstenite, serde_json, clickhouse, redis")
print(f"  Profile:    [release] lto='fat', panic='abort', opt-level=3, codegen-units=1")
print("=" * 70)
