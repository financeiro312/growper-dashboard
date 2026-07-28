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
    // Cache leve para evitar carga em F5 repetido
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(linhas);
  } catch (e: any) {
    console.error('[raw_data_caixa] erro:', e);
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
