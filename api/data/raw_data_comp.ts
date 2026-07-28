/**
 * GET /api/data/raw_data_comp
 *
 * Retorna o array RAW_DATA_COMP no mesmo formato que o dashboard sempre usou.
 * Lê da view v_raw_data_comp.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRawDataComp } from '../../lib/supabase/repos';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const linhas = await getRawDataComp();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(linhas);
  } catch (e: any) {
    console.error('[raw_data_comp] erro:', e);
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
