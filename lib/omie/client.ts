/**
 * Cliente HTTP para a API Omie.
 *
 * Responsabilidades:
 *   - Autenticação (app_key + app_secret no corpo)
 *   - Paginação automática (async generator)
 *   - Retry com backoff em 429 e 500 transitórios
 *   - Captura de erros do Omie (faultstring)
 *   - Rate limit (respeita ~4 req/s)
 */

import type { OmieEndpoint } from './endpoints';

const BASE_URL = 'https://app.omie.com.br/api/v1';

const PAUSA_ENTRE_CHAMADAS_MS = 300;
const MAX_TENTATIVAS = 3;
const TIMEOUT_MS = 60_000;
const REG_POR_PAGINA = 500;

export class OmieError extends Error {
  constructor(
    message: string,
    public readonly codigo: string = '',
    public readonly endpoint: string = ''
  ) {
    super(message);
    this.name = 'OmieError';
  }
}

export class OmieRateLimitError extends OmieError {
  constructor(message: string, endpoint: string) {
    super(message, 'RATE_LIMIT', endpoint);
    this.name = 'OmieRateLimitError';
  }
}

export class OmieClient {
  constructor(
    private readonly appKey: string,
    private readonly appSecret: string
  ) {
    if (!appKey || !appSecret) {
      throw new Error('OMIE_APP_KEY e OMIE_APP_SECRET são obrigatórios');
    }
  }

  /**
   * Faz uma chamada única a um endpoint com retry.
   * Não vaza appSecret em erros.
   */
  async call(endpoint: OmieEndpoint, params: Record<string, unknown>): Promise<any> {
    const url = BASE_URL + endpoint.url;
    const payload = {
      call: endpoint.metodoListar,
      app_key: this.appKey,
      app_secret: this.appSecret,
      param: [params],
    };

    let ultimaExcecao: Error | null = null;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      const ctrl = new AbortController();
      const timeoutId = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
        clearTimeout(timeoutId);

        // Rate limit
        if (resp.status === 429) {
          const espera = 30_000 * tentativa;
          console.warn(
            `[omie] Rate limit em ${endpoint.nome} (tentativa ${tentativa}/${MAX_TENTATIVAS}). Aguardando ${espera}ms`
          );
          if (tentativa === MAX_TENTATIVAS) {
            throw new OmieRateLimitError(
              `Rate limit atingido em ${endpoint.nome}`,
              endpoint.nome
            );
          }
          await sleep(espera);
          continue;
        }

        if (resp.status === 200) {
          const data = (await resp.json()) as any;
          if (data && typeof data === 'object' && 'faultstring' in data) {
            throw new OmieError(
              String(data.faultstring ?? 'Erro Omie'),
              String(data.faultcode ?? ''),
              endpoint.nome
            );
          }
          return data;
        }

        // 500 do Omie pode trazer faultstring
        if (resp.status === 500) {
          let corpo: any = null;
          try {
            corpo = await resp.json();
          } catch {
            /* ignore */
          }
          if (corpo && corpo.faultstring) {
            throw new OmieError(
              `${corpo.faultcode ?? '500'}: ${corpo.faultstring}`,
              String(corpo.faultcode ?? '500'),
              endpoint.nome
            );
          }
          const texto = corpo ? JSON.stringify(corpo).slice(0, 300) : '';
          console.warn(
            `[omie] 500 em ${endpoint.nome} tentativa ${tentativa}/${MAX_TENTATIVAS}: ${texto}`
          );
          if (tentativa === MAX_TENTATIVAS) {
            throw new OmieError(
              `500 em ${endpoint.nome}: ${texto}`,
              '500',
              endpoint.nome
            );
          }
          await sleep(3000 * tentativa);
          continue;
        }

        // Outros HTTP errors
        const texto = await resp.text().catch(() => '');
        throw new OmieError(
          `HTTP ${resp.status} em ${endpoint.nome}: ${texto.slice(0, 200)}`,
          String(resp.status),
          endpoint.nome
        );
      } catch (e: unknown) {
        clearTimeout(timeoutId);
        if (e instanceof OmieError) throw e; // erros de negócio não retentam
        ultimaExcecao = e as Error;
        console.warn(
          `[omie] erro em ${endpoint.nome} tentativa ${tentativa}: ${(e as Error).message}`
        );
        if (tentativa < MAX_TENTATIVAS) {
          await sleep(5000);
        }
      }
    }

    throw new OmieError(
      `Falha após ${MAX_TENTATIVAS} tentativas em ${endpoint.nome}: ${
        ultimaExcecao?.message ?? 'desconhecido'
      }`,
      '',
      endpoint.nome
    );
  }

  /**
   * Listagem paginada. Yielda registro a registro.
   */
  async *listarPaginado(
    endpoint: OmieEndpoint,
    paramsExtra: Record<string, unknown> = {}
  ): AsyncGenerator<any> {
    let pagina = 1;
    let totalPaginas = 1;
    const paramsBase = { ...endpoint.paramsBase, ...paramsExtra };

    while (pagina <= totalPaginas) {
      const params = {
        ...paramsBase,
        [endpoint.campoPagina]: pagina,
        [endpoint.campoRegistrosPorPagina]: REG_POR_PAGINA,
      };

      const resposta = await this.call(endpoint, params);

      const t = resposta?.[endpoint.campoTotalPaginas];
      if (typeof t === 'number' && t > 0) totalPaginas = t;

      const lista = resposta?.[endpoint.campoListaResposta];
      if (Array.isArray(lista)) {
        for (const registro of lista) {
          yield registro;
        }
      }

      pagina += 1;
      if (pagina <= totalPaginas) {
        await sleep(PAUSA_ENTRE_CHAMADAS_MS);
      }
    }
  }

  /**
   * Retorna todos os registros de um endpoint como array.
   */
  async listarTodos(
    endpoint: OmieEndpoint,
    paramsExtra: Record<string, unknown> = {}
  ): Promise<any[]> {
    const resultado: any[] = [];
    for await (const reg of this.listarPaginado(endpoint, paramsExtra)) {
      resultado.push(reg);
    }
    return resultado;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
