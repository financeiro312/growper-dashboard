/**
 * GET /api/data/status
 *
 * Retorna informações da última sincronização + histórico recente de logs.
 * Usado pelo dashboard para mostrar quando os dados foram atualizados.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getMetadata, getUltimosLogs } from '../../lib/supabase/repos';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const [ultimaSync, ultimaSyncFull, ultimaSyncCadastros, logs] = await Promise.all([
      getMetadata('ultima_sync'),
      getMetadata('ultima_sync_full'),
      getMetadata('ultima_sync_cadastros'),
      getUltimosLogs(20),
    ]);

    return res.status(200).json({
      ultima_sync: ultimaSync,
      ultima_sync_full: ultimaSyncFull,
      ultima_sync_cadastros: ultimaSyncCadastros,
      logs: logs.map((l: any) => ({
        id: l.id,
        tipo: l.tipo,
        endpoint: l.endpoint,
        iniciado_em: l.iniciado_em,
        finalizado_em: l.finalizado_em,
        duracao_s: l.duracao_s,
        registros: l.registros,
        status: l.status,
        erro: l.erro,
      })),
    });
  } catch (e: any) {
    console.error('[status] erro:', e);
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
