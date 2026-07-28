/**
 * Transformers dos cadastros auxiliares.
 * JSON bruto do Omie → modelos internos.
 */
import { getFirst, parseDecimal } from './utils';
import type { ContaCorrente, Categoria, Cliente, Departamento } from './lancamentos';

export function transformarContaCorrente(bruto: any): ContaCorrente {
  const situacao = String(getFirst(bruto, 'cSituacao', 'ativo') ?? 'A').toUpperCase();
  return {
    codigo: String(getFirst(bruto, 'nCodCC', 'codigo') ?? ''),
    descricao: String(getFirst(bruto, 'descricao', 'cDescCC') ?? ''),
    tipo: String(getFirst(bruto, 'tipo_conta_corrente', 'tipo') ?? ''),
    saldoInicial: parseDecimal(getFirst(bruto, 'nSaldoInicial', 'saldo_inicial')),
    codigoBanco: String(getFirst(bruto, 'codigo_banco') ?? ''),
    ativo: situacao !== 'I',
  };
}

export function transformarCategoria(bruto: any): Categoria {
  const inativa = String(getFirst(bruto, 'conta_inativa') ?? 'N').toUpperCase();
  return {
    codigo: String(getFirst(bruto, 'codigo') ?? ''),
    descricao: String(getFirst(bruto, 'descricao') ?? ''),
    tipoCategoria: String(getFirst(bruto, 'tipo_categoria') ?? ''),
    natureza: String(getFirst(bruto, 'natureza') ?? ''),
    contaDre: String(getFirst(bruto, 'conta_dre') ?? ''),
    ativo: inativa !== 'S',
  };
}

export function transformarCliente(bruto: any): Cliente {
  const tags = Array.isArray(bruto?.tags) ? bruto.tags : [];
  const tagNames = tags
    .filter((t: any) => t && typeof t === 'object')
    .map((t: any) => String(t.tag ?? '').toLowerCase());

  let ehCliente = String(bruto?.cliente_ativo ?? '').toUpperCase() === 'S' || tagNames.includes('cliente');
  let ehFornecedor =
    String(bruto?.fornecedor_ativo ?? '').toUpperCase() === 'S' || tagNames.includes('fornecedor');
  if (!ehCliente && !ehFornecedor) {
    ehCliente = true;
    ehFornecedor = true;
  }

  const ddd = bruto?.telefone1_ddd ?? '';
  const num = bruto?.telefone1_numero ?? '';
  const telefone = num ? `${ddd}${num}`.trim() : '';

  const inativo = String(getFirst(bruto, 'inativo') ?? 'N').toUpperCase();

  return {
    codigo: String(getFirst(bruto, 'codigo_cliente_omie', 'codigo_cliente') ?? ''),
    nomeFantasia: String(getFirst(bruto, 'nome_fantasia') ?? ''),
    razaoSocial: String(getFirst(bruto, 'razao_social') ?? ''),
    cnpjCpf: String(getFirst(bruto, 'cnpj_cpf') ?? ''),
    email: String(getFirst(bruto, 'email') ?? ''),
    telefone,
    ehCliente,
    ehFornecedor,
    ativo: inativo !== 'S',
  };
}

export function transformarDepartamento(bruto: any): Departamento {
  const inativo = String(getFirst(bruto, 'inativo') ?? 'N').toUpperCase();
  return {
    codigo: String(getFirst(bruto, 'codigo', 'codigo_departamento') ?? ''),
    descricao: String(getFirst(bruto, 'descricao', 'nome') ?? ''),
    ativo: inativo !== 'S',
  };
}
