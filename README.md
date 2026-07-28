# Growper Dashboard — Vercel + Supabase

Dashboard financeiro com sincronização automática Omie → Supabase → Vercel.

## Arquitetura

```
Omie API
  ↓ (Cron externo → API Route protegida)
Vercel API Routes
  ↓ (Transformação com regras do dashboard)
Supabase (Postgres)
  ↓
Dashboard (HTML estático) — consulta via /api/data/*
```

## Setup (uma vez)

### 1. Supabase
- Cria projeto em https://supabase.com (plano free)
- Executa `sql/schema.sql` no SQL Editor
- Anota URL e Service Role Key

### 2. Vercel
- Fork/import este repo em https://vercel.com
- Configura variáveis de ambiente:
  - `OMIE_APP_KEY`
  - `OMIE_APP_SECRET`
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SYNC_SECRET` (qualquer string aleatória; usada pelo Cron)
- Deploy

### 3. Agendador externo
Como Vercel Hobby limita Cron a 2x/dia, usar cron-job.org ou GitHub Actions:

- **URL:** `https://SEU-PROJETO.vercel.app/api/sync/incremental?token=SYNC_SECRET`
- **Frequência recomendada:**
  - `/api/sync/incremental` a cada 10 min (títulos + cadastros)
  - `/api/sync/full` 2x/dia (movimentos completos)

## Endpoints

| Endpoint | Descrição |
|---|---|
| `GET /` | Dashboard |
| `GET /api/data/raw_data_caixa` | Movimentos (visão caixa) |
| `GET /api/data/raw_data_comp` | Títulos (visão competência) |
| `GET /api/data/prepop_clientes` | Clientes menu Recebíveis |
| `GET /api/data/status` | Status da última sync |
| `POST /api/sync/incremental?token=…` | Sync incremental |
| `POST /api/sync/full?token=…` | Sync completa |
