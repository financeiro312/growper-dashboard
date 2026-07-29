/**
 * ENDPOINT TEMPORÁRIO DE DEBUG
 *
 * GET /api/debug/inspect-titulos?token=SYNC_SECRET
 *
 * Executa o pipeline completo em cima de amostras reais:
 *   1. Chama ListarContasPagar e ListarContasReceber com o MESMO OmieClient
 *      usado em produção
 *   2. Passa os títulos brutos pelo MESMO transformer usado em produção
 *   3. Monta o objeto EXATO que seria enviado ao Supabase (mesmo mapping
 *      de nomes usado em upsertTitulos)
 *   4. Retorna os 3 estágios lado-a-lado pra validação de mapeamento
 *
 * Mascara dados sensíveis (nomes, CNPJ, observação) mas preserva TODAS
 * as datas e valores.
 *
 * Remover este arquivo após a validação.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { OmieClient } from '../../lib/omie/client';
import { ENDPOINTS } from '../../lib/omie/endpoints';
import { transformarContaPagar, transformarContaReceber, Enricher } from '../../lib/transformers/lancamentos';
import type { Lancamento } from '../../lib/transformers/lancamentos';

export const config = { maxDuration: 60 };

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} não configurado`);
  return v;
}

/**
 * Mascara strings com PII, preservando estrutura (comprimento e tipo).
 * Datas, valores, códigos e status ficam INTACTOS.
 */
function mascarar(valor: any, campo: string): any {
  if (valor == null) return valor;

  const camposSensiveis = new Set([
    'nome_fantasia', 'razao_social', 'cnpj_cpf', 'email', 'observacao',
    'nome_cliente_fornecedor', 'nome_categoria', 'cnpj_cliente_fornecedor',
    'chave_nfe', 'numero_boleto', 'linha_digitavel', 'codigo_barras',
    'cliente_nome', 'razaoSocial', 'nomeFantasia', 'cnpjCpf',
  ]);

  if (typeof valor === 'string' && camposSensiveis.has(campo)) {
    if (valor.length === 0) return '';
    return `***${valor.length}chars***`;
  }
  return valor;
}

function mascararRegistro(obj: any): any {
  if (obj == null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(mascararRegistro);
  const out: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') {
      out[k] = mascararRegistro(v);
    } else {
      out[k] = mascarar(v, k);
    }
  }
  return out;
}

/**
 * Monta o objeto EXATO que upsertTitulos envia para o Supabase.
 * Cópia fiel do mapping do repo, sem depender do repo em si.
 */
function objetoPersistencia(t: Lancamento) {
  return {
    id_titulo: t.idTitulo,
    origem: t.origem,
    tipo: t.tipo || null,
    status: t.status || null,
    cancelado: t.cancelado,
    data_registro: t.dataRegistro,
    data_previsao: t.dataPrevisao,
    data_vencimento: t.dataVencimento,
    data_pagto: t.dataPagto, // <-- será persistido APÓS a migration
    valor_documento: t.valorDocumento,
    valor_pago: t.valorPago,
    conta_codigo: t.contaCodigo || null,
    conta_nome: t.contaNome,
    categoria_codigo: t.categoriaCodigo || null,
    categoria_nome: t.categoriaNome,
    cliente_codigo: t.clienteCodigo || null,
    cliente_nome: `***${(t.clienteNome || '').length}chars***`,
    departamento_codigo: t.departamentoCodigo || null,
    departamento_nome: t.departamentoNome,
    distribuicoes: t.distribuicoes || [],
    vendedor: t.vendedor,
    projeto: t.projeto,
    numero_documento: t.numeroDocumento,
    observacao: `***${(t.observacao || '').length}chars***`,
    data_alteracao_omie: t.dataAlteracaoOmie,
  };
}

/**
 * Rende um resumo estruturado do mapeamento pra facilitar leitura.
 */
function resumoMapeamento(bruto: any, transformado: Lancamento, persistencia: any) {
  const resumoRaw = bruto?.resumo ?? {};
  return {
    // Campos que interessam pra COMPETÊNCIA
    competencia: {
      raw_omie: {
        data_registro: bruto?.data_registro,
        valor_documento: bruto?.valor_documento,
        status_titulo: bruto?.status_titulo,
      },
      transformado: {
        dataRegistro: transformado.dataRegistro,
        valorDocumento: transformado.valorDocumento,
        status: transformado.status,
      },
      persistencia: {
        data_registro: persistencia.data_registro,
        valor_documento: persistencia.valor_documento,
        status: persistencia.status,
      },
    },
    // Campos que interessam pra CAIXA
    caixa: {
      raw_omie_resumo: {
        // Quais campos de data existem em `resumo`? (mostra chaves brutas)
        chaves_do_resumo: Object.keys(resumoRaw),
        data_liquidacao: resumoRaw.data_liquidacao ?? null,
        data_recebimento: resumoRaw.data_recebimento ?? null,
        data_pagamento: resumoRaw.data_pagamento ?? null,
        dLiqData: resumoRaw.dLiqData ?? null,
        valor_pago: resumoRaw.valor_pago ?? null,
        valor_liquido: resumoRaw.valor_liquido ?? null,
        nValLiquido: resumoRaw.nValLiquido ?? null,
      },
      transformado: {
        dataPagto: transformado.dataPagto,
        valorPago: transformado.valorPago,
      },
      persistencia: {
        data_pagto: persistencia.data_pagto,
        valor_pago: persistencia.valor_pago,
      },
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const token = String(req.query.token || req.headers['x-sync-token'] || '');
  if (token !== process.env.SYNC_SECRET) {
    return res.status(401).json({ error: 'Token inválido' });
  }

  try {
    const cli = new OmieClient(requireEnv('OMIE_APP_KEY'), requireEnv('OMIE_APP_SECRET'));

    // Enricher vazio: no debug, os nomes vindos do enricher não importam
    // (a validação é sobre datas/valores brutos vs transformados)
    const enricherVazio = new Enricher();

    // 1. Buscar 20 títulos de Contas a Pagar (aumentamos amostra pra achar
    //    pelo menos 1 pago e 1 não pago)
    const brutosCP = await cli.call(ENDPOINTS.contas_pagar, {
      ...ENDPOINTS.contas_pagar.paramsBase,
      pagina: 1,
      registros_por_pagina: 20,
    });

    const listaCP: any[] = brutosCP?.[ENDPOINTS.contas_pagar.campoListaResposta] ?? [];

    // 2. Buscar 20 títulos de Contas a Receber
    const brutosCR = await cli.call(ENDPOINTS.contas_receber, {
      ...ENDPOINTS.contas_receber.paramsBase,
      pagina: 1,
      registros_por_pagina: 20,
    });

    const listaCR: any[] = brutosCR?.[ENDPOINTS.contas_receber.campoListaResposta] ?? [];

    // 3. Selecionar amostras:
    //    - 1 título de Contas a Pagar pago
    //    - 1 título de Contas a Pagar não pago
    //    - 1 título de Contas a Receber recebido
    //    - 1 título de Contas a Receber não recebido
    function achaComStatus(lista: any[], statusPositivo: boolean) {
      const positivos = ['BAIXADO', 'LIQUIDADO', 'RECEBIDO', 'PAGO'];
      for (const item of lista) {
        const s = String(item?.status_titulo ?? '').toUpperCase();
        const ehPos = positivos.includes(s);
        if (statusPositivo && ehPos) return item;
        if (!statusPositivo && !ehPos && s !== 'CANCELADO' && s !== 'EXCLUIDO') return item;
      }
      return lista[0] ?? null;
    }

    const cpPago = achaComStatus(listaCP, true);
    const cpAberto = achaComStatus(listaCP, false);
    const crRecebido = achaComStatus(listaCR, true);
    const crAberto = achaComStatus(listaCR, false);

    // 4. Passar cada um pelo transformer e montar objeto de persistência
    function processar(bruto: any, tipo: 'CP' | 'CR') {
      if (!bruto) return null;
      const transformado = tipo === 'CP'
        ? transformarContaPagar(bruto, enricherVazio)
        : transformarContaReceber(bruto, enricherVazio);
      const persistencia = objetoPersistencia(transformado);
      return {
        raw_omie: mascararRegistro(bruto),
        transformado: {
          ...transformado,
          clienteNome: `***${(transformado.clienteNome || '').length}chars***`,
          observacao: `***${(transformado.observacao || '').length}chars***`,
        },
        persistencia,
        resumo_mapeamento: resumoMapeamento(bruto, transformado, persistencia),
      };
    }

    return res.status(200).json({
      ok: true,
      total_disponivel: {
        contas_pagar_pagina1: listaCP.length,
        contas_receber_pagina1: listaCR.length,
      },
      amostras: {
        contas_pagar_pago: processar(cpPago, 'CP'),
        contas_pagar_aberto: processar(cpAberto, 'CP'),
        contas_receber_recebido: processar(crRecebido, 'CR'),
        contas_receber_aberto: processar(crAberto, 'CR'),
      },
      // Diagnóstico geral: quais chaves aparecem no nível raiz do primeiro CP/CR?
      chaves_disponiveis: {
        contas_pagar_raiz: listaCP[0] ? Object.keys(listaCP[0]) : [],
        contas_receber_raiz: listaCR[0] ? Object.keys(listaCR[0]) : [],
      },
    });
  } catch (e: any) {
    console.error('[debug/inspect-titulos] erro:', e);
    return res.status(500).json({
      ok: false,
      error: String(e?.message ?? e).slice(0, 800),
    });
  }
}
