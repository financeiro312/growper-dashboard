/**
 * Modelos internos e transformers dos endpoints financeiros.
 *
 * REGRAS PORTADAS DA VERSÃO PYTHON (não alterar):
 *  1. Movimentos com status CANCELADO / EXCLUIDO → cancelado = true (excluídos dos cálculos)
 *  2. Tipo derivado de cTipo, cNatureza ou cGrupo
 *  3. Código de categoria normalizado (padStart 2)
 *  4. Datas parseadas de DD/MM/YYYY → ISO
 *  5. Enricher traduz códigos em nomes ("Banco Inter", "01.01 Receita ...")
 */
import { getFirst, parseDataOmie, parseDecimal, normalizarCodigoCategoria } from './utils';

// ============================================================================
// Modelos internos
// ============================================================================

export interface ContaCorrente {
  codigo: string;
  descricao: string;
  tipo: string;
  saldoInicial: number;
  codigoBanco: string;
  ativo: boolean;
}

export interface Categoria {
  codigo: string;
  descricao: string;
  tipoCategoria: string;
  natureza: string;
  contaDre: string;
  ativo: boolean;
}

export interface Cliente {
  codigo: string;
  nomeFantasia: string;
  razaoSocial: string;
  cnpjCpf: string;
  email: string;
  telefone: string;
  ehCliente: boolean;
  ehFornecedor: boolean;
  ativo: boolean;
}

export interface Departamento {
  codigo: string;
  descricao: string;
  ativo: boolean;
}

export interface DistribuicaoDepartamento {
  codigoDepartamento: string;
  nomeDepartamento: string;
  percentual: number;
  valor: number;
}

export interface Lancamento {
  idMovimento: string;
  idTitulo: string;
  origem: 'MF' | 'CP' | 'CR' | '';
  tipo: string; // "1. Contas a Receber" | "2. Contas a Pagar" | ""
  status: string; // "Sim" | "Não"
  cancelado: boolean;
  dataPagto: string | null;
  dataRegistro: string | null;
  dataPrevisao: string | null;
  dataVencimento: string | null;
  valorDocumento: number;
  valorPago: number;
  contaCodigo: string;
  contaNome: string;
  categoriaCodigo: string;
  categoriaNome: string;
  clienteCodigo: string;
  clienteNome: string;
  departamentoCodigo: string;
  departamentoNome: string;
  distribuicoes: DistribuicaoDepartamento[];
  vendedor: string;
  projeto: string;
  numeroDocumento: string;
  observacao: string;
  dataAlteracaoOmie: string | null;
}

// ============================================================================
// Enricher — traduz códigos em nomes
// ============================================================================

export class Enricher {
  constructor(
    public contas: Map<string, ContaCorrente> = new Map(),
    public categorias: Map<string, Categoria> = new Map(),
    public clientes: Map<string, Cliente> = new Map(),
    public departamentos: Map<string, Departamento> = new Map()
  ) {}

  nomeConta(codigo: string | number | undefined | null): string {
    if (!codigo) return '';
    const c = this.contas.get(String(codigo));
    return c?.descricao ?? '';
  }

  nomeCategoria(codigo: string | undefined | null): string {
    if (!codigo) return '';
    // Tenta com código bruto e com código normalizado
    const bruto = String(codigo);
    const norm = normalizarCodigoCategoria(bruto);
    const c = this.categorias.get(bruto) || this.categorias.get(norm);
    if (c) return `${c.codigo} ${c.descricao}`.trim();
    return norm || bruto;
  }

  nomeCliente(codigo: string | number | undefined | null): string {
    if (!codigo) return '';
    const c = this.clientes.get(String(codigo));
    return c?.nomeFantasia || c?.razaoSocial || '';
  }

  nomeDepartamento(codigo: string | undefined | null): string {
    if (!codigo) return '';
    const d = this.departamentos.get(String(codigo));
    if (d) return `${d.codigo} ${d.descricao}`.trim();
    return String(codigo);
  }
}

// ============================================================================
// Derivadores de tipo/status
// ============================================================================

/**
 * Deriva o tipo (Receber / Pagar) do movimento ou título.
 * Preferência: cTipo → cNatureza → cGrupo.
 * Regra portada da versão Python (validada com dados reais).
 */
function derivarTipo(ctipo?: string, cnatureza?: string, cgrupo?: string): string {
  const t = String(ctipo ?? '').trim().toUpperCase();
  if (t === 'R' || t === '1' || t === 'RECEBER') return '1. Contas a Receber';
  if (t === 'P' || t === '2' || t === 'PAGAR') return '2. Contas a Pagar';

  const n = String(cnatureza ?? '').trim().toUpperCase();
  if (n === 'R') return '1. Contas a Receber';
  if (n === 'P') return '2. Contas a Pagar';

  const g = String(cgrupo ?? '').trim().toUpperCase();
  if (g.includes('RECEB')) return '1. Contas a Receber';
  if (g.includes('PAG')) return '2. Contas a Pagar';

  return '';
}

/**
 * Deriva status normalizado e flag de cancelamento.
 */
function derivarStatus(status: string): { status: string; cancelado: boolean } {
  if (!status) return { status: 'Não', cancelado: false };
  const s = String(status).trim().toUpperCase();
  if (s === 'CANCELADO' || s === 'EXCLUIDO' || s === 'EXCLUÍDO') {
    return { status: 'Cancelado', cancelado: true };
  }
  if (['BAIXADO', 'LIQUIDADO', 'RECEBIDO', 'PAGO'].includes(s)) {
    return { status: 'Sim', cancelado: false };
  }
  return { status: 'Não', cancelado: false };
}

// ============================================================================
// Transformer: ListarMovimentos → Lancamento
// ============================================================================

export function transformarMovimento(bruto: any, enricher: Enricher): Lancamento {
  const d = bruto?.detalhes ?? bruto ?? {};

  const contaCod = String(getFirst(d, 'nCodCC', 'codigo_cc') ?? '');
  const catBruto = String(getFirst(d, 'cCodCateg', 'codigo_categoria') ?? '');
  const catNorm = normalizarCodigoCategoria(catBruto);
  const cliCod = String(getFirst(d, 'nCodCliente', 'codigo_cliente') ?? '');

  const tipo = derivarTipo(
    String(getFirst(d, 'cTipo', 'tipo') ?? ''),
    String(getFirst(d, 'cNatureza') ?? ''),
    String(getFirst(d, 'cGrupo') ?? '')
  );

  const { status, cancelado } = derivarStatus(
    String(getFirst(d, 'cStatus', 'status') ?? '')
  );

  // ID do movimento: precisa ser único por lançamento.
  // Preferência: nCodTitRepet (único por parcela/repetição). Fallback: composta.
  const nCodTit = String(getFirst(d, 'nCodTitulo', 'codigo') ?? '');
  const nCodRepet = String(getFirst(d, 'nCodTitRepet') ?? '');
  const numParc = String(getFirst(d, 'cNumParcela') ?? '');
  const dtPag = String(getFirst(d, 'dDtPagamento', 'data_pagamento') ?? '');
  let idMov: string;
  if (nCodRepet && nCodRepet !== nCodTit) {
    idMov = `${nCodTit}_${nCodRepet}`;
  } else if (numParc) {
    idMov = `${nCodTit}_${numParc.replace('/', 'de')}`;
  } else if (dtPag) {
    idMov = `${nCodTit}_${dtPag.replace(/\//g, '')}`;
  } else {
    idMov = nCodTit;
  }

  return {
    idMovimento: idMov,
    idTitulo: String(
      getFirst(d, 'nCodTitReceber', 'nCodTitPagar', 'codigo_lancamento_omie') ?? nCodTit
    ),
    origem: 'MF',
    tipo,
    status,
    cancelado,
    dataPagto: parseDataOmie(getFirst(d, 'dDtPagamento', 'data_pagamento')),
    dataRegistro: parseDataOmie(getFirst(d, 'dDtRegistro', 'data_registro')),
    dataPrevisao: parseDataOmie(getFirst(d, 'dDtPrevisao', 'data_previsao')),
    dataVencimento: parseDataOmie(
      getFirst(d, 'dDtVenc', 'dDtVencimento', 'data_vencimento')
    ),
    valorDocumento: parseDecimal(
      getFirst(d, 'nValorTitulo', 'nValor', 'valor_documento')
    ),
    valorPago: parseDecimal(
      getFirst(d, 'nValPago', 'nValorTitulo', 'nValor', 'valor_pago') ?? 0
    ),
    contaCodigo: contaCod,
    contaNome: enricher.nomeConta(contaCod),
    categoriaCodigo: catNorm,
    categoriaNome: enricher.nomeCategoria(catBruto),
    clienteCodigo: cliCod,
    clienteNome: enricher.nomeCliente(cliCod),
    departamentoCodigo: '',
    departamentoNome: '',
    distribuicoes: [],
    vendedor: '',
    projeto: '',
    numeroDocumento: String(getFirst(d, 'cNumTitulo', 'numero_titulo') ?? ''),
    observacao: String(getFirst(d, 'cObservacao', 'observacao') ?? ''),
    dataAlteracaoOmie: null,
  };
}

// ============================================================================
// Transformer: ListarContasPagar → Lancamento
// ============================================================================

export function transformarContaPagar(bruto: any, enricher: Enricher): Lancamento {
  const contaCod = String(
    getFirst(bruto, 'id_conta_corrente', 'codigo_conta_corrente') ?? ''
  );
  const catBruto = String(getFirst(bruto, 'codigo_categoria') ?? '');
  const catNorm = normalizarCodigoCategoria(catBruto);
  const fornCod = String(
    getFirst(bruto, 'codigo_cliente_fornecedor', 'codigo_fornecedor') ?? ''
  );

  // Distribuição por departamento (rateio)
  const distribuicoes: DistribuicaoDepartamento[] = [];
  let deptPrincipal = '';
  const distRaw = Array.isArray(bruto?.distribuicao) ? bruto.distribuicao : [];
  for (const dist of distRaw) {
    const codDep = String(getFirst(dist, 'cCodDep', 'codigo_departamento') ?? '');
    if (!codDep) continue;
    distribuicoes.push({
      codigoDepartamento: codDep,
      nomeDepartamento: enricher.nomeDepartamento(codDep),
      percentual: parseDecimal(getFirst(dist, 'cRateio', 'percentual') ?? 100),
      valor: parseDecimal(getFirst(dist, 'nValor', 'valor') ?? 0),
    });
    if (!deptPrincipal) deptPrincipal = codDep;
  }

  const { status, cancelado } = derivarStatus(
    String(getFirst(bruto, 'status_titulo') ?? '')
  );

  return {
    idMovimento: '',
    idTitulo: String(getFirst(bruto, 'codigo_lancamento_omie', 'codigo') ?? ''),
    origem: 'CP',
    tipo: '2. Contas a Pagar',
    status,
    cancelado,
    dataPagto: null,
    dataRegistro: parseDataOmie(getFirst(bruto, 'data_registro')),
    dataPrevisao: parseDataOmie(getFirst(bruto, 'data_previsao')),
    dataVencimento: parseDataOmie(getFirst(bruto, 'data_vencimento')),
    valorDocumento: parseDecimal(getFirst(bruto, 'valor_documento', 'nValor')),
    valorPago: parseDecimal(getFirst(bruto, 'valor_pago') ?? 0),
    contaCodigo: contaCod,
    contaNome: enricher.nomeConta(contaCod),
    categoriaCodigo: catNorm,
    categoriaNome: enricher.nomeCategoria(catBruto),
    clienteCodigo: fornCod,
    clienteNome: enricher.nomeCliente(fornCod),
    departamentoCodigo: deptPrincipal,
    departamentoNome: enricher.nomeDepartamento(deptPrincipal),
    distribuicoes,
    vendedor: '',
    projeto: String(getFirst(bruto, 'codigo_projeto') ?? ''),
    numeroDocumento: String(getFirst(bruto, 'numero_documento') ?? ''),
    observacao: String(getFirst(bruto, 'observacao') ?? ''),
    dataAlteracaoOmie: parseDataOmie(getFirst(bruto, 'info', 'data_alteracao')) ?? null,
  };
}

// ============================================================================
// Transformer: ListarContasReceber → Lancamento
// ============================================================================

export function transformarContaReceber(bruto: any, enricher: Enricher): Lancamento {
  const contaCod = String(
    getFirst(bruto, 'id_conta_corrente', 'codigo_conta_corrente') ?? ''
  );
  const catBruto = String(getFirst(bruto, 'codigo_categoria') ?? '');
  const catNorm = normalizarCodigoCategoria(catBruto);
  const cliCod = String(
    getFirst(bruto, 'codigo_cliente_fornecedor', 'codigo_cliente') ?? ''
  );

  const distribuicoes: DistribuicaoDepartamento[] = [];
  let deptPrincipal = '';
  const distRaw = Array.isArray(bruto?.distribuicao) ? bruto.distribuicao : [];
  for (const dist of distRaw) {
    const codDep = String(getFirst(dist, 'cCodDep', 'codigo_departamento') ?? '');
    if (!codDep) continue;
    distribuicoes.push({
      codigoDepartamento: codDep,
      nomeDepartamento: enricher.nomeDepartamento(codDep),
      percentual: parseDecimal(getFirst(dist, 'cRateio', 'percentual') ?? 100),
      valor: parseDecimal(getFirst(dist, 'nValor', 'valor') ?? 0),
    });
    if (!deptPrincipal) deptPrincipal = codDep;
  }

  const { status, cancelado } = derivarStatus(
    String(getFirst(bruto, 'status_titulo') ?? '')
  );

  return {
    idMovimento: '',
    idTitulo: String(getFirst(bruto, 'codigo_lancamento_omie', 'codigo') ?? ''),
    origem: 'CR',
    tipo: '1. Contas a Receber',
    status,
    cancelado,
    dataPagto: null,
    dataRegistro: parseDataOmie(getFirst(bruto, 'data_registro')),
    dataPrevisao: parseDataOmie(getFirst(bruto, 'data_previsao')),
    dataVencimento: parseDataOmie(getFirst(bruto, 'data_vencimento')),
    valorDocumento: parseDecimal(getFirst(bruto, 'valor_documento', 'nValor')),
    valorPago: parseDecimal(getFirst(bruto, 'valor_pago') ?? 0),
    contaCodigo: contaCod,
    contaNome: enricher.nomeConta(contaCod),
    categoriaCodigo: catNorm,
    categoriaNome: enricher.nomeCategoria(catBruto),
    clienteCodigo: cliCod,
    clienteNome: enricher.nomeCliente(cliCod),
    departamentoCodigo: deptPrincipal,
    departamentoNome: enricher.nomeDepartamento(deptPrincipal),
    distribuicoes,
    vendedor: String(getFirst(bruto, 'codigo_vendedor', 'vendedor') ?? ''),
    projeto: String(getFirst(bruto, 'codigo_projeto') ?? ''),
    numeroDocumento: String(getFirst(bruto, 'numero_documento') ?? ''),
    observacao: String(getFirst(bruto, 'observacao') ?? ''),
    dataAlteracaoOmie: parseDataOmie(getFirst(bruto, 'info', 'data_alteracao')) ?? null,
  };
}
