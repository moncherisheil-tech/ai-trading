# Signal Core (Python sidecar)

FastAPI service computing **CVD** (cumulative volume delta from agg trades), **Shannon entropy** on log returns / volumes, and a **1D Kalman** smooth on log closes.

## Run locally

```bash
cd services/signal-core
python -m venv .venv
.venv\Scripts\activate   # Windows
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8765
```

Health: `GET http://127.0.0.1:8765/health`  
Analyze: `POST http://127.0.0.1:8765/v1/microstructure` with JSON body (see `app/schemas.py`).

## Environment (Next.js)

Set `SIGNAL_CORE_URL=http://127.0.0.1:8765` and optionally `SIGNAL_CORE_ENABLED=1` in the app `.env`.

## systemd (VPS example)

`/etc/systemd/system/signal-core.service`:

```ini
[Unit]
Description=Quantum Signal Core (FastAPI)
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/app/services/signal-core
Environment=PATH=/opt/app/services/signal-core/.venv/bin
ExecStart=/opt/app/services/signal-core/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8765
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Bind to `127.0.0.1` only; let Next.js reach it via localhost.

## Tests

```bash
cd services/signal-core
pytest tests/ -q
```
