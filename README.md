# pizzeria-print-agent

Bridge local Raspberry Pi pour l'impression thermique:
- heartbeat vers `pizzeria-backend`
- polling jobs `/api/print/agents/:agentCode/claim-next`
- impression ESC/POS TCP (port 9100)
- spool SQLite local (`pending_acks`, `local_jobs`)
- API locale:
  - `GET /health`
  - `POST /test-print`
  - `POST /reprint-last`

## Installation

```bash
npm install
cp .env.example .env
# editer .env
npm start
```

## Variables critiques

- `API_BASE_URL`
- `AGENT_CODE`
- `AGENT_NAME`
- `AGENT_TOKEN`
- Mono imprimante:
  - `PRINTER_CODE`
  - `PRINTER_IP`
  - `PRINTER_PORT`
- Multi imprimantes (optionnel):
  - `PRINTERS_JSON` (JSON array `[{code,ip,port}]`)
- `SQLITE_PATH`

## Endpoints locaux

Sans token local:
```bash
curl http://127.0.0.1:3000/health
```

Avec `LOCAL_ADMIN_TOKEN`:
```bash
curl -X POST http://127.0.0.1:3000/test-print \
  -H "x-local-token: TON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Bonjour test","printerCode":"kitchen_main"}'

curl -X POST http://127.0.0.1:3000/reprint-last \
  -H "x-local-token: TON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"printerCode":"kitchen_main"}'
```

## Service systemd (Pi)

```bash
sudo cp systemd/pizzeria-print-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable pizzeria-print-agent
sudo systemctl start pizzeria-print-agent
sudo systemctl status pizzeria-print-agent --no-pager
```
