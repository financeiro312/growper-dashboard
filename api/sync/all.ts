/**
 * SYNC ALL — Endpoint único de sincronização completa.
 *
 * Uso: chamar via cron externo (ex: cron-job.org) 3x por dia:
 *   GET /api/sync/all?token=SYNC_SECRET
 *
 * Executa em sequência: cadastros → contas a pagar → contas a receber
 *   → movimentos (múltiplas páginas encadeadas)
 *
 * Retorna JSON com status de cada etapa. Se alguma etapa estourar tempo,
 * retorna o que conseguiu e a próxima execução do cron pega o resto.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  syncCadastrosOnly,
  syncTitulosPagarOnly,
  syncTitulosReceberOnly,
  syncMovimentosOnly,
} from '../../lib/sync/pipeline-parts';

export const config = { maxDuration: 60 };

// Tempo máximo por etapa — se ultrapassar, ainda tentamos próximo passo
// mas com margem
const LIMITE_MS_POR_ETAPA = 45_000;

async function tryStep<T>(nome: string, fn: () => Promise<T>): Promise<{ etapa: string; ok: boolean; resultado?: T; erro?: string; duracaoMs: number }> {
  const t0 = Date.now();
  try {
    const r = await fn();
    return { etapa: nome, ok: true, resultado: r, duracaoMs: Date.now() - t0 };
  } catch (e: any) {
    return { etapa: nome, ok: false, erro: String(e?.message ?? e).slice(0, 300), duracaoMs: Date.now() - t0 };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token || req.headers['x-sync-token'] || '');
  if (token !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  const t0 = Date.now();
  const relatorio: any[] = [];

  // Ordem: cadastros primeiro (leves), depois títulos, depois movimentos (mais pesado)
  // Cada etapa reporta sucesso/falha mas continua pra próxima

  // 1. Cadastros
  if (Date.now() - t0 < LIMITE_MS_POR_ETAPA) {
    relatorio.push(await tryStep('cadastros', syncCadastrosOnly));
  } else {
    relatorio.push({ etapa: 'cadastros', ok: false, erro: 'pulado por timeout', duracaoMs: 0 });
  }

  // 2. Contas a Pagar
  if (Date.now() - t0 < LIMITE_MS_POR_ETAPA * 1.5) {
    relatorio.push(await tryStep('titulos-pagar', syncTitulosPagarOnly));
  } else {
    relatorio.push({ etapa: 'titulos-pagar', ok: false, erro: 'pulado por timeout', duracaoMs: 0 });
  }

  // 3. Contas a Receber
  if (Date.now() - t0 < LIMITE_MS_POR_ETAPA * 2) {
    relatorio.push(await tryStep('titulos-receber', syncTitulosReceberOnly));
  } else {
    relatorio.push({ etapa: 'titulos-receber', ok: false, erro: 'pulado por timeout', duracaoMs: 0 });
  }

  // 4. Movimentos — só se ainda temos tempo
  // Nota: movimentos pode ser grande. Rodamos o que der no tempo restante.
  const tempoRestante = 55_000 - (Date.now() - t0);
  if (tempoRestante > 5_000) {
    relatorio.push(await tryStep('movimentos', syncMovimentosOnly));
  } else {
    relatorio.push({ etapa: 'movimentos', ok: false, erro: 'sem tempo restante — próximo cron pega', duracaoMs: 0 });
  }

  const totalMs = Date.now() - t0;
  const okCount = relatorio.filter(r => r.ok).length;

  return res.status(okCount > 0 ? 200 : 500).json({
    ok: okCount > 0,
    sucesso: okCount,
    total: relatorio.length,
    duracaoTotalMs: totalMs,
    duracaoTotalS: (totalMs / 1000).toFixed(1),
    timestamp: new Date().toISOString(),
    etapas: relatorio,
  });
}
