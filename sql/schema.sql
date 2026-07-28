-- =============================================================================
-- Schema Supabase — Growper Dashboard
-- Rodar no SQL Editor do Supabase depois de criar o projeto.
-- =============================================================================

-- =============================================================================
-- Cadastros auxiliares
-- =============================================================================

create table if not exists cadastro_contas_correntes (
  codigo               text primary key,
  descricao            text not null default '',
  tipo                 text default '',
  saldo_inicial        numeric default 0,
  codigo_banco         text default '',
  ativo                boolean default true,
  atualizado_em        timestamptz default now()
);

create table if not exists cadastro_categorias (
  codigo               text primary key,
  descricao            text not null default '',
  tipo_categoria       text default '',
  natureza             text default '',
  conta_dre            text default '',
  ativo                boolean default true,
  atualizado_em        timestamptz default now()
);

create table if not exists cadastro_clientes (
  codigo               text primary key,
  nome_fantasia        text default '',
  razao_social         text default '',
  cnpj_cpf             text default '',
  email                text default '',
  telefone             text default '',
  eh_cliente           boolean default false,
  eh_fornecedor        boolean default false,
  ativo                boolean default true,
  atualizado_em        timestamptz default now()
);

create table if not exists cadastro_departamentos (
  codigo               text primary key,
  descricao            text default '',
  ativo                boolean default true,
  atualizado_em        timestamptz default now()
);

-- =============================================================================
-- Movimentos financeiros (visão de caixa)
-- =============================================================================

create table if not exists movimentos_financeiros (
  id_movimento         text primary key,
  id_titulo            text,
  tipo                 text,
  status               text,
  cancelado            boolean default false,
  data_pagto           date,
  data_registro        date,
  data_previsao        date,
  data_vencimento      date,
  valor_documento      numeric default 0,
  valor_pago           numeric default 0,
  conta_codigo         text,
  conta_nome           text default '',
  categoria_codigo     text,
  categoria_nome       text default '',
  cliente_codigo       text,
  cliente_nome         text default '',
  numero_documento     text default '',
  observacao           text default '',
  atualizado_em        timestamptz default now()
);

create index if not exists idx_mov_conta on movimentos_financeiros (conta_nome);
create index if not exists idx_mov_categoria on movimentos_financeiros (categoria_codigo);
create index if not exists idx_mov_data_pagto on movimentos_financeiros (data_pagto);

-- =============================================================================
-- Títulos (visão de competência)
-- =============================================================================

create table if not exists titulos (
  id_titulo            text primary key,
  origem               text,  -- 'CP' | 'CR'
  tipo                 text,
  status               text,
  cancelado            boolean default false,
  data_registro        date,
  data_previsao        date,
  data_vencimento      date,
  valor_documento      numeric default 0,
  valor_pago           numeric default 0,
  conta_codigo         text,
  conta_nome           text default '',
  categoria_codigo     text,
  categoria_nome       text default '',
  cliente_codigo       text,
  cliente_nome         text default '',
  departamento_codigo  text,
  departamento_nome    text default '',
  distribuicoes        jsonb default '[]'::jsonb,
  vendedor             text default '',
  projeto              text default '',
  numero_documento     text default '',
  observacao           text default '',
  data_alteracao_omie  timestamptz,
  atualizado_em        timestamptz default now()
);

create index if not exists idx_tit_origem on titulos (origem);
create index if not exists idx_tit_data_registro on titulos (data_registro);
create index if not exists idx_tit_categoria on titulos (categoria_codigo);
create index if not exists idx_tit_data_alt on titulos (data_alteracao_omie);

-- =============================================================================
-- Log de sincronização (auditoria)
-- =============================================================================

create table if not exists sync_log (
  id                   bigserial primary key,
  tipo                 text,  -- 'full' | 'incremental'
  endpoint             text,  -- ou 'ALL' para resumo geral
  iniciado_em          timestamptz default now(),
  finalizado_em        timestamptz,
  duracao_s            numeric,
  registros            integer default 0,
  paginas              integer default 0,
  status               text,  -- 'ok' | 'erro'
  erro                 text
);

create index if not exists idx_sync_log_iniciado on sync_log (iniciado_em desc);

-- =============================================================================
-- Metadata de sincronização (marca d'água para incremental)
-- =============================================================================

create table if not exists sync_metadata (
  chave                text primary key,
  valor                text,
  atualizado_em        timestamptz default now()
);

-- =============================================================================
-- Views prontas para o dashboard (matching formato RAW_DATA_CAIXA / COMP)
-- Regras portadas:
--   - Movimentos cancelados são excluídos (cancelado = true)
--   - Valor de despesa aparece negativo
--   - Categoria sem duplicação
-- =============================================================================

create or replace view v_raw_data_caixa as
select
  ''                        as departamento,
  categoria_nome            as categoria,
  cliente_nome              as fornecedor,
  tipo                      as tipo,
  conta_nome                as conta,
  status                    as conciliado,
  case when tipo = '2. Contas a Pagar' and valor_documento > 0
       then -valor_documento else valor_documento end as "valorConta",
  case when tipo = '2. Contas a Pagar' and valor_pago > 0
       then -valor_pago else valor_pago end as "valorPago",
  to_char(data_pagto, 'YYYY-MM')     as "mesPagto",
  to_char(data_registro, 'YYYY-MM')  as "mesRegistro",
  to_char(data_previsao, 'YYYY-MM')  as "mesPrevisao",
  to_char(data_pagto, 'YYYY-MM-DD')  as "dataPagto",
  ''                        as projeto,
  ''                        as vendedor
from movimentos_financeiros
where cancelado = false;

create or replace view v_raw_data_comp as
select
  departamento_nome                  as departamento,
  categoria_nome                     as categoria,
  cliente_nome                       as fornecedor,
  tipo                               as tipo,
  conta_nome                         as conta,
  status                             as conciliado,
  case when tipo = '2. Contas a Pagar' and valor_documento > 0
       then -valor_documento else valor_documento end as "valorConta",
  case when tipo = '2. Contas a Pagar' and valor_pago > 0
       then -valor_pago else valor_pago end as "valorPago",
  ''                                 as "mesPagto",
  to_char(data_registro, 'YYYY-MM')  as "mesRegistro",
  to_char(data_previsao, 'YYYY-MM')  as "mesPrevisao",
  ''                                 as "dataPagto",
  projeto                            as projeto,
  vendedor                           as vendedor
from titulos
where cancelado = false;
