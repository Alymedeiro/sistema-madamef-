-- =============================================================================
-- 0002_agenda — agendamentos (Fase 1, Task 4)
--
-- Cria `agendamentos` com bloqueio de sobreposição por profissional no próprio
-- banco (exclusion constraint em tstzrange), troca o corpo de
-- public.cliente_vinculada() e protege, por trigger, o que a profissional pode
-- alterar no próprio atendimento.
--
-- Dependências: 0001_base (perfil_atual, colaborador_atual_id, set_atualizado_em,
-- clientes, colaboradores, servicos; extensão btree_gist no schema extensions).
-- =============================================================================

-- Tipos ----------------------------------------------------------------------
create type public.status_agendamento as enum (
  'pendente', 'confirmado', 'atendido', 'faltou', 'cancelado'
);
create type public.origem_agendamento as enum ('interno', 'online');

-- =============================================================================
-- 5.5 Agenda
-- =============================================================================

create table public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes (id),
  profissional_id uuid not null references public.colaboradores (id),
  servico_id uuid not null references public.servicos (id),
  inicio timestamptz not null,
  fim timestamptz not null,
  status public.status_agendamento not null default 'pendente',
  origem public.origem_agendamento not null default 'interno',
  -- FK para pacotes_vendidos é criada quando a tabela existir (fase de pacotes).
  pacote_vendido_id uuid,
  valor_previsto_centavos int not null default 0 check (valor_previsto_centavos >= 0),
  observacoes text,
  -- Preenchido pela integração com o Google Agenda (fase futura).
  google_event_id text,
  criado_por uuid references public.colaboradores (id)
    default public.colaborador_atual_id(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint agendamentos_intervalo_check check (fim > inicio),
  -- Uma profissional nunca tem dois agendamentos não cancelados sobrepostos.
  -- '[)': um atendimento que termina às 11:00 não colide com outro que começa às 11:00.
  -- Violação: SQLSTATE 23P01.
  constraint agendamentos_sem_sobreposicao exclude using gist (
    profissional_id extensions.gist_uuid_ops with =,
    tstzrange(inicio, fim, '[)') with &&
  ) where (status <> 'cancelado')
);
create index agendamentos_profissional_inicio_idx
  on public.agendamentos (profissional_id, inicio);
create index agendamentos_cliente_inicio_idx
  on public.agendamentos (cliente_id, inicio);

create trigger agendamentos_atualizado_em before update on public.agendamentos
  for each row execute function public.set_atualizado_em();

-- =============================================================================
-- Cliente vinculada: tem ao menos um agendamento (qualquer status) com o
-- colaborador logado. Substitui o stub de 0001 (assinatura e grants mantidos).
-- =============================================================================
create or replace function public.cliente_vinculada(p_cliente uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.agendamentos a
    where a.cliente_id = p_cliente
      and a.profissional_id = public.colaborador_atual_id()
  )
$$;

-- =============================================================================
-- Guarda da profissional (before update)
--
-- Profissional só altera `status` do próprio atendimento, e apenas para
-- confirmado, atendido ou faltou. Toda outra coluna deve permanecer igual
-- (comparação por to_jsonb: colunas futuras ficam protegidas automaticamente;
-- atualizado_em é ignorada porque set_atualizado_em() a renova antes, em ordem
-- alfabética de triggers). Dona e recepção não são restringidas aqui: as regras
-- de domínio delas ficam no app.
-- =============================================================================
create function public.agendamentos_guarda_profissional()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select public.perfil_atual()) = 'profissional' then
    if (to_jsonb(new) - 'status' - 'atualizado_em')
         is distinct from (to_jsonb(old) - 'status' - 'atualizado_em')
       or new.status not in ('confirmado', 'atendido', 'faltou')
    then
      raise exception 'Profissional só pode alterar o status do próprio atendimento'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.agendamentos_guarda_profissional()
  from public, anon, authenticated;

create trigger agendamentos_guarda_profissional before update on public.agendamentos
  for each row execute function public.agendamentos_guarda_profissional();

-- =============================================================================
-- RLS
-- =============================================================================
alter table public.agendamentos enable row level security;

-- select: dona e recepção veem todos; profissional só os próprios.
create policy agendamentos_select on public.agendamentos
  for select to authenticated
  using (
    (select public.perfil_atual()) in ('dona', 'recepcao')
    or (
      (select public.perfil_atual()) = 'profissional'
      and profissional_id = (select public.colaborador_atual_id())
    )
  );

-- insert: só dona e recepção.
create policy agendamentos_insert on public.agendamentos
  for insert to authenticated
  with check ((select public.perfil_atual()) in ('dona', 'recepcao'));

-- update: dona e recepção em todos; profissional só nos próprios (o que ela
-- pode mudar é limitado pelo trigger agendamentos_guarda_profissional).
create policy agendamentos_update on public.agendamentos
  for update to authenticated
  using (
    (select public.perfil_atual()) in ('dona', 'recepcao')
    or (
      (select public.perfil_atual()) = 'profissional'
      and profissional_id = (select public.colaborador_atual_id())
    )
  )
  with check (
    (select public.perfil_atual()) in ('dona', 'recepcao')
    or (
      (select public.perfil_atual()) = 'profissional'
      and profissional_id = (select public.colaborador_atual_id())
    )
  );

-- delete: sem política — ninguém exclui; cancelar = status 'cancelado'.
