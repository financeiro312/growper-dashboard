import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OmieClient } from '../../lib/omie/client';

export const config = { maxDuration: 60 };

/**
 * Debug endpoint: retorna o JSON bruto de UMA página do ListarMovimentos da Omie,
 * já filtrada pra mostrar apenas movimentos com data de pagamento em agosto/2026.
 * Serve pra descobrir o nome real dos campos de valor.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token || '');
  if (token !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const pagina = Number(req.query.pagina || 55);

  try {
    const cli = new OmieClient(
      process.env.OMIE_APP_KEY!,
      process.env.OMIE_APP_SECRET!
    );

    const body = {
      call: 'ListarMovimentos',
      app_key: process.env.OMIE_APP_KEY,
      app_secret: process.env.OMIE_APP_SECRET,
      param: [
        {
          nPagina: pagina,
          nRegPorPagina: 500,
        },
      ],
    };

    const resp = await fetch('https://app.omie.com.br/api/v1/financas/mf/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json: any = await resp.json();

    const todos = json?.movimentos || [];
    const total = todos.length;

    // Filtrar só os que têm data_pagto em agosto/2026
    const agosto = todos.filter((m: any) => {
      const d = m?.detalhes?.dDtPagamento || '';
      return d.includes('/08/2026');
    });

    // Se agosto vazio, pegar 3 amostras quaisquer com valor > 0 pra ver os campos
    const amostras = agosto.length > 0
      ? agosto.slice(0, 5)
      : todos.slice(0, 3);

    return res.status(200).json({
      pagina,
      totalNaPagina: total,
      qtdAgosto: agosto.length,
      amostras,
    });
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message ?? e).slice(0, 500) });
  }
}
