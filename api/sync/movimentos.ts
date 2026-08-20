import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OmieClient } from '../../lib/omie/client';
import { ENDPOINTS } from '../../lib/omie/endpoints';
import { transformarMovimento, Enricher, type ContaCorrente, type Categoria, type Cliente, type Departamento } from '../../lib/transformers/lancamentos';
import { getSupabase } from '../../lib/supabase/client';
import { upsertMovimentos, logStart, logFinish, setMetadata } from '../../lib/supabase/repos';

export const config = { maxDuration: 60 };

// Quantas páginas processar por chamada. Cada página tem até 500 registros.
// Otimizado para caber em 60s da Vercel Hobby:
//   Enricher paralelo:       ~5s
//   Baixa 3 páginas do Omie: ~9s
//   Transformer + upsert:    ~10s
//   Total: ~24s (bem folgado)
const PAGINAS_POR_CHAMADA = 12;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não configurado`);
  return v;
}

/**
 * Carrega o Enricher em PARALELO das 4 tabelas de cadastro.
 * Ganho: ~15s → ~5s.
 */
async function carregarEnricher(): Promise<Enricher> {
  const sb = getSupabase();

  async function carregarTabela<T>(
    tabela: string,
    mapFn: (r: any) => T
  ): Promise<Array<{ codigo: string; item: T }>> {
    const linhas: any[] = [];
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await sb.from(tabela).select('*').range(offset, offset + PAGE - 1);
      if (error) throw new Error(`carregar ${tabela}: ${error.message}`);
      if (!data || data.length === 0) break;
      linhas.push(...data);
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return linhas.map((l) => ({ codigo: String((mapFn(l) as any).codigo), item: mapFn(l) }));
  }

  const [contas, categorias, clientes, departamentos] = await Promise.all([
    carregarTabela<ContaCorrente>('cadastro_contas_correntes', (r) => ({
      codigo: r.codigo, descricao: r.descricao, tipo: r.tipo,
      saldoInicial: Number(r.saldo_inicial || 0), codigoBanco: r.codigo_banco, ativo: r.ativo,
    })),
    carregarTabela<Categoria>('cadastro_categorias', (r) => ({
      codigo: r.codigo, descricao: r.descricao, tipoCategoria: r.tipo_categoria,
      natureza: r.natureza, contaDre: r.conta_dre, ativo: r.ativo,
    })),
    carregarTabela<Cliente>('cadastro_clientes', (r) => ({
      codigo: r.codigo, nomeFantasia: r.nome_fantasia, razaoSocial: r.razao_social,
      cnpjCpf: r.cnpj_cpf, email: r.email, telefone: r.telefone,
      ehCliente: r.eh_cliente, ehFornecedor: r.eh_fornecedor, ativo: r.ativo,
    })),
    carregarTabela<Departamento>('cadastro_departamentos', (r) => ({
      codigo: r.codigo, descricao: r.descricao, ativo: r.ativo,
    })),
  ]);

  const enr = new Enricher();
  for (const { codigo, item } of contas) if (codigo) enr.contas.set(codigo, item);
  for (const { codigo, item } of categorias) if (codigo) enr.categorias.set(codigo, item);
  for (const { codigo, item } of clientes) if (codigo) enr.clientes.set(codigo, item);
  for (const { codigo, item } of departamentos) if (codigo) enr.departamentos.set(codigo, item);
  return enr;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token || req.headers['x-sync-token'] || '');
  if (token !== process.env.SYNC_SECRET) return res.status(401).json({ error: 'Token inválido' });

  const paginaInicio = Math.max(1, parseInt(String(req.query.pagina || '1'), 10));
  const paginaFim = paginaInicio + PAGINAS_POR_CHAMADA - 1;

  const t0 = Date.now();
  const logId = await logStart({ tipo: 'full', endpoint: `movimentos[p${paginaInicio}-p${paginaFim}]` });

  try {
    const cli = new OmieClient(requireEnv('OMIE_APP_KEY'), requireEnv('OMIE_APP_SECRET'));

    // Enricher e download em paralelo — economiza ~15s
    const [enricher, resultRange] = await Promise.all([
      carregarEnricher(),
      cli.listarRange(ENDPOINTS.movimentos, paginaInicio, paginaFim),
    ]);

    const { registros: brutos, totalPaginas, paginaFinal } = resultRange;
    const movimentos = brutos.map((b) => transformarMovimento(b, enricher));
    const n = await upsertMovimentos(movimentos);

    const proximaPagina = paginaFinal < totalPaginas ? paginaFinal + 1 : null;
    const duracaoS = (Date.now() - t0) / 1000;

    await logFinish(logId, { registros: n, paginas: paginaFinal - paginaInicio + 1, status: 'ok', duracaoS });

    if (proximaPagina === null) {
      await setMetadata('ultima_sync', new Date().toISOString());
    }

    return res.status(200).json({
      ok: true,
      parte: 'movimentos',
      paginaInicio,
      paginaFinal,
      totalPaginas,
      registrosSalvos: n,
      duracaoS,
      proximaPagina,
      concluido: proximaPagina === null,
      proximaUrl: proximaPagina !== null
        ? `/api/sync/movimentos?token=${token}&pagina=${proximaPagina}`
        : null,
    });
  } catch (e: any) {
    const duracaoS = (Date.now() - t0) / 1000;
    await logFinish(logId, { status: 'erro', erro: String(e?.message ?? e).slice(0, 500), duracaoS });
    return res.status(500).json({ ok: false, error: String(e?.message ?? e).slice(0, 500) });
  }
}
