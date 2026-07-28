import type { VercelRequest, VercelResponse } from '@vercel/node';
import { syncCadastrosOnly } from '../../lib/sync/pipeline-parts';

export const config = { maxDuration: 60 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token || req.headers['x-sync-token'] || '');
  if (token !== process.env.SYNC_SECRET) return res.status(401).json({ error: 'Token inválido' });
  try {
    const r = await syncCadastrosOnly();
    return res.status(200).json({ ok: true, ...r });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: String(e?.message ?? e).slice(0, 500) });
  }
}
