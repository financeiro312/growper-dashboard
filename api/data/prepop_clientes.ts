/**
 * GET /api/data/prepop_clientes
 *
 * Retorna PREPOP_CLIENTES no mesmo formato que o dashboard sempre usou:
 * clientes com mensalidades (categoria 01.01) agrupados por cliente e mês.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getPrepopClientes } from '../../lib/supabase/repos';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const linhas = await getPrepopClientes();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(linhas);
  } catch (e: any) {
    console.error('[prepop_clientes] erro:', e);
    return res.status(500).json({ error: String(e?.message ?? e) });
  }
}
