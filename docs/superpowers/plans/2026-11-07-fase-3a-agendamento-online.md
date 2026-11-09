# Fase 3A — Agendamento online com aprovação: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página pública `/agendar` onde a cliente pede um horário; o pedido segura o horário por 24h, aparece no Início e na agenda (🟡) e a recepção aprova (vira agendamento confirmado) ou recusa, avisando a cliente por um botão de WhatsApp com a mensagem pronta.

**Architecture:** Pedidos ficam na tabela própria `pedidos_online` (não criam cliente nem agendamento antes da aprovação). O papel `anon` não toca em nada: a página pública chama duas Server Actions que validam entrada, Turnstile e limite, e só então usam `createAdminClient()` para chamar RPCs `security definer` restritas a `service_role`. Toda regra de horário livre e de corrida mora no Postgres (trava por profissional + exclusion constraint); a mesma regra existe em TypeScript puro para a tela e para os testes.

**Tech Stack:** o das Fases 1–2 (Next.js 15.5, React 19, TypeScript strict, Tailwind 4, componentes shadcn à mão, `@supabase/ssr`, zod 4, `@date-fns/tz`, Vitest, Playwright, `pg`). Sem dependência nova: Turnstile é carregado por `<script src="https://challenges.cloudflare.com/turnstile/v0/api.js">` e verificado com `fetch`.

**Spec:** `docs/superpowers/specs/2026-11-07-fase-3a-agendamento-online-design.md` (autoridade), com a spec geral §5.5 e §6.5.

## Global Constraints

- Tudo das Global Constraints das Fases 1 e 2 continua valendo (pt-BR, fuso `America/Sao_Paulo`, centavos inteiros, perfis `dona | recepcao | profissional`, RLS em toda tabela, toque ≥ 44 px, viewports 1440/1024/390, testes de banco com `pnpm test:db` contra Postgres local + `shim.sql` só de teste, `tipos.ts` à mão atualizado na mesma tarefa da migração).
- Migração nova única: `supabase/migrations/0009_agendamento_online.sql` (Tasks 1 e 2 escrevem nela; ainda não aplicada em lugar nenhum). Funções novas: `set search_path = ''`, nomes qualificados, `revoke execute ... from public, anon, authenticated` e `grant` só ao papel que chama (`service_role` para as públicas, `authenticated` para aprovar/recusar/ler).
- `anon` **não** recebe nenhum privilégio em `pedidos_online` nem execução de função nova.
- Passo dos horários: **15 min** (`PASSO_MIN` de `src/features/agenda/grade.ts`). Reserva: **24 h** (`RESERVA_HORAS = 24`). Retenção: **90 dias** para pedidos não aprovados. Limites: **3** pedidos `aguardando` por WhatsApp; **5** pedidos por hora por `ip_hash`. Antecedência: `configuracoes_clinica.online_antecedencia_min_horas` (padrão 2) e `online_antecedencia_max_dias` (padrão 60).
- Pedido "vencido" = `status = 'aguardando' and criado_em <= now() - interval '24 hours'`. Vencido nunca bloqueia horário, em nenhuma função ou gatilho.
- Mensagens de erro exatas (P0001):
  - `Esse horário acabou de ser reservado, escolha outro.`
  - `Você já tem 3 pedidos aguardando resposta. Aguarde o retorno da clínica.`
  - `Muitas tentativas. Tente novamente mais tarde.`
  - `Agendamento online indisponível no momento.`
  - `Este pedido já foi respondido.`
  - `Há um pedido online neste horário. Aprove ou recuse o pedido primeiro.`
  - Turnstile (só no servidor): `Não foi possível confirmar que você não é um robô.`
- Textos das mensagens de WhatsApp (exatos, `{site}` = `NEXT_PUBLIC_SITE_URL`):
  - Aprovado: `Oi, {primeiro nome}! Seu horário de {serviço} com {profissional} está confirmado para {dd/mm} às {hh:mm}. Madame Fê Clinic`
  - Recusado: `Oi, {primeiro nome}! Infelizmente o horário pedido para {serviço} não está disponível. Você pode escolher outro em {site}/agendar ou responder esta mensagem.`
- Variáveis novas: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`. Sem `TURNSTILE_SECRET_KEY` a verificação é pulada (com `console.warn`). Chaves de teste oficiais da Cloudflare no Playwright: site `1x00000000000000000000AA`, secreta `1x0000000000000000000000000000000AA`.
- `ip_hash` = HMAC-SHA256 hex do IP (`x-forwarded-for`, primeiro item) com chave `SUPABASE_SERVICE_ROLE_KEY`; o IP nunca é gravado.
- `pg_cron` não existe no Postgres local: a migração cria o agendamento diário (`0 6 * * *` UTC = 03:00 São Paulo) dentro de um `do $$ ... $$` que só age se `pg_available_extensions` tiver `pg_cron`.
- **Não aplicar 0009 na produção** neste plano; só no projeto de testes `myfpjwtmfonuvsrsvato` (Task 8).

## Review Focus

1. **Pedido vencido (mais de 24h) ainda com status `aguardando`** no horário que outra cliente quer: deve estar livre em `horarios_livres_online`, aceito em `criar_pedido_online` (que expira antes de inserir, senão a exclusion constraint recusa) e não bloquear agendamento interno → testes em Tasks 1 e 2.
2. **"Qualquer uma" com uma profissional livre e outra ocupada**: o horário aparece e o pedido vai para a livre; com as duas ocupadas, "Esse horário acabou de ser reservado…" → testes em Tasks 2 e 3.
3. **Virada de dia e antecedência** (pedido às 23h para amanhã 00:30 com mínimo 2h; dia = hoje + 60 dias; dia 61): horários antes do mínimo somem, dia 61 não lista nada → testes em Task 3 (TS) e Task 2 (SQL) com os mesmos casos.
4. **Aprovar com horário alterado para cima de um agendamento existente, ou aprovar duas vezes (duplo toque)**: a sobreposição falha com a mensagem da agenda; o segundo aprovar recebe "Este pedido já foi respondido." e não cria dois agendamentos → testes em Task 2 e Task 5.
5. **WhatsApp digitado com máscara, sem DDD ou com 0 na frente** (`(11) 9 8765-4321`, `011987654321`, `98765-4321`): normalizado por `normalizarWhatsApp` ou recusado com mensagem clara antes de chegar ao banco; o limite de 3 conta o mesmo número em formatos diferentes → testes em Task 3.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0009_agendamento_online.sql` | config, tabela, RLS, gatilho, funções, cron |
| `supabase/tests/09_agendamento_online.db.test.ts` | testes de banco da 3A |
| `src/lib/supabase/tipos.ts` | tipos de `pedidos_online`, colunas novas e RPCs |
| `src/lib/dominio/online.ts` (+ `.test.ts`) | horários livres puro, mensagens, link `wa.me`, `pedidoSchema` |
| `src/lib/online/turnstile.ts` (+ `.test.ts`) | verificação do token no servidor |
| `src/lib/online/ip.ts` (+ `.test.ts`) | `ipHash(headers)` |
| `src/app/agendar/page.tsx`, `layout.tsx`, `actions.ts` (+ `.test.ts`) | página pública e as duas ações |
| `src/features/online/*` | passos do formulário público (cliente) |
| `src/app/(app)/agenda/pedidos/page.tsx`, `actions.ts` (+ `.test.ts`) | lista e aprovar/recusar |
| `src/features/pedidos/*` | lista, diálogo de aprovação, botão WhatsApp |
| `src/features/inicio/dados.ts`, `cartoes.tsx`, `src/app/(app)/inicio/page.tsx` | card "Pedidos online aguardando" |
| `src/features/agenda/dados-agenda.ts`, `coluna-agenda.tsx`, `src/app/(app)/agenda/dados.ts` | bloco 🟡 na agenda |
| `src/app/(app)/configuracoes/*`, `src/features/configuracoes/formulario-configuracoes.tsx` | seção "Agendamento online" |
| `src/lib/auth/rotas.ts` | `/agendar` pública |
| `e2e/agendar.spec.ts`, `playwright.config.ts` | fluxos de tela |
| `docs/implantacao.md`, `.env.example`, `README.md` | Fase 3A |

---

### Task 1: Banco — tabela `pedidos_online`, configurações, gatilho e limpeza

**Files:**
- Create: `supabase/migrations/0009_agendamento_online.sql` (seções 1–4)
- Create: `supabase/tests/09_agendamento_online.db.test.ts`
- Modify: `src/lib/supabase/tipos.ts`

**Interfaces:**
- Produces:
  - `configuracoes_clinica.online_ativo boolean not null default false`, `online_aviso_privacidade text not null default '<texto abaixo>'`.
  - `create type public.status_pedido_online as enum ('aguardando','aprovado','recusado','expirado')`.
  - Tabela `public.pedidos_online` com as colunas da spec §5.2: `servico_id` (FK servicos), `profissional_escolhida_id` (FK colaboradores, null), `profissional_id` (FK, not null), `inicio`, `fim` (`fim > inicio`), `avaliacao bool not null default false`, `nome text` (null após limpeza; check 2–80 quando não nulo), `whatsapp text` (null após limpeza; check `^\d{12,13}$` quando não nulo), `status`, `motivo_recusa text check (char_length <= 200)`, `agendamento_id` (FK, unique), `decidido_por` (FK colaboradores), `decidido_em`, `aceite_privacidade_em timestamptz not null`, `ip_hash text not null`, `criado_em`, `atualizado_em`, `dados_apagados_em`. Índices em todas as FKs, em `(whatsapp) where status='aguardando'`, `(ip_hash, criado_em)`, `(status, criado_em)`.
  - Exclusion constraint `pedidos_online_sem_sobreposicao` `exclude using gist (profissional_id with =, tstzrange(inicio, fim) with &&) where (status = 'aguardando')`.
  - `public.pedido_vencido(p public.pedidos_online) returns boolean` (immutable-safe: `stable`) — usada por tudo.
  - `public.expirar_pedidos_online() returns int` — `security definer`; grava `expirado` nos vencidos; execute para `authenticated` e `service_role`.
  - `public.apagar_dados_pedidos_antigos() returns int` — definer; `nome = null, whatsapp = null, dados_apagados_em = now()` em pedidos `status <> 'aprovado'` com `criado_em < now() - interval '90 days'` e `dados_apagados_em is null`; só `service_role`/`postgres`.
  - Gatilho `agendamentos_pedido_online` (before insert or update of `inicio`,`fim`,`profissional_id`,`status`, quando `new.status <> 'cancelado'`): P0001 `Há um pedido online neste horário. Aprove ou recuse o pedido primeiro.` se existir pedido `aguardando` não vencido da mesma profissional sobreposto.
  - RLS: `pedidos_online` com RLS ligado; `revoke all ... from anon`; `revoke insert, update, delete, truncate ... from authenticated`; política `pedidos_online_select` `using ((select public.perfil_atual()) in ('dona','recepcao'))`.
  - `public.pedidos_online_da_agenda(p_de timestamptz, p_ate timestamptz) returns table (id uuid, profissional_id uuid, servico_id uuid, inicio timestamptz, fim timestamptz, primeiro_nome text, avaliacao boolean)` — definer; só `aguardando` não vencidos; dona/recepção veem todos, profissional só `profissional_id = colaborador_atual_id()`; sem `whatsapp`.
  - Cron condicional (Global Constraints) chamando `expirar_pedidos_online()` e `apagar_dados_pedidos_antigos()`; job name `pedidos_online_limpeza`.
- Texto padrão do aviso: `Usamos seu nome e WhatsApp só para responder este pedido de horário. Se o pedido não virar atendimento, apagamos esses dados em até 90 dias.`

- [ ] **Step 1: Escrever os testes de banco (falhando)** em `09_agendamento_online.db.test.ts`, no padrão de `08_ajustes_fase2.db.test.ts`:
  - `anon não lê nem grava pedidos_online` (select → 0 linhas ou 42501; insert → 42501).
  - `recepção lê pedidos; profissional não lê a tabela (0 linhas)`.
  - `authenticated não insere/atualiza/apaga pedidos_online` → 42501.
  - `dois pedidos aguardando sobrepostos da mesma profissional → 23P01`; `o mesmo horário com o primeiro recusado → ok`.
  - `pedido vencido não bloqueia agendamento interno`; `pedido aguardando não vencido bloqueia com a mensagem exata`; `agendamento cancelado sobre o pedido passa`.
  - `expirar_pedidos_online grava expirado só nos vencidos e devolve a contagem`.
  - `apagar_dados_pedidos_antigos limpa nome/whatsapp de recusado/expirado com 91 dias e mantém aprovado e o de 89 dias`.
  - `pedidos_online_da_agenda: profissional vê só os próprios, sem whatsapp; vencido não aparece`.
  - `configuracoes_clinica tem online_ativo = false e o aviso padrão`.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm test:db supabase/tests/09_agendamento_online.db.test.ts` → FAIL (relação `pedidos_online` não existe).
- [ ] **Step 3: Escrever as seções 1–4 de `0009_agendamento_online.sql`** com o que está em Interfaces; atualizar `tipos.ts` (tabela, enum, colunas de config, as três funções).
- [ ] **Step 4: Rodar** — `pnpm test:db` → PASS (todos os arquivos, sem regressão nos 01–08); `pnpm typecheck` → limpo.
- [ ] **Step 5: Commit** — `feat(db): pedidos online — tabela, reserva, gatilho na agenda e limpeza LGPD (0009)`.

### Task 2: Banco — horários livres, criar, aprovar e recusar

**Files:**
- Modify: `supabase/migrations/0009_agendamento_online.sql` (seções 5–7)
- Modify: `supabase/tests/09_agendamento_online.db.test.ts`
- Modify: `src/lib/supabase/tipos.ts`

**Interfaces:**
- Consumes: Task 1 (tabela, `pedido_vencido`, `expirar_pedidos_online`).
- Produces (todas `security definer`):
  - `public.horarios_livres_online(p_servico uuid, p_profissional uuid, p_dia date) returns table (inicio timestamptz, profissional_id uuid)` — só `service_role`. `p_profissional null` = qualquer uma (uma linha por horário, com a primeira profissional livre por `nome`). Vazio se `online_ativo = false`, serviço inativo ou sem `permite_online`, ou `p_dia` fora de [hoje, hoje + `online_antecedencia_max_dias`]. Horários a cada 15 min dentro de cada intervalo de `jornadas` do dia da semana, com `inicio + duracao <= fim do intervalo`, `inicio >= now() + online_antecedencia_min_horas`, sem sobreposição com agendamento não cancelado, bloqueio ou pedido `aguardando` não vencido. Profissional precisa estar ativa e ter o serviço em `colaborador_servicos`.
  - `public.criar_pedido_online(p_servico uuid, p_profissional uuid, p_inicio timestamptz, p_nome text, p_whatsapp text, p_ip_hash text) returns uuid` — só `service_role`. Ordem: `online_ativo` (senão `Agendamento online indisponível no momento.`); limite por `ip_hash` (≥ 5 com `criado_em > now() - 1h` → `Muitas tentativas…`); `expirar_pedidos_online()`; limite por WhatsApp (≥ 3 aguardando → `Você já tem 3 pedidos…`); `pg_advisory_xact_lock(hashtext('agenda:' || profissional))` para cada candidata em ordem de nome; escolhe a primeira para a qual `p_inicio` está em `horarios_livres_online`; nenhuma → `Esse horário acabou de ser reservado, escolha outro.`; grava `avaliacao = servicos.exige_avaliacao`, `fim = p_inicio + duracao`, `aceite_privacidade_em = now()`, `profissional_escolhida_id = p_profissional`. Erro 23P01 da constraint (corrida) também vira a mensagem "acabou de ser reservado".
  - `public.aprovar_pedido_online(p_pedido uuid, p_cliente uuid, p_profissional uuid, p_inicio timestamptz, p_fim timestamptz, p_valor_centavos int) returns uuid` (id do agendamento) — `authenticated`, só dona/recepção (`Apenas a dona ou a recepção podem responder pedidos`). `select ... for update` do pedido; não `aguardando` ou vencido → `Este pedido já foi respondido.`; marca `aprovado`, `decidido_por`, `decidido_em`; insere `agendamentos` (`status 'confirmado'`, `origem 'online'`, `criado_por = colaborador_atual_id()`); grava `agendamento_id`. Sobreposição de agenda propaga o erro existente (23P01 → mensagem da agenda via `mensagemErroBanco`).
  - `public.recusar_pedido_online(p_pedido uuid, p_motivo text) returns void` — mesmas regras de perfil e de "já respondido"; `recusado`, motivo `trim` ou null.
- `mensagemErroBanco` (`src/lib/erros-db.ts`): mapear 23P01 com constraint `pedidos_online_sem_sobreposicao` → `Esse horário acabou de ser reservado, escolha outro.`

- [ ] **Step 1: Testes de banco (falhando)**, criando jornada seg 09:00–12:00 e serviço de 60 min, relógio controlado com datas futuras fixas:
  - `horarios_livres_online lista 09:00…11:00 de 15 em 15` e `some o horário de agendamento, bloqueio e pedido aguardando; volta com pedido vencido`.
  - `qualquer uma: devolve a profissional livre quando a outra está ocupada`.
  - `antecedência: nada antes de now()+2h; dia hoje+61 vazio; online_ativo=false vazio; serviço sem permite_online vazio`.
  - `criar_pedido_online: corrida em duas conexões no mesmo horário → um uuid e um erro "acabou de ser reservado"`.
  - `criar_pedido_online: 4º aguardando do mesmo WhatsApp falha; 6º do mesmo ip_hash na hora falha`.
  - `criar_pedido_online sobre pedido vencido → ok (vencido vira expirado)`.
  - `criar_pedido_online marca avaliacao=true quando o serviço exige avaliação`.
  - `aprovar: cria agendamento confirmado origem online e liga ao pedido; segundo aprovar → "Este pedido já foi respondido."; profissional → recusado; anon não executa`.
  - `aprovar para horário com agendamento existente → 23P01 e pedido continua aguardando`.
  - `recusar libera o horário (novo pedido no mesmo horário passa)`.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm test:db supabase/tests/09_agendamento_online.db.test.ts` → FAIL (função não existe).
- [ ] **Step 3: Implementar seções 5–7 da 0009, `tipos.ts` e o mapeamento em `erros-db.ts`** (+ teste em `src/lib/erros-db.test.ts`).
- [ ] **Step 4: Rodar** — `pnpm test:db` e `pnpm test` → PASS.
- [ ] **Step 5: Commit** — `feat(db): horários livres, pedido online com trava e aprovação/recusa (0009)`.

### Task 3: Regras puras, Turnstile e hash do IP

**Files:**
- Create: `src/lib/dominio/online.ts`, `src/lib/dominio/online.test.ts`
- Create: `src/lib/online/turnstile.ts`, `src/lib/online/turnstile.test.ts`, `src/lib/online/ip.ts`, `src/lib/online/ip.test.ts`

**Interfaces:**
- Produces (`src/lib/dominio/online.ts`):
  - `RESERVA_HORAS = 24`
  - `type ContextoOnline = { agora: Date; dia: string /* yyyy-mm-dd SP */; duracaoMin: number; antecedenciaMinHoras: number; antecedenciaMaxDias: number; profissionais: { id: string; nome: string; jornadas: JornadaLinha[]; ocupados: { inicio: Date; fim: Date }[] }[] }` — `ocupados` já junta agendamentos não cancelados, bloqueios e pedidos aguardando não vencidos.
  - `horariosLivres(ctx: ContextoOnline): { inicio: Date; profissionalId: string }[]` — mesma regra do SQL (Task 2), ordenado por horário, uma entrada por horário com a primeira profissional livre por nome.
  - `diasDisponiveis(agora: Date, antecedenciaMaxDias: number): string[]` — de hoje (SP) até hoje + max.
  - `mensagemAprovado(p: { nome: string; servico: string; profissional: string; inicio: Date }): string` e `mensagemRecusado(p: { nome: string; servico: string; site: string }): string` — textos exatos das Global Constraints (primeiro nome; `dd/MM` e `HH:mm` em SP).
  - `linkWhatsApp(numero: string, texto: string): string` → `https://wa.me/<numero>?text=<encodeURIComponent(texto)>`.
  - `pedidoSchema` (zod): `{ servicoId: uuid, profissionalId: uuid | null, inicio: string ISO, nome: trim 2–80, whatsapp: string → normalizarWhatsApp (erro "Informe um WhatsApp com DDD."), aceite: literal true ("Aceite o aviso de privacidade para continuar."), token: string }`.
- Produces (`src/lib/online/`):
  - `verificarTurnstile(token: string, ip: string | null): Promise<boolean>` — POST `https://challenges.cloudflare.com/turnstile/v0/siteverify` (`secret`, `response`, `remoteip`); sem `TURNSTILE_SECRET_KEY` → `true` + `console.warn`; erro de rede → `false`.
  - `ipHash(cabecalhos: Headers): string` — Global Constraints; sem IP → hash de `"desconhecido"`.

- [ ] **Step 1: Testes (falhando):**
  - `horariosLivres` com os mesmos casos da Task 2 (lista 09:00–11:00; ocupado some; serviço não cabe no fim; antecedência em virada de dia 23:00 → 00:30 bloqueado com mín. 2h; qualquer uma escolhe a livre por nome; jornada com dois intervalos 09–12 e 14–18).
  - `diasDisponiveis(agora, 60)` tem 61 itens, o primeiro é hoje em SP mesmo às 23:30 UTC−3.
  - `mensagemAprovado` → `"Oi, Maria! Seu horário de Limpeza de pele com Ana está confirmado para 12/11 às 14:00. Madame Fê Clinic"` para nome `"Maria Silva"`, profissional `"Ana"`, início 2026-11-12T17:00Z.
  - `mensagemRecusado` com `site = "https://sistema-madamef.vercel.app"` contém `https://sistema-madamef.vercel.app/agendar`.
  - `linkWhatsApp("5511987654321", "Oi, Maria!")` = `https://wa.me/5511987654321?text=Oi%2C%20Maria!`.
  - `pedidoSchema`: aceita `(11) 9 8765-4321` → `5511987654321`; recusa `98765-4321` com "Informe um WhatsApp com DDD."; recusa `aceite: false`; recusa nome de 1 letra.
  - `verificarTurnstile` com `fetch` simulado: `success: true` → true; `false` → false; rede falha → false; sem segredo → true.
  - `ipHash` igual para o mesmo IP, diferente para IPs diferentes, usa o primeiro de `x-forwarded-for`, não contém o IP.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/lib/dominio/online.test.ts src/lib/online` → FAIL.
- [ ] **Step 3: Implementar** os três arquivos (reusar `normalizarWhatsApp`, `combinarDataHora`, `formatarNoFuso`, `diaDaSemanaNoFuso`, `PASSO_MIN`).
- [ ] **Step 4: Rodar** — `pnpm test` → PASS; `pnpm lint && pnpm typecheck` → limpo.
- [ ] **Step 5: Commit** — `feat(online): regras de horários livres, mensagens, Turnstile e hash do IP`.

### Task 4: Página pública `/agendar`

**Files:**
- Create: `src/app/agendar/layout.tsx`, `page.tsx`, `actions.ts`, `actions.test.ts`
- Create: `src/features/online/formulario-agendar.tsx`, `passo-servico.tsx`, `passo-profissional.tsx`, `passo-horario.tsx`, `passo-dados.tsx`, `turnstile.tsx`
- Modify: `src/lib/auth/rotas.ts` (+ teste existente), `.env.example`

**Interfaces:**
- Consumes: Task 2 RPCs via `createAdminClient()`; Task 3 `pedidoSchema`, `diasDisponiveis`, `verificarTurnstile`, `ipHash`.
- Produces:
  - `page.tsx` (Server Component, `dynamic = "force-dynamic"`): lê com o admin client `configuracoes_clinica` (nome, telefone, `online_ativo`, aviso, antecedências), serviços ativos com `permite_online` (id, nome, duração, `exige_avaliacao`) e profissionais ativas com os serviços que realizam (id, primeiro nome). Nada além disso vai para o cliente. Desligada → `Agendamento online indisponível no momento. Fale com a clínica: {telefone}`.
  - `buscarHorarios(e: { servicoId: string; profissionalId: string | null; dia: string }): Promise<{ ok: true; horarios: { inicio: string }[] } | { ok: false; erro: string }>` — valida (zod), chama `horarios_livres_online`, devolve só `inicio`.
  - `enviarPedido(e: z.input<typeof pedidoSchema>): Promise<{ ok: true; resumo: { servico: string; profissional: string; inicio: string } } | { ok: false; erro: string }>` — valida; `verificarTurnstile` (falha → mensagem exata); `ipHash(await headers())`; chama `criar_pedido_online`; erro → `mensagemErroBanco`.
  - Serviço com `exige_avaliacao` aparece como `Agendar avaliação de {nome}`; profissional "Qualquer uma" envia `null`.
  - Tela final: `Pedido recebido! A Madame Fê Clinic vai te responder pelo WhatsApp em breve.` + resumo.
  - `rotas.ts`: `/agendar` em `PUBLICAS`.

- [ ] **Step 1: Testes (falhando)** em `actions.test.ts` com `src/test/supabase-falso.ts` e `verificarTurnstile` simulado:
  - `buscarHorarios recusa servicoId inválido sem chamar o banco`; `devolve só inicio`.
  - `enviarPedido recusa sem aceite sem chamar o banco`; `Turnstile falso → "Não foi possível confirmar que você não é um robô." sem chamar o banco`; `envia whatsapp normalizado e ip_hash`; `P0001 do banco vira a mensagem do banco`; `23P01 da constraint → "Esse horário acabou de ser reservado, escolha outro."`.
  - `rotas.test.ts`: `ehRotaPublica("/agendar")` e `("/agendar/x")` → true; `/agendarx` → false.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/app/agendar src/lib/auth` → FAIL.
- [ ] **Step 3: Implementar** ações, página, componentes dos passos (estado no cliente; ao trocar serviço ou profissional, limpa dia/horário; calendário por botões de dia; horários em grade de botões ≥ 44 px) e o widget Turnstile (script carregado uma vez; sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY` não renderiza e envia token vazio).
- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → PASS; conferir no build que `/agendar` é rota dinâmica.
- [ ] **Step 5: Commit** — `feat(agendar): página pública de pedido de horário com Turnstile e limites`.

### Task 5: Recepção — lista de pedidos, aprovar, recusar e card no Início

**Files:**
- Create: `src/app/(app)/agenda/pedidos/page.tsx`, `actions.ts`, `actions.test.ts`
- Create: `src/features/pedidos/lista-pedidos.tsx`, `dialogo-aprovar.tsx`, `botao-whatsapp.tsx`, `dados.ts`, `dados.test.ts`
- Modify: `src/features/inicio/dados.ts`, `src/features/inicio/cartoes.tsx`, `src/app/(app)/inicio/page.tsx`

**Interfaces:**
- Consumes: Task 2 (`aprovar_pedido_online`, `recusar_pedido_online`, `expirar_pedidos_online`); Task 3 (`mensagemAprovado`, `mensagemRecusado`, `linkWhatsApp`, `RESERVA_HORAS`); `aprovarProposta` de `src/app/(app)/agenda/regras.ts` (mesma validação da agenda, inclusive encaixe fora da jornada com `forcarForaJornada`).
- Produces:
  - `listarPedidos(supabase, status: StatusPedido): Promise<PedidoLista[]>` em `features/pedidos/dados.ts`, chamando `expirar_pedidos_online()` antes; `PedidoLista = { id; nome; whatsapp; servicoId; servicoNome; profissionalId; profissionalNome; inicio; fim; avaliacao; status; criadoEm; expiraEm; agendamentoId; motivoRecusa }`.
  - `clientesPorTelefone(supabase, whatsapp: string): Promise<{ id: string; nome: string }[]>`.
  - Ações (todas `exigirPerfil("dona","recepcao")`):
    - `aprovarPedido(e: { pedidoId; clienteId: string | null; novaCliente?: { nome; whatsapp }; profissionalId; data; hora; forcarForaJornada?: boolean }): Promise<{ ok: true; agendamentoId: string; mensagem: string; link: string } | { ok: false; erro: string } | { ok: false; aviso: "fora_da_jornada"; erro: string }>` — cria a cliente nova (com `aceite_lgpd_em` = `aceite_privacidade_em` do pedido) quando `clienteId` é null, valida com `aprovarProposta`, chama a RPC com o valor do serviço.
    - `recusarPedido(e: { pedidoId; motivo?: string }): Promise<{ ok: true; mensagem: string; link: string } | { ok: false; erro: string }>`.
  - Início: `pedidosAguardando(supabase): Promise<{ id; nome; servicoNome; inicio; expiraEm }[]>` e card `Pedidos online aguardando (N)` com link `/agenda/pedidos` (só dona/recepção).
- [ ] **Step 1: Testes (falhando):**
  - `aprovarPedido`: profissional → negado; com cliente existente chama a RPC com o valor do serviço; sem cliente cria a cliente com aceite LGPD do pedido e depois aprova; aviso fora da jornada devolve `aviso` e não chama a RPC; erro "Este pedido já foi respondido." repassado; `link` começa com `https://wa.me/55` e contém o texto de `mensagemAprovado`.
  - `recusarPedido`: motivo com 201 caracteres recusado; sucesso devolve link com `mensagemRecusado`.
  - `listarPedidos` chama `expirar_pedidos_online` antes de ler e calcula `expiraEm = criadoEm + 24h`.
  - `clientesPorTelefone` busca pelo número normalizado.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/app/(app)/agenda/pedidos src/features/pedidos src/features/inicio` → FAIL.
- [ ] **Step 3: Implementar** página (abas por status, aguardando por padrão, mais antigo primeiro, tempo restante), diálogo de aprovação (sugestão "É a {nome} (cadastrada)?", cadastro rápido pré-preenchido, troca de profissional/horário, confirmação de encaixe), recusa com motivo opcional, `botao-whatsapp.tsx` (abre `link` em nova aba após aprovar/recusar) e o card do Início.
- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm lint`, `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(pedidos): aprovar e recusar pedidos online, aviso por WhatsApp e card no Início`.

### Task 6: Agenda — bloco 🟡 do pedido

**Files:**
- Modify: `src/features/agenda/dados-agenda.ts` (+ teste), `src/app/(app)/agenda/dados.ts`, `src/features/agenda/coluna-agenda.tsx`, `src/features/agenda/grade-semana.tsx`

**Interfaces:**
- Consumes: Task 1 `pedidos_online_da_agenda`.
- Produces: `DadosAgenda.pedidos: PedidoAgenda[]` com `PedidoAgenda = { id: string; profissionalId: string; servicoId: string; inicio: string; fim: string; primeiroNome: string; avaliacao: boolean }`. Bloco amarelo (cor de `pendente` em `COR_STATUS`) `Pedido online — {primeiroNome}` (`Avaliação — {primeiroNome}` quando `avaliacao`), ocupa o horário na grade (entra em `distribuirEmFaixas` e em `intervalosOcupados`), toque leva a `/agenda/pedidos?pedido=<id>` para dona/recepção e não faz nada para profissional.
- [ ] **Step 1: Testes (falhando)** em `dados-agenda.test.ts`: `montarDadosAgenda inclui pedidos com primeiro nome`; `horário com pedido conta como ocupado para novo agendamento`.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/features/agenda` → FAIL.
- [ ] **Step 3: Implementar** a leitura em `carregarAgenda` (mesmo intervalo da visão) e o bloco nas grades dia e semana.
- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(agenda): pedidos online aguardando aparecem como bloco 🟡`.

### Task 7: Configurações — seção "Agendamento online"

**Files:**
- Modify: `src/app/(app)/configuracoes/schemas.ts` (+ `schemas.test.ts`), `actions.ts`, `page.tsx`, `src/features/configuracoes/formulario-configuracoes.tsx`

**Interfaces:**
- Produces: campos `onlineAtivo: boolean`, `onlineAntecedenciaMinHoras: int 0–72`, `onlineAntecedenciaMaxDias: int 1–180`, `onlineAvisoPrivacidade: trim 20–1000` em `configuracoesSchema`; seção com interruptor, os dois números, o texto e o link público `{NEXT_PUBLIC_SITE_URL}/agendar` com botão "Copiar link". Só a dona (já é a regra da página).
- [ ] **Step 1: Testes (falhando)** em `schemas.test.ts`: limites dos dois números; aviso com 19 caracteres recusado; `onlineAtivo` default false.
- [ ] **Step 2: Rodar e ver falhar** — `pnpm test src/app/(app)/configuracoes` → FAIL.
- [ ] **Step 3: Implementar** schema, gravação em `salvarConfiguracoes` e a seção no formulário.
- [ ] **Step 4: Rodar** — `pnpm test`, `pnpm typecheck` → PASS.
- [ ] **Step 5: Commit** — `feat(configuracoes): ligar agendamento online, antecedências e aviso de privacidade`.

### Task 8: Telas de ponta a ponta, projeto de testes e documentação

**Files:**
- Create: `e2e/agendar.spec.ts`
- Modify: `playwright.config.ts` (chaves de teste do Turnstile no `webServer.env`), `docs/implantacao.md`, `README.md`, `.env.example`

**Interfaces:**
- Consumes: tudo acima; `e2e/guarda.ts` e `e2e/ficha-suporte.ts` (padrão de preparo com admin client).
- [ ] **Step 1: Escrever `e2e/agendar.spec.ts`** (com backend; pulado sem `E2E_PERMITIR_PROJETO`), nos 3 tamanhos:
  - `cliente faz pedido em /agendar e vê "Pedido recebido!"` (prepara: `online_ativo = true`, serviço com `permite_online`, jornada da profissional de teste em dia futuro; limpa pedidos do telefone de teste).
  - `recepção vê o card no Início, aprova com cliente nova e o agendamento aparece confirmado na agenda; botão "Avisar no WhatsApp" tem href wa.me`.
  - `recusar libera o horário: o mesmo horário volta a aparecer em /agendar`.
  - `/agendar com online desligado mostra "Agendamento online indisponível" e o telefone` (também com backend; desliga e religa `online_ativo` no preparo).
- [ ] **Step 2: Rodar** — `pnpm e2e` → specs novos pulados sem backend, demais verdes; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build` → PASS.
- [ ] **Step 3: Aplicar 0009 no projeto de testes `myfpjwtmfonuvsrsvato`** via MCP `apply_migration` com o arquivo exato; conferir: `select online_ativo from configuracoes_clinica` → `false`; `select count(*) from pg_policies where tablename = 'pedidos_online'` → `1`; `select jobname from cron.job where jobname = 'pedidos_online_limpeza'` → 1 linha; `get_advisors` (security) sem ERROR.
- [ ] **Step 4: Documentar** em `docs/implantacao.md` a seção "Fase 3A": aplicar 0009 em testes e produção antes do merge; conferências do Step 3; criar o widget Turnstile na Cloudflare (domínio `sistema-madamef.vercel.app`), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` na Vercel; marcar serviços "permite online"; ligar em Configurações; link para a bio. `.env.example` e `README.md` com as duas variáveis.
- [ ] **Step 5: Commit** — `test(e2e)+docs: agendamento online de ponta a ponta e implantação da Fase 3A`.
