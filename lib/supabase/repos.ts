/**
 * Repositórios Supabase.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase } from './client';
import type {
  ContaCorrente, Categoria, Cliente, Departamento, Lancamento,
} from '../transformers/lancamentos';

const BATCH_SIZE = 500;

async function upsertBatch<T>(
  sb: SupabaseClient, tabela: string, registros: T[], onConflict: string
): Promise<void> {
  if (registros.length === 0) return;
  for (let i = 0; i < registros.length; i += BATCH_SIZE) {
    const batch = registros.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from(tabela).upsert(batch as any[], { onConflict });
    if (error) throw new Error(`upsert ${tabela} lote ${i / BATCH_SIZE}: ${error.message}`);
  }
}

export async function upsertContasCorrentes(itens: ContaCorrente[]): Promise<number> {
  const sb = getSupabase();
  const linhas = itens.map((c) => ({
    codigo: c.codigo, descricao: c.descricao, tipo: c.tipo,
    saldo_inicial: c.saldoInicial, codigo_banco: c.codigoBanco,
    ativo: c.ativo, atualizado_em: new Date().toISOString(),
  }));
  await upsertBatch(sb, 'cadastro_contas_correntes', linhas, 'codigo');
  return linhas.length;
}

export async function upsertCategorias(itens: Categoria[]): Promise<number> {
  const sb = getSupabase();
  const linhas = itens.map((c) => ({
    codigo: c.codigo, descricao: c.descricao,
    tipo_categoria: c.tipoCategoria, natureza: c.natureza,
    conta_dre: c.contaDre, ativo: c.ativo, atualizado_em: new Date().toISOString(),
  }));
  await upsertBatch(sb, 'cadastro_categorias', linhas, 'codigo');
  return linhas.length;
}

export async function upsertClientes(itens: Cliente[]): Promise<number> {
  const sb = getSupabase();
  const linhas = itens.map((c) => ({
    codigo: c.codigo, nome_fantasia: c.nomeFantasia, razao_social: c.razaoSocial,
    cnpj_cpf: c.cnpjCpf, email: c.email, telefone: c.telefone,
    eh_cliente: c.ehCliente, eh_fornecedor: c.ehFornecedor,
    ativo: c.ativo, atualizado_em: new Date().toISOString(),
  }));
  await upsertBatch(sb, 'cadastro_clientes', linhas, 'codigo');
  return linhas.length;
}

export async function upsertDepartamentos(itens: Departamento[]): Promise<number> {
  const sb = getSupabase();
  const linhas = itens.map((d) => ({
    codigo: d.codigo, descricao: d.descricao,
    ativo: d.ativo, atualizado_em: new Date().toISOString(),
  }));
  await upsertBatch(sb, 'cadastro_departamentos', linhas, 'codigo');
  return linhas.length;
}

// ============================================================================
// Movimentos financeiros
// ============================================================================
export async function upsertMovimentos(itens: Lancamento[]): Promise<number> {
  const sb = getSupabase();
  const linhas = itens
    .filter((m) => m.idMovimento)
    .map((m) => {
      const linha: any = {
        id_movimento: m.idMovimento,
        id_titulo: m.idTitulo || null,
        tipo: m.tipo || null,
        status: m.status || null,
        cancelado: m.cancelado,
        data_pagto: m.dataPagto,
        data_registro: m.dataRegistro,
        data_previsao: m.dataPrevisao,
        data_vencimento: m.dataVencimento,
        valor_documento: m.valorDocumento,
        valor_pago: m.valorPago,
        conta_codigo: m.contaCodigo || null,
        conta_nome: m.contaNome,
        categoria_codigo: m.categoriaCodigo || null,
        categoria_nome: m.categoriaNome,
        cliente_codigo: m.clienteCodigo || null,
        cliente_nome: m.clienteNome,
        numero_documento: m.numeroDocumento,
        observacao: m.observacao,
        atualizado_em: new Date().toISOString(),
      };
      // IMPORTANTE: só grava departamento quando vier valor (não sobrescreve com null)
      // Movimentos financeiros da Omie não trazem departamento — ele vem via título
      // e é preenchido automaticamente por trigger no Supabase (fill_departamento_from_titulo)
      if (m.departamentoCodigo) linha.departamento_codigo = m.departamentoCodigo;
      if (m.departamentoNome) linha.departamento_nome = m.departamentoNome;
      return linha;
    });

  const unicas = new Map<string, any>();
  for (const l of linhas) unicas.set(l.id_movimento, l);
  const linhasUnicas = Array.from(unicas.values());

  await upsertBatch(sb, 'movimentos_financeiros', linhasUnicas, 'id_movimento');
  return linhasUnicas.length;
}

// ============================================================================
// Títulos (visão de competência)
// ============================================================================
export async function upsertTitulos(itens: Lancamento[]): Promise<number> {
  const sb = getSupabase();
  const linhas = itens
    .filter((t) => t.idTitulo)
    .map((t) => ({
      id_titulo: t.idTitulo, origem: t.origem, tipo: t.tipo || null,
      status: t.status || null, cancelado: t.cancelado,
      data_registro: t.dataRegistro, data_previsao: t.dataPrevisao,
      data_vencimento: t.dataVencimento,
      valor_documento: t.valorDocumento, valor_pago: t.valorPago,
      conta_codigo: t.contaCodigo || null, conta_nome: t.contaNome,
      categoria_codigo: t.categoriaCodigo || null, categoria_nome: t.categoriaNome,
      cliente_codigo: t.clienteCodigo || null, cliente_nome: t.clienteNome,
      departamento_codigo: t.departamentoCodigo || null,
      departamento_nome: t.departamentoNome,
      distribuicoes: t.distribuicoes || [],
      vendedor: t.vendedor, projeto: t.projeto,
      numero_documento: t.numeroDocumento, observacao: t.observacao,
      data_alteracao_omie: t.dataAlteracaoOmie,
      atualizado_em: new Date().toISOString(),
    }));

  const unicas = new Map<string, any>();
  for (const l of linhas) unicas.set(l.id_titulo, l);
  const linhasUnicas = Array.from(unicas.values());

  await upsertBatch(sb, 'titulos', linhasUnicas, 'id_titulo');
  return linhasUnicas.length;
}

// ============================================================================
// Metadata / Log
// ============================================================================
export async function getMetadata(chave: string): Promise<string | null> {
  const sb = getSupabase();
  const { data, error } = await sb.from('sync_metadata').select('valor').eq('chave', chave).maybeSingle();
  if (error) throw new Error(`getMetadata: ${error.message}`);
  return data?.valor ?? null;
}

export async function setMetadata(chave: string, valor: string): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('sync_metadata').upsert(
    { chave, valor, atualizado_em: new Date().toISOString() }, { onConflict: 'chave' }
  );
  if (error) throw new Error(`setMetadata: ${error.message}`);
}

export interface LogSyncStart { tipo: 'full' | 'incremental'; endpoint: string; }
export interface LogSyncFinish { registros?: number; paginas?: number; status: 'ok' | 'erro'; erro?: string; }

export async function logStart(entrada: LogSyncStart): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb.from('sync_log').insert({
    tipo: entrada.tipo, endpoint: entrada.endpoint, iniciado_em: new Date().toISOString(),
  }).select('id').single();
  if (error) throw new Error(`logStart: ${error.message}`);
  return data.id as number;
}

export async function logFinish(id: number, fim: LogSyncFinish & { duracaoS: number }): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from('sync_log').update({
    finalizado_em: new Date().toISOString(), duracao_s: fim.duracaoS,
    registros: fim.registros ?? 0, paginas: fim.paginas ?? 0,
    status: fim.status, erro: fim.erro ?? null,
  }).eq('id', id);
  if (error) console.warn(`logFinish: ${error.message}`);
}

export async function getUltimosLogs(limite: number = 20): Promise<any[]> {
  const sb = getSupabase();
  const { data, error } = await sb.from('sync_log').select('*').order('iniciado_em', { ascending: false }).limit(limite);
  if (error) throw new Error(`getUltimosLogs: ${error.message}`);
  return data || [];
}

// ============================================================================
// Consultas para o dashboard
// ============================================================================
export async function getRawDataCaixa(): Promise<any[]> {
  const sb = getSupabase();
  const linhas: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from('v_raw_data_caixa').select('*').range(offset, offset + PAGE - 1);
    if (error) throw new Error(`getRawDataCaixa: ${error.message}`);
    if (!data || data.length === 0) break;
    linhas.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return linhas;
}

export async function getRawDataComp(): Promise<any[]> {
  const sb = getSupabase();
  const linhas: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from('v_raw_data_comp').select('*').range(offset, offset + PAGE - 1);
    if (error) throw new Error(`getRawDataComp: ${error.message}`);
    if (!data || data.length === 0) break;
    linhas.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  return linhas;
}

export async function getPrepopClientes(): Promise<any[]> {
  const sb = getSupabase();
  const linhas: any[] = [];
  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await sb.from('titulos').select(
      'cliente_codigo, cliente_nome, categoria_codigo, data_registro, valor_documento, cancelado, origem'
    ).eq('origem', 'CR').eq('cancelado', false).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`getPrepopClientes: ${error.message}`);
    if (!data || data.length === 0) break;
    linhas.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }
  const filtrados = linhas.filter((r) => String(r.categoria_codigo || '').startsWith('01.01'));
  const agrupado = new Map<string, Map<string, number>>();
  for (const r of filtrados) {
    const nome = String(r.cliente_nome || '');
    const dr = r.data_registro ? String(r.data_registro) : '';
    if (!nome || !dr) continue;
    const mes = dr.substring(0, 7);
    if (!agrupado.has(nome)) agrupado.set(nome, new Map());
    const mp = agrupado.get(nome)!;
    mp.set(mes, (mp.get(mes) || 0) + Number(r.valor_documento || 0));
  }
  const regexPrefixo = /^\((\d+)\)/;
  const nomes = Array.from(agrupado.keys()).sort((a, b) => {
    const ma = a.match(regexPrefixo);
    const mb = b.match(regexPrefixo);
    const na = ma ? parseInt(ma[1], 10) : 99999;
    const nb = mb ? parseInt(mb[1], 10) : 99999;
    if (na !== nb) return na - nb;
    return a.localeCompare(b);
  });
  const nomesArray = Array.from(new Set(nomes));
  const contatos = new Map<string, { telefone: string; email: string }>();
  if (nomesArray.length > 0) {
    for (let i = 0; i < nomesArray.length; i += 500) {
      const chunk = nomesArray.slice(i, i + 500);
      const { data } = await sb.from('cadastro_clientes').select('nome_fantasia, telefone, email').in('nome_fantasia', chunk);
      if (data) for (const c of data) contatos.set(String(c.nome_fantasia), { telefone: c.telefone || '', email: c.email || '' });
    }
  }
  const resultado: any[] = [];
  nomes.forEach((nome, idx) => {
    const mp = agrupado.get(nome)!;
    const valoresSistema: Record<string, number> = {};
    for (const [mes, v] of mp.entries()) if (v > 0) valoresSistema[mes] = v;
    if (Object.keys(valoresSistema).length === 0) return;
    const contato = contatos.get(nome) || { telefone: '', email: '' };
    resultado.push({
      nome, contato: '', telefone: contato.telefone, email: contato.email,
      vencimento: 5, observacoes: '', valoresSistema, historico: {}, id: `cli_${idx}`,
    });
  });
  return resultado;
}
