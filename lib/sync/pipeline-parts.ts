/**
 * Funções de sync separadas por parte, para caber no timeout de 60s da Vercel Hobby.
 * Cada função sincroniza APENAS uma parte do dado.
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
  setMetadata,
} from '../supabase/repos';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variável de ambiente ${name} não configurada`);
  return v;
}

function novoCli(): OmieClient {
  return new OmieClient(requireEnv('OMIE_APP_KEY'), requireEnv('OMIE_APP_SECRET'));
}

async function comLog<T>(
  tipo: 'full' | 'incremental',
  endpoint: string,
  fn: () => Promise<{ registros: number }>
): Promise<{ registros: number }> {
  const id = await logStart({ tipo, endpoint });
  const t0 = Date.now();
  try {
    const r = await fn();
    const duracaoS = (Date.now() - t0) / 1000;
    await logFinish(id, { registros: r.registros, status: 'ok', duracaoS });
    return r;
  } catch (e: any) {
    const duracaoS = (Date.now() - t0) / 1000;
    const erro = String(e?.message ?? e).slice(0, 500);
    await logFinish(id, { status: 'erro', erro, duracaoS });
    throw e;
  }
}

// ============================================================================
// Enricher (carregado do Supabase)
// ============================================================================

async function carregarEnricher(): Promise<Enricher> {
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

  await carregar('cadastro_contas_correntes', (r): ContaCorrente => ({
    codigo: r.codigo, descricao: r.descricao, tipo: r.tipo,
    saldoInicial: Number(r.saldo_inicial || 0), codigoBanco: r.codigo_banco, ativo: r.ativo,
  }), enr.contas);

  await carregar('cadastro_categorias', (r): Categoria => ({
    codigo: r.codigo, descricao: r.descricao, tipoCategoria: r.tipo_categoria,
    natureza: r.natureza, contaDre: r.conta_dre, ativo: r.ativo,
  }), enr.categorias);

  await carregar('cadastro_clientes', (r): Cliente => ({
    codigo: r.codigo, nomeFantasia: r.nome_fantasia, razaoSocial: r.razao_social,
    cnpjCpf: r.cnpj_cpf, email: r.email, telefone: r.telefone,
    ehCliente: r.eh_cliente, ehFornecedor: r.eh_fornecedor, ativo: r.ativo,
  }), enr.clientes);

  await carregar('cadastro_departamentos', (r): Departamento => ({
    codigo: r.codigo, descricao: r.descricao, ativo: r.ativo,
  }), enr.departamentos);

  return enr;
}

// ============================================================================
// SYNCS INDIVIDUAIS
// ============================================================================

export async function syncCadastrosOnly() {
  const t0 = Date.now();
  const cli = novoCli();
  const detalhes: Record<string, { registros: number }> = {};

  // Cada endpoint dentro do seu próprio log (não conflita entre si)
  await comLog('full', 'contas_correntes', async () => {
    const brutos: any[] = [];
    for await (const b of cli.listarPaginado(ENDPOINTS.contas_correntes)) brutos.push(b);
    const itens = brutos.map(transformarContaCorrente).filter((c) => c.codigo);
    const n = await upsertContasCorrentes(itens);
    detalhes.contas_correntes = { registros: n };
    return { registros: n };
  });

  await comLog('full', 'categorias', async () => {
    const brutos: any[] = [];
    for await (const b of cli.listarPaginado(ENDPOINTS.categorias)) brutos.push(b);
    const itens = brutos.map(transformarCategoria).filter((c) => c.codigo);
    const n = await upsertCategorias(itens);
    detalhes.categorias = { registros: n };
    return { registros: n };
  });

  await comLog('full', 'departamentos', async () => {
    const brutos: any[] = [];
    for await (const b of cli.listarPaginado(ENDPOINTS.departamentos)) brutos.push(b);
    const itens = brutos.map(transformarDepartamento).filter((c) => c.codigo);
    const n = await upsertDepartamentos(itens);
    detalhes.departamentos = { registros: n };
    return { registros: n };
  });

  await comLog('full', 'clientes', async () => {
    const brutos: any[] = [];
    for await (const b of cli.listarPaginado(ENDPOINTS.clientes)) brutos.push(b);
    const itens = brutos.map(transformarCliente).filter((c) => c.codigo);
    const n = await upsertClientes(itens);
    detalhes.clientes = { registros: n };
    return { registros: n };
  });

  await setMetadata('ultima_sync_cadastros', new Date().toISOString());
  await setMetadata('ultima_sync', new Date().toISOString());

  return {
    parte: 'cadastros',
    duracaoS: (Date.now() - t0) / 1000,
    detalhes,
  };
}

export async function syncMovimentosOnly() {
  const t0 = Date.now();
  const cli = novoCli();
  const enricher = await carregarEnricher();
  const detalhes: Record<string, { registros: number }> = {};

  await comLog('full', 'movimentos', async () => {
    const registros: Lancamento[] = [];
    for await (const bruto of cli.listarPaginado(ENDPOINTS.movimentos)) {
      registros.push(transformarMovimento(bruto, enricher));
    }
    const n = await upsertMovimentos(registros);
    detalhes.movimentos = { registros: n };
    return { registros: n };
  });

  await setMetadata('ultima_sync', new Date().toISOString());
  return { parte: 'movimentos', duracaoS: (Date.now() - t0) / 1000, detalhes };
}

export async function syncTitulosPagarOnly() {
  const t0 = Date.now();
  const cli = novoCli();
  const enricher = await carregarEnricher();
  const detalhes: Record<string, { registros: number }> = {};

  await comLog('full', 'contas_pagar', async () => {
    const registros: Lancamento[] = [];
    for await (const bruto of cli.listarPaginado(ENDPOINTS.contas_pagar)) {
      registros.push(transformarContaPagar(bruto, enricher));
    }
    const n = await upsertTitulos(registros);
    detalhes.contas_pagar = { registros: n };
    return { registros: n };
  });

  await setMetadata('ultima_sync', new Date().toISOString());
  return { parte: 'contas_pagar', duracaoS: (Date.now() - t0) / 1000, detalhes };
}

export async function syncTitulosReceberOnly() {
  const t0 = Date.now();
  const cli = novoCli();
  const enricher = await carregarEnricher();
  const detalhes: Record<string, { registros: number }> = {};

  await comLog('full', 'contas_receber', async () => {
    const registros: Lancamento[] = [];
    for await (const bruto of cli.listarPaginado(ENDPOINTS.contas_receber)) {
      registros.push(transformarContaReceber(bruto, enricher));
    }
    const n = await upsertTitulos(registros);
    detalhes.contas_receber = { registros: n };
    return { registros: n };
  });

  await setMetadata('ultima_sync', new Date().toISOString());
  return { parte: 'contas_receber', duracaoS: (Date.now() - t0) / 1000, detalhes };
}
