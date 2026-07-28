/**
 * Utilitários de parsing (datas, decimais, códigos).
 * Portados diretamente das regras já validadas no Python.
 */

/**
 * Parse de data Omie:
 *   - "DD/MM/YYYY"  → "YYYY-MM-DD"
 *   - "YYYY-MM-DD"  → mantém
 *   - vazio/null    → null
 */
export function parseDataOmie(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const s = String(valor).trim();

  // Formato brasileiro
  const brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  }
  // ISO
  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }
  return null;
}

/**
 * Parse de decimais aceitando formato brasileiro ("1.234,56") ou US ("1234.56").
 */
export function parseDecimal(valor: unknown): number {
  if (valor === null || valor === undefined || valor === '') return 0;
  if (typeof valor === 'number') return valor;
  let s = String(valor).trim();
  if (s === '') return 0;
  // BR: "1.234,56"
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

/**
 * Retorna o valor da primeira chave que tiver algum conteúdo (não vazio/null).
 */
export function getFirst<T = unknown>(
  obj: Record<string, any>,
  ...chaves: string[]
): T | undefined {
  for (const k of chaves) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v as T;
  }
  return undefined;
}

/**
 * Normalização de código de categoria.
 * Omie retorna: "1.01.01" ou "5.14.01" (sem zero à esquerda)
 * Dashboard espera: "01.01.01" ou "05.14.01"
 */
export function normalizarCodigoCategoria(cod: string | null | undefined): string {
  if (!cod) return '';
  return String(cod)
    .split('.')
    .map((p) => (/^\d$/.test(p) ? p.padStart(2, '0') : p))
    .join('.');
}

/**
 * Extrai o prefixo de 2 níveis de uma categoria.
 * "05.14.01 Descrição" → "05.14"
 * "1.01.01"            → "01.01"
 */
export function categoriaPrefixo(cat: string | null | undefined): string {
  if (!cat) return '';
  const bruto = String(cat).split(' ', 1)[0];
  const partes = bruto.split('.');
  if (partes.length >= 2) {
    return `${partes[0].padStart(2, '0')}.${partes[1].padStart(2, '0')}`;
  }
  return bruto.padStart(2, '0');
}
