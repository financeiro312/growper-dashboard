/**
 * Pipeline de sincronização Omie → Supabase.
 *
 * Modos:
 *   - full: baixa TUDO (uso 1-2x por dia)
 *   - incremental: apenas cadastros + títulos alterados desde a última sync
 *
 * IMPORTANTE: movimentos (ListarMovimentos) NÃO aceitam filtro de data no
 * request principal — sempre são baixados por completo.
 */
import { OmieClient } from '../omie/client';
import { ENDPOINTS } from '../omie/endpoints';
import {
  transformarContaCorrente,
  transformarCategoria,
  transformarCliente,
  transformarDepartamento,
} from '../transformers/cadastros';
import {
  transformarMovimento,
  transformarContaPagar,
  transformarContaReceber,
  Enricher,
  type ContaCorrente,
  type Categoria,
  type Cliente,
  type Departamento,
  type Lancamento,
} from '../transformers/lancamentos';
import { getSupabase } from '../supabase/client';
import {
  upsertContasCorrentes,
  upsertCategorias,
  upsertClientes,
  upsertDepartamentos,
  upsertMovimentos,
  upsertTitulos,
  logStart,
  logFinish,
  getMetadata,
  setMetadata,
} from '../supabase/repos';

// ============================================================================
// Carregar cadastros do Supabase (para o Enricher)
// ============================================================================

async function carregarEnricherDoSupabase(): Promise<Enricher> {
  const sb = getSupabase();
  const enr = new Enricher();

  const carregar = async <T extends { codigo: string }>(
    tabela: string,
    mapFn: (r: any) => T,
    destino: Map<string, T>
  ) => {
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
    for (const l of linhas) {
      const item = mapFn(l);
      if (item.codigo) destino.set(item.codigo, item);
    }
  };

  await carregar(
    'cadastro_contas_correntes',
    (r): ContaCorrente => ({
      codigo: r.codigo,
      descricao: r.descricao,
      tipo: r.tipo,
      saldoInicial: Number(r.saldo_inicial || 0),
      codigoBanco: r.codigo_banco,
      ativo: r.ativo,
    }),
    enr.contas
  );

  await carregar(
    'cadastro_categorias',
    (r): Categoria => ({
      codigo: r.codigo,
      descricao: r.descricao,
      tipoCategoria: r.tipo_categoria,
      natureza: r.natureza,
      contaDre: r.conta_dre,
      ativo: r.ativo,
    }),
    enr.categorias
  );

  await carregar(
    'cadastro_clientes',
    (r): Cliente => ({
      codigo: r.codigo,
      nomeFantasia: r.nome_fantasia,
      razaoSocial: r.razao_social,
      cnpjCpf: r.cnpj_cpf,
      email: r.email,
      telefone: r.telefone,
      ehCliente: r.eh_cliente,
      ehFornecedor: r.eh_fornecedor,
      ativo: r.ativo,
    }),
    enr.clientes
  );

  await carregar(
    'cadastro_departamentos',
    (r): Departamento => ({
      codigo: r.codigo,
      descricao: r.descricao,
      ativo: r.ativo,
    }),
    enr.departamentos
  );

  return enr;
}

// ============================================================================
// Sync helpers (com logging)
// ============================================================================

async function comLog<T>(
  tipo: 'full' | 'incremental',
  endpoint: string,
  fn: () => Promise<{ registros: number; paginas?: number; extra?: any }>
): Promise<{ registros: number; paginas: number; erro?: string }> {
  const id = await logStart({ tipo, endpoint });
  const t0 = Date.now();
  try {
    const r = await fn();
    const duracaoS = (Date.now() - t0) / 1000;
    await logFinish(id, {
      registros: r.registros,
      paginas: r.paginas ?? 0,
      status: 'ok',
      duracaoS,
    });
    return { registros: r.registros, paginas: r.paginas ?? 0 };
  } catch (e: any) {
    const duracaoS = (Date.now() - t0) / 1000;
    const erro = String(e?.message ?? e).slice(0, 500);
    await logFinish(id, { status: 'erro', erro, duracaoS });
    throw e;
  }
}

// ============================================================================
// Passos individuais de sincronização
// ============================================================================

export interface ResultadoSync {
  tipo: 'full' | 'incremental';
  duracaoS: number;
  totalRegistros: number;
  detalhes: Record<string, { registros: number; erro?: string }>;
  ultimaSync: string;
}

async function syncCadastros(
  cli: OmieClient,
  detalhes: Record<string, { registros: number; erro?: string }>,
  tipo: 'full' | 'incremental'
) {
  // Contas correntes
  await comLog(tipo, 'contas_correntes', async () => {
    const brutos: any[] = [];
    for await (const b of cli.listarPaginado(ENDPOINTS.contas_correntes)) brutos.push(b);
    const itens = brutos.map(transformarContaCorrente).filter((c) => c.codigo);
    const n = await upsertContasCorrentes(itens);
    detalhes.contas_correntes = { registros: n };
    return { registros: n };
  });

  // Categorias
  await comLog(tipo, 'categorias', async () => {
    const brutos: any[] = [];
    for await (const b of cli.listarPaginado(ENDPOINTS.categorias)) brutos.push(b);
    const itens = brutos.map(transformarCategoria).filter((c) => c.codigo);
    const n = await upsertCategorias(itens);
    detalhes.categorias = { registros: n };
    return { registros: n };
  });

  // Departamentos
  await comLog(tipo, 'departamentos', async () => {
    const brutos: any[] = [];
    for await (const b of cli.listarPaginado(ENDPOINTS.departamentos)) brutos.push(b);
    const itens = brutos.map(transformarDepartamento).filter((c) => c.codigo);
    const n = await upsertDepartamentos(itens);
    detalhes.departamentos = { registros: n };
    return { registros: n };
  });

  // Clientes
  await comLog(tipo, 'clientes', async () => {
    const brutos: any[] = [];
    for await (const b of cli.listarPaginado(ENDPOINTS.clientes)) brutos.push(b);
    const itens = brutos.map(transformarCliente).filter((c) => c.codigo);
    const n = await upsertClientes(itens);
    detalhes.clientes = { registros: n };
    return { registros: n };
  });
}

async function syncMovimentos(
  cli: OmieClient,
  enricher: Enricher,
  detalhes: Record<string, { registros: number; erro?: string }>,
  tipo: 'full' | 'incremental'
) {
  await comLog(tipo, 'movimentos', async () => {
    const registros: Lancamento[] = [];
    let paginas = 0;
    for await (const bruto of cli.listarPaginado(ENDPOINTS.movimentos)) {
      registros.push(transformarMovimento(bruto, enricher));
      if (registros.length % 500 === 0) paginas++;
    }
    const n = await upsertMovimentos(registros);
    detalhes.movimentos = { registros: n };
    return { registros: n, paginas };
  });
}

async function syncTitulosPagar(
  cli: OmieClient,
  enricher: Enricher,
  detalhes: Record<string, { registros: number; erro?: string }>,
  tipo: 'full' | 'incremental',
  paramsExtra: Record<string, unknown> = {}
) {
  await comLog(tipo, 'contas_pagar', async () => {
    const registros: Lancamento[] = [];
    for await (const bruto of cli.listarPaginado(ENDPOINTS.contas_pagar, paramsExtra)) {
      registros.push(transformarContaPagar(bruto, enricher));
    }
    const n = await upsertTitulos(registros);
    detalhes.contas_pagar = { registros: n };
    return { registros: n };
  });
}

async function syncTitulosReceber(
  cli: OmieClient,
  enricher: Enricher,
  detalhes: Record<string, { registros: number; erro?: string }>,
  tipo: 'full' | 'incremental',
  paramsExtra: Record<string, unknown> = {}
) {
  await comLog(tipo, 'contas_receber', async () => {
    const registros: Lancamento[] = [];
    for await (const bruto of cli.listarPaginado(ENDPOINTS.contas_receber, paramsExtra)) {
      registros.push(transformarContaReceber(bruto, enricher));
    }
    const n = await upsertTitulos(registros);
    detalhes.contas_receber = { registros: n };
    return { registros: n };
  });
}

// ============================================================================
// Sincronização COMPLETA (uso 1-2x por dia)
// ============================================================================

export async function syncFull(): Promise<ResultadoSync> {
  const cli = new OmieClient(
    requireEnv('OMIE_APP_KEY'),
    requireEnv('OMIE_APP_SECRET')
  );

  const t0 = Date.now();
  const detalhes: Record<string, { registros: number; erro?: string }> = {};

  // 1. Cadastros (novos ou atualizados)
  await syncCadastros(cli, detalhes, 'full');

  // 2. Carregar cadastros do Supabase para enrichar
  const enricher = await carregarEnricherDoSupabase();

  // 3. Movimentos (sempre completo)
  await syncMovimentos(cli, enricher, detalhes, 'full');

  // 4. Títulos (completo)
  await syncTitulosPagar(cli, enricher, detalhes, 'full');
  await syncTitulosReceber(cli, enricher, detalhes, 'full');

  const nowIso = new Date().toISOString();
  await setMetadata('ultima_sync_full', nowIso);
  await setMetadata('ultima_sync', nowIso);

  const totalRegistros = Object.values(detalhes).reduce((s, d) => s + (d.registros || 0), 0);
  return {
    tipo: 'full',
    duracaoS: (Date.now() - t0) / 1000,
    totalRegistros,
    detalhes,
    ultimaSync: nowIso,
  };
}

// ============================================================================
// Sincronização INCREMENTAL (uso a cada 10 min)
// ============================================================================

export async function syncIncremental(): Promise<ResultadoSync> {
  const cli = new OmieClient(
    requireEnv('OMIE_APP_KEY'),
    requireEnv('OMIE_APP_SECRET')
  );

  const t0 = Date.now();
  const detalhes: Record<string, { registros: number; erro?: string }> = {};

  // 1. Cadastros: sincroniza no máximo 1x por dia (economia de chamadas)
  const ultimaCadastros = await getMetadata('ultima_sync_cadastros');
  const precisaCadastros =
    !ultimaCadastros ||
    (Date.now() - new Date(ultimaCadastros).getTime()) > 24 * 3600 * 1000;

  if (precisaCadastros) {
    await syncCadastros(cli, detalhes, 'incremental');
    await setMetadata('ultima_sync_cadastros', new Date().toISOString());
  }

  // 2. Enricher
  const enricher = await carregarEnricherDoSupabase();

  // 3. Movimentos: sempre completo (API não suporta incremental)
  await syncMovimentos(cli, enricher, detalhes, 'incremental');

  // 4. Títulos incrementais: por padrão a API não filtra por data_alteracao;
  //    o fluxo mais eficiente é baixar tudo e o upsert do Supabase
  //    silenciosamente atualiza apenas os que mudaram (por PK). Mantendo
  //    exatamente a mesma lógica do full aqui.
  await syncTitulosPagar(cli, enricher, detalhes, 'incremental');
  await syncTitulosReceber(cli, enricher, detalhes, 'incremental');

  const nowIso = new Date().toISOString();
  await setMetadata('ultima_sync', nowIso);

  const totalRegistros = Object.values(detalhes).reduce((s, d) => s + (d.registros || 0), 0);
  return {
    tipo: 'incremental',
    duracaoS: (Date.now() - t0) / 1000,
    totalRegistros,
    detalhes,
    ultimaSync: nowIso,
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ${name} não configurada`);
  return v;
}
