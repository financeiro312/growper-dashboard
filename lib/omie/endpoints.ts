/**
 * Catálogo dos endpoints da API Omie utilizados.
 *
 * Cada endpoint declara URL, método principal e nomes de campos de paginação
 * (variam entre endpoints).
 */

export interface OmieEndpoint {
  nome: string;
  url: string;
  metodoListar: string;
  campoPagina: string;
  campoRegistrosPorPagina: string;
  campoTotalPaginas: string;
  campoListaResposta: string;
  paramsBase: Record<string, unknown>;
}

export const ENDPOINTS: Record<string, OmieEndpoint> = {
  // ------------------------ Movimentos Financeiros
  // ListarMovimentos: apenas paginação, sem filtro de data no request principal
  movimentos: {
    nome: 'movimentos',
    url: '/financas/mf/',
    metodoListar: 'ListarMovimentos',
    campoPagina: 'nPagina',
    campoRegistrosPorPagina: 'nRegPorPagina',
    campoTotalPaginas: 'nTotPaginas',
    campoListaResposta: 'movimentos',
    paramsBase: {},
  },

  // ------------------------ Contas a Pagar
  // Aceita filtro incremental via filtrar_apenas_registros_alterados
  contas_pagar: {
    nome: 'contas_pagar',
    url: '/financas/contapagar/',
    metodoListar: 'ListarContasPagar',
    campoPagina: 'pagina',
    campoRegistrosPorPagina: 'registros_por_pagina',
    campoTotalPaginas: 'total_de_paginas',
    campoListaResposta: 'conta_pagar_cadastro',
    paramsBase: { apenas_importado_api: 'N' },
  },

  // ------------------------ Contas a Receber
  contas_receber: {
    nome: 'contas_receber',
    url: '/financas/contareceber/',
    metodoListar: 'ListarContasReceber',
    campoPagina: 'pagina',
    campoRegistrosPorPagina: 'registros_por_pagina',
    campoTotalPaginas: 'total_de_paginas',
    campoListaResposta: 'conta_receber_cadastro',
    paramsBase: { apenas_importado_api: 'N' },
  },

  // ------------------------ Cadastros auxiliares
  contas_correntes: {
    nome: 'contas_correntes',
    url: '/geral/contacorrente/',
    metodoListar: 'ListarContasCorrentes',
    campoPagina: 'pagina',
    campoRegistrosPorPagina: 'registros_por_pagina',
    campoTotalPaginas: 'total_de_paginas',
    campoListaResposta: 'ListarContasCorrentes',
    paramsBase: {},
  },

  categorias: {
    nome: 'categorias',
    url: '/geral/categorias/',
    metodoListar: 'ListarCategorias',
    campoPagina: 'pagina',
    campoRegistrosPorPagina: 'registros_por_pagina',
    campoTotalPaginas: 'total_de_paginas',
    campoListaResposta: 'categoria_cadastro',
    paramsBase: {},
  },

  clientes: {
    nome: 'clientes',
    url: '/geral/clientes/',
    metodoListar: 'ListarClientes',
    campoPagina: 'pagina',
    campoRegistrosPorPagina: 'registros_por_pagina',
    campoTotalPaginas: 'total_de_paginas',
    campoListaResposta: 'clientes_cadastro',
    paramsBase: { apenas_importado_api: 'N' },
  },

  departamentos: {
    nome: 'departamentos',
    url: '/geral/departamentos/',
    metodoListar: 'ListarDepartamentos',
    campoPagina: 'pagina',
    campoRegistrosPorPagina: 'registros_por_pagina',
    campoTotalPaginas: 'total_de_paginas',
    campoListaResposta: 'departamentos',
    paramsBase: {},
  },
};
