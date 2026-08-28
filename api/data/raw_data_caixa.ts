/**
 * GET /api/data/raw_data_caixa
 *
 * Retorna o array RAW_DATA_CAIXA no mesmo formato que o dashboard sempre usou.
 * Lê da view v_raw_data_caixa (aplica automaticamente: filtro cancelados,
 * valor negativo para despesa, etc).
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRawDataCaixa } from '../../lib/supabase/repos';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const linhas = await getRawDataCaixa();
    // Sem cache: sempre buscar dados frescos (mudanças na view SQL devem refletir de imediato)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json(linhas);
  } catch (e: any) {
    console.error('[raw_data_caixa] erro:', e);
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
