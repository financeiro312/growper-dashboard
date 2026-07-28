/**
 * POST /api/sync/incremental?token=SYNC_SECRET
 *
 * Executa sincronização incremental. Uso: a cada 10 min via agendador externo.
 *
 * - Cadastros: sincronizados no máximo 1x por dia (economia de chamadas)
 * - Movimentos: sempre baixados completos (API não suporta filtro por data)
 * - Títulos:   upsert por PK (só o que mudou é efetivamente escrito)
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { syncIncremental } from '../../lib/sync/pipeline';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'POST' && method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const tokenEnviado = String(req.query.token || req.headers['x-sync-token'] || '');
  const tokenEsperado = process.env.SYNC_SECRET;
  if (!tokenEsperado) {
    return res.status(500).json({ error: 'SYNC_SECRET não configurado' });
  }
  if (tokenEnviado !== tokenEsperado) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  try {
    const resultado = await syncIncremental();
    return res.status(200).json({ ok: true, ...resultado });
  } catch (e: any) {
    console.error('[sync/incremental] erro:', e);
    return res.status(500).json({
      ok: false,
      error: String(e?.message ?? e).slice(0, 500),
    });
  }
}
