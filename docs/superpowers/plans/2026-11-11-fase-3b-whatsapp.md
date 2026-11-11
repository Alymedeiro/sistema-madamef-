# Fase 3B — WhatsApp automático: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fila de WhatsApp via Z-API com confirmação, lembrete, pós-atendimento, aniversário, resposta de pedido online, envio avulso e leitura de respostas.

**Architecture:** Regras e agendamento das mensagens no Postgres (gatilhos + funções `security definer`); um relógio pg_cron+pg_net chama a rota `/api/whatsapp/processar` a cada minuto com um token gerado pelo banco; a rota pega 1 mensagem, renderiza em TS e envia pelo único módulo que conhece a Z-API. Webhook grava respostas. Telas no padrão das fases anteriores.

**Tech Stack:** o das fases anteriores. Sem dependência nova (`fetch` nativo).

**Spec:** `docs/superpowers/specs/2026-11-11-fase-3b-whatsapp-design.md` (autoridade).

## Global Constraints

- Tudo das Global Constraints das Fases 1–4B continua valendo (pt-BR, `America/Sao_Paulo`, perfis `dona | recepcao | profissional`, RLS em toda tabela, toque ≥ 44 px, viewports 1440/1024/390, `pnpm test:db` local com `shim.sql` só de teste, `tipos.ts` à mão na tarefa da migração, mensagens P0001 exatas, nada é apagado).
- Migração única nova: `supabase/migrations/0012_whatsapp.sql` (Tasks 1–2). Não aplicar em projeto remoto neste plano. pg_cron/pg_net: criação tolerante (no-op local), como em 0009.
- Telefone: `^55\d{10,11}$` (normalizado por `src/lib/dominio/telefone.ts`).
- Tipos: `confirmacao`, `lembrete`, `pos_atendimento`, `aniversario`, `pedido_aprovado`, `pedido_recusado`, `avulsa` (rótulos: Confirmação, Lembrete, Pós-atendimento, Aniversário, Pedido aprovado, Pedido recusado, Avulsa). Status: `pendente`, `enviando`, `enviada`, `falhou`, `cancelada` (rótulos: Pendente, Enviando, Enviada, Falhou, Cancelada).
- Variáveis: `{nome}` (primeiro nome), `{data}` (dd/MM), `{hora}` (HH:mm), `{servico}`, `{profissional}`, `{clinica}` (nome da clínica). Variável sem valor vira texto vazio; variável desconhecida fica literal.
- Ritmo: no máximo 1 enviada por minuto; enviadas na última hora < `whatsapp_limite_por_hora`; só dentro de [`whatsapp_janela_inicio`, `whatsapp_janela_fim`) em SP; nada se `whatsapp_ativo = false`.
- Backoff: falha 1 → +5 min, falha 2 → +15 min, falha 3 → `falhou` (erro guardado).
- Agenda: confirmação `inicio − 24h` (ou `now()`), lembrete `inicio − 2h` (não cria se já passou), pós-atendimento 10:00 SP do dia seguinte ao início; aniversário 09:00 SP (job 12:00 UTC).
- Classificação de resposta: após `trim` e minúsculas, `1`, `1.`, `sim`, `confirmo`, `confirmar` → `confirmou`; `2`, `2.` → `quer_remarcar`; resto → `para_ler`.
- Env vars do servidor: `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`, `ZAPI_WEBHOOK_TOKEN`; nenhuma `NEXT_PUBLIC_`. Ausentes → estado `sem_chaves`, nada é enviado, nenhum erro na tela.
- Mensagens exatas (P0001): `Apenas a dona ou a recepção podem enviar mensagens.` · `Esta cliente não tem WhatsApp cadastrado.` · `Escreva a mensagem.` · `Só é possível reenviar mensagens com falha ou canceladas.` · `Esta mensagem já foi enviada.`
- Rótulos de tela: menu `Mensagens`; abas `Fila` e `Respostas`; Configurações seção `WhatsApp` com interruptor `Envio automático ativo`; botão `Enviar WhatsApp`; alerta `WhatsApp desconectado`; cartões `Respostas do WhatsApp` e `Mensagens com falha`.
- Textos padrão (uma variação inicial por tipo; dona pode editar):
  - confirmacao: `Oi, {nome}! Passando para confirmar seu horário de {servico} com {profissional} em {data} às {hora}. Responda 1 para confirmar ou 2 para remarcar. {clinica}`
  - lembrete: `Oi, {nome}! Lembrete: hoje às {hora} você tem {servico} com {profissional}. Te esperamos! {clinica}`
  - pos_atendimento: `Oi, {nome}! Obrigada pela visita. Como você está se sentindo depois do {servico}? Qualquer dúvida, é só responder. {clinica}`
  - aniversario: `Feliz aniversário, {nome}! 🎉 Toda a equipe da {clinica} deseja um dia lindo para você.`
  - pedido_aprovado: `Oi, {nome}! Seu horário de {servico} com {profissional} está confirmado para {data} às {hora}. {clinica}`
  - pedido_recusado: `Oi, {nome}! Infelizmente o horário pedido para {servico} não está disponível. Você pode escolher outro em nosso site ou responder esta mensagem. {clinica}`

## Review Focus

1. **Remarcar várias vezes um agendamento pendente**: fica exatamente 1 confirmação e 1 lembrete pendentes, com os horários novos → teste em Task 1.
2. **Duas execuções do relógio ao mesmo tempo** (cron atrasado + próximo): só uma pega a mensagem (`skip locked` + 1/min) → teste em Task 2.
3. **Resposta "1" de um telefone com dois agendamentos futuros**: confirma só o próximo pendente; resposta repetida (mesmo id externo) não duplica → teste em Task 2.
4. **Envio desligado ou sem chaves durante dias**: a fila acumula; ao ligar, confirmações de horários que já passaram são descartadas (agendamento não está mais pendente ou início < agora) em vez de enviadas → teste em Tasks 2 e 4.
5. **Cliente sem WhatsApp ou com opt-in desligado**: nenhuma mensagem automática é criada (aniversário exige opt-in; as de agenda exigem só WhatsApp) e o envio avulso mostra `Esta cliente não tem WhatsApp cadastrado.` → testes em Tasks 1 e 2.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0012_whatsapp.sql` | tipos, tabelas, gatilhos, funções, RLS, cron |
| `supabase/tests/12_whatsapp.db.test.ts`, `12b_whatsapp_fila.db.test.ts` | testes de banco |
| `src/lib/supabase/tipos.ts` | tipos novos |
| `src/lib/dominio/whatsapp.ts` (+ test) | regras puras |
| `src/lib/whatsapp/zapi.ts` (+ test) | cliente Z-API |
| `src/app/api/whatsapp/processar/route.ts`, `src/app/api/webhooks/zapi/route.ts` (+ tests) | relógio e webhook |
| `src/app/(app)/configuracoes/*`, `src/features/whatsapp/*` | configurações e modelos |
| `src/app/(app)/mensagens/*`, `src/features/mensagens/*` | fila, respostas, envio avulso |
| `src/features/inicio/*`, `src/features/pedidos/*`, `src/lib/dominio/permissoes.ts` | Início, pedidos, menu |
| `e2e/whatsapp.spec.ts`, `docs/implantacao.md` | telas e implantação |

---

### Task 1: Banco — modelos, fila e agendamento automático

**Files:** Create `supabase/migrations/0012_whatsapp.sql` (seções 1–2), `supabase/tests/12_whatsapp.db.test.ts`; Modify `src/lib/supabase/tipos.ts`.

**Interfaces — Produces:**
- `configuracoes_clinica.whatsapp_ativo boolean not null default false`.
- Enums `tipo_mensagem`, `status_mensagem` (Global Constraints).
- `modelos_mensagem (tipo tipo_mensagem pk check <> 'avulsa', variacoes text[] not null check (1–5 itens, cada 1–1000 caracteres após trim), ativo bool default true, atualizado_em)`, com os 6 textos padrão inseridos. RLS: select autenticado ativo; update só dona; sem insert/delete.
- `fila_mensagens` (colunas da spec §3); checks: telefone; `texto is not null` quando `tipo='avulsa'` ou `status='enviada'`; `cancelada_motivo` ⇔ `status='cancelada'`. Unique parciais: `(agendamento_id, tipo) where status in ('pendente','enviando') and tipo in ('confirmacao','lembrete','pos_atendimento')`; `(cliente_id, extract(year from agendado_para at time zone 'America/Sao_Paulo')) where tipo='aniversario' and status <> 'cancelada'` (via coluna gerada ou índice de expressão).
- RLS fila: select dona e recepção; sem escrita direta.
- Gatilho `agendamentos_whatsapp` (after insert or update of status, inicio, fim): conforme Global Constraints "Agenda": status ≠ `pendente`/`confirmado` ou `inicio` mudou → cancela confirmação/lembrete pendentes (motivo `Agendamento alterado` ou `Agendamento cancelado`); depois, se pendente → confirmação; se pendente ou confirmado e `inicio − 2h > now()` → lembrete; entrando em `atendido` → pós-atendimento. Só se a cliente tem `whatsapp`. Nunca falha o comando por causa da fila.
- `enviar_avulsa(p_cliente uuid, p_texto text, p_agendamento uuid default null) returns uuid` (dona/recepção; mensagens da Global Constraints), `cancelar_mensagem(p_id uuid, p_motivo text)` (dona/recepção; só pendente — enviada → `Esta mensagem já foi enviada.`), `reenviar_mensagem(p_id uuid) returns uuid` (dona/recepção; só falhou/cancelada).
- Funções de pedido online: `aprovar_pedido_online` / `recusar_pedido_online` (0009) passam a enfileirar `pedido_aprovado` / `pedido_recusado` (agora) com `pedido_online_id` e o telefone do pedido — recriar com `create or replace` mantendo assinatura e comportamento, ou gatilho em `pedidos_online` ao mudar status (preferir gatilho, para não reescrever 0009).
- `enfileirar_aniversarios() returns int` (sem grant; chamado pelo cron): clientes ativas, opt-in, WhatsApp, aniversário hoje SP (29/02 → 28/02 em ano não bissexto), uma por ano; agendado para 09:00 SP de hoje (ou agora se já passou).

- [ ] **Step 1: Testes (falhando)** em `12_whatsapp.db.test.ts`: criar agendamento pendente a 48h → 1 confirmação em `inicio−24h` e 1 lembrete em `inicio−2h`; a 3h → confirmação ≈ now() e lembrete em inicio−2h; a 1h → confirmação e nenhum lembrete; remarcar 3 vezes → exatamente 1 de cada pendente, horários novos, antigas `cancelada` motivo `Agendamento alterado`; cancelar → pendentes canceladas `Agendamento cancelado`; marcar atendido (início 2026-11-30 15:00 SP) → pós em 2026-12-01 10:00 SP; cliente sem WhatsApp → nada; recepção `enviar_avulsa` ok, sem WhatsApp → mensagem, texto vazio → `Escreva a mensagem.`; profissional → `Apenas a dona ou a recepção podem enviar mensagens.`; cancelar enviada → mensagem; reenviar pendente → mensagem; aprovar pedido online → `pedido_aprovado` pendente para o telefone do pedido; aniversário: opt-in sim/não, segunda chamada no mesmo dia não duplica, 29/02 em 2027; profissional lê 0 linhas da fila; anon nada; dona atualiza modelo, recepção não; variações vazias/6 itens recusadas (23514).
- [ ] **Step 2:** `pnpm test:db supabase/tests/12_whatsapp.db.test.ts` → FAIL.
- [ ] **Step 3:** escrever seções 1–2 da 0012 e `tipos.ts`.
- [ ] **Step 4:** `pnpm test:db` (todas, sem regressão em 02/07/09/11) e `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(db): modelos, fila e agendamento automático de WhatsApp (0012)`.

### Task 2: Banco — envio, respostas, relógio e status

**Files:** Modify `0012_whatsapp.sql` (seções 3–4), `tipos.ts`; Create `supabase/tests/12b_whatsapp_fila.db.test.ts`.

**Interfaces — Consumes:** Task 1. **Produces (todas `security definer`, `search_path ''`; execute só `service_role` salvo indicado):**
- `proxima_mensagem() returns table (id uuid, tipo tipo_mensagem, telefone text, texto text, variacoes text[], nome text, servico text, profissional text, inicio timestamptz, status_agendamento status_agendamento, clinica text)` — regras de ritmo/janela/ativo das Global Constraints; trava com `for update skip locked`; marca `enviando`; 0 linhas quando nada a enviar.
- `concluir_envio(p_id uuid, p_texto text, p_id_externo text)`, `falhar_envio(p_id uuid, p_erro text)` (backoff), `descartar_envio(p_id uuid, p_motivo text)`.
- `mensagens_recebidas` (spec §3) + RLS select dona/recepção; `registrar_recebida(p_telefone text, p_texto text, p_id_externo text) returns uuid` — idempotente; associa ao próximo agendamento não cancelado da cliente com aquele WhatsApp e `inicio >= now() - interval '2 hours'`, menor `inicio`; `confirmou` e agendamento `pendente` → `confirmado`; classificação das Global Constraints (implementada também em SQL — mesma tabela de palavras).
- `marcar_recebida_lida(p_id uuid)` (dona/recepção).
- `whatsapp_relogio (linha_unica bool pk default true check, token text not null default encode(extensions.gen_random_bytes(32),'hex'), url text)` com 1 linha inserida; `revoke all … from anon, authenticated`; select para service_role.
- `whatsapp_status (linha_unica …, estado text check in ('conectado','desconectado','sem_chaves') default 'sem_chaves', verificado_em timestamptz)` com 1 linha; select dona/recepção; `gravar_status_whatsapp(p_estado text)` (service_role).
- pg_cron (bloco tolerante): `whatsapp_relogio` `* * * * *` → função `disparar_relogio_whatsapp()` (lê url/token; url nula → nada; usa `net.http_post(url := url || '/api/whatsapp/processar', headers := jsonb_build_object('x-cron-token', token, 'content-type','application/json'), body := '{}'::jsonb, timeout_milliseconds := 25000)`); `whatsapp_aniversarios` `0 12 * * *` → `enfileirar_aniversarios()`. Criar pg_net só se disponível (`create extension if not exists pg_net`).

- [ ] **Step 1: Testes (falhando):** desligado → 0 linhas; ligado fora da janela → 0; dentro → 1 e fica `enviando`; segunda chamada no mesmo minuto → 0 (1/min); com N enviadas na última hora = limite → 0; duas conexões simultâneas → só uma recebe; `falhar_envio` 3× → `falhou` com proxima_tentativa_em +5/+15; `concluir_envio` grava texto/id/enviada_em; `registrar_recebida('1')` confirma o próximo pendente e não o seguinte; mesmo id_externo 2× → 1 linha; `'2'` → `quer_remarcar`; `'obrigada'` → `para_ler`; telefone desconhecido → gravada sem agendamento; authenticated não lê `whatsapp_relogio` (42501); authenticated não executa `proxima_mensagem`; `disparar_relogio_whatsapp()` com url nula não falha.
- [ ] **Step 2:** FAIL. **Step 3:** implementar + `tipos.ts`. **Step 4:** `pnpm test:db`, `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(db): envio da fila, respostas e relógio do WhatsApp (0012)`.

### Task 3: Regras puras e cliente Z-API

**Files:** Create `src/lib/dominio/whatsapp.ts` (+ test), `src/lib/whatsapp/zapi.ts` (+ test).

**Interfaces — Produces:**
- `renderizarMensagem(variacoes: string[], dados: { nome?: string; data?: string; hora?: string; servico?: string; profissional?: string; clinica?: string }, sortear?: (n: number) => number): string` (primeiro nome; sortear padrão `Math.random`).
- `dadosDaMensagem(linha: { nome; inicio: string | null; servico; profissional; clinica }): DadosMensagem` (data/hora em SP).
- `podeEnviar(tipo: TipoMensagem, statusAgendamento: string | null, inicio: Date | null, agora: Date): { ok: true } | { ok: false; motivo: string }` — confirmação exige `pendente` e `inicio > agora`; lembrete exige `confirmado` e `inicio > agora`; pós exige `atendido`; outros sempre ok. Motivos: `Agendamento não está mais pendente`, `Agendamento não está confirmado`, `Horário já passou`, `Agendamento não foi atendido`.
- `classificarResposta(texto: string): 'confirmou' | 'quer_remarcar' | 'para_ler'`.
- `ROTULO_TIPO_MENSAGEM`, `ROTULO_STATUS_MENSAGEM`, `VARIAVEIS_MENSAGEM`, `TEXTOS_PADRAO` (iguais aos da migração).
- `zapi.ts`: `credenciaisZapi(): { instancia; token; clientToken } | null`; `enviarTexto(telefone: string, texto: string, f = fetch): Promise<{ ok: true; idExterno: string } | { ok: false; erro: string; desconectado: boolean }>` (POST `/send-text` body `{ phone, message }`, header `Client-Token`, `AbortSignal.timeout(10000)`; `idExterno` = `messageId` ou `zaapId`; resposta com erro de instância desconectada → `desconectado: true`); `statusConexao(f = fetch): Promise<'conectado' | 'desconectado' | 'sem_chaves'>` (GET `/status`, campo `connected`).
- [ ] **Step 1: Testes (falhando):** variáveis, desconhecida literal, primeiro nome, `sortear` escolhe índice 1; `podeEnviar` nos 4 casos; `classificarResposta` com os exemplos das Global Constraints + "Quero remarcar" → para_ler; zapi com fetch simulado: sucesso (URL e headers exatos), 400, timeout (erro `Tempo esgotado`), desconectado, sem env → `sem_chaves` e `enviarTexto` não chama fetch; `TEXTOS_PADRAO` igual ao inserido na migração (ler o arquivo SQL e comparar).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm typecheck`, `pnpm lint` → PASS.
- [ ] **Step 5:** commit `feat(whatsapp): regras de mensagem e cliente Z-API`.

### Task 4: Rotas — relógio e webhook

**Files:** Create `src/app/api/whatsapp/processar/route.ts` (+ test), `src/app/api/webhooks/zapi/route.ts` (+ test); Modify `src/lib/auth/rotas.ts` (+ test) se o middleware exigir sessão em `/api/*`.

**Interfaces — Consumes:** Tasks 2–3; `createAdminClient` de `src/lib/supabase/admin.ts`. **Produces:**
- `POST /api/whatsapp/processar`: `x-cron-token` ausente/errado → 401 (comparação `timingSafeEqual`); status (≤ 1 consulta/5 min usando `whatsapp_status.verificado_em`; grava via `gravar_status_whatsapp`); `sem_chaves` → 200 `{ enviado: false, motivo: 'sem_chaves' }`; `proxima_mensagem` → nada → 200; renderiza (avulsa usa `texto`); `podeEnviar` falso → `descartar_envio`; `enviarTexto` → `concluir_envio` ou `falhar_envio` (desconectado também grava status). `export const dynamic = 'force-dynamic'`, `maxDuration = 30`.
- `POST /api/webhooks/zapi?token=…`: token ≠ `ZAPI_WEBHOOK_TOKEN` (ou env ausente) → 401; corpo inválido → 200 ignorado; `fromMe` ou `isGroup` → 200 ignorado; telefone normalizado; texto de `text.message`; `registrar_recebida(phone, texto, messageId)` → 200.
- [ ] **Step 1: Testes (falhando)** com admin client e zapi mockados: 401 sem/errado; sem_chaves não chama `proxima_mensagem`; fluxo enviada chama `concluir_envio` com o texto renderizado; confirmação de agendamento já confirmado → `descartar_envio`; falha → `falhar_envio`; status não é consultado de novo antes de 5 min; webhook: 401, fromMe ignorado, payload real de exemplo (documentado no teste) → `registrar_recebida` com argumentos certos; middleware deixa as duas rotas passarem sem sessão.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(whatsapp): relógio de envio e webhook da Z-API`.

### Task 5: Configurações → WhatsApp e modelos

**Files:** Modify `src/app/(app)/configuracoes/{page.tsx,actions.ts,schemas.ts}` (+ tests); Create `src/features/whatsapp/{secao-whatsapp.tsx,editor-modelos.tsx}`.

**Interfaces — Consumes:** Task 1 (`whatsapp_ativo`, `modelos_mensagem`), Task 2 (`whatsapp_status`), Task 3 (`renderizarMensagem`, rótulos, variáveis). **Produces:** ações (dona) `salvarConfigWhatsapp({ ativo, janelaInicio, janelaFim, limitePorHora })` (fim > início; limite 1–200) e `salvarModelo({ tipo, variacoes: string[], ativo })` (1–5, cada 1–1000). Seção com interruptor `Envio automático ativo`, janela, limite, estado da conexão (`Conectado` / `Desconectado` / `Chaves da Z-API não configuradas`), editor com prévia usando dados de exemplo (`Maria`, amanhã 14:30, `Limpeza de pele`, `Ana`, nome da clínica) e lista de variáveis.
- [ ] **Step 1: Testes (falhando):** recepção negada; janela invertida recusada; limite 0/201 recusado; 6 variações recusadas; variação só com espaços recusada; prévia renderiza variáveis.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(whatsapp): configurações de envio e editor de modelos`.

### Task 6: Mensagens, envio avulso, Início e pedidos online

**Files:** Create `src/app/(app)/mensagens/{page.tsx,actions.ts,dados.ts}` (+ tests), `src/features/mensagens/{lista-fila.tsx,lista-respostas.tsx,dialogo-enviar.tsx}`; Modify `src/lib/dominio/permissoes.ts` (+ test; recurso `mensagens`: dona e recepção; menu `Mensagens`, ícone `MessageCircle`), ficha da cliente e detalhe do agendamento (botão `Enviar WhatsApp`), `src/features/inicio/*` + `src/app/(app)/inicio/page.tsx` (alerta e 2 cartões), `src/features/pedidos/*` (botão manual só com envio desligado).

**Interfaces — Consumes:** Tasks 1–3. **Produces:** ações `enviarWhatsApp({ clienteId, texto, agendamentoId? })`, `cancelarMensagem({ id, motivo })`, `reenviarMensagem(id)`, `marcarRespostaLida(id)` (dona/recepção); `carregarFila(supabase, { status?, tipo?, busca? })` (200 mais recentes), `carregarRespostas(supabase, { classificacao? })`, `carregarAlertasWhatsapp(supabase)` → `{ desconectado: boolean; falhas: number; respostas: Resposta[] }` (desconectado = ativo e estado ≠ conectado).
- [ ] **Step 1: Testes (falhando):** profissional negado; texto vazio recusado antes do banco; mensagens do banco repassadas; `carregarAlertasWhatsapp` com envio desligado → `desconectado=false`; permissões do menu; pedidos: com envio ativo não mostra o botão manual.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(whatsapp): tela de mensagens, envio avulso e alertas no Início`.

### Task 7: Telas de ponta a ponta e documentação

**Files:** Create `e2e/whatsapp.spec.ts`; Modify `docs/implantacao.md`, `.env.example`.

- [ ] **Step 1:** `e2e/whatsapp.spec.ts` (backend, `pularSemBackend`, dados únicos, limpeza tolerante, usar `liberarHorario` de `e2e/horario-livre.ts` se criar agendamentos), 3 tamanhos: dona edita um modelo e vê a prévia; liga/desliga o envio; recepção envia avulsa → aparece `Pendente` na Fila; cancela → `Cancelada`; resposta inserida via admin (`registrar_recebida` com service role) aparece em `Respostas do WhatsApp` no Início e some ao marcar como lida; profissional não vê o menu `Mensagens`.
- [ ] **Step 2:** `pnpm e2e`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build` → PASS.
- [ ] **Step 3:** `docs/implantacao.md` seção "Fase 3B — WhatsApp (Z-API)": aplicar 0012 em testes e produção antes do merge; gravar `whatsapp_relogio.url` (SQL exato); conferências (pg_policies das 5 tabelas; `cron.job` com `whatsapp_relogio` e `whatsapp_aniversarios`; extensão pg_net); passos do usuário (conta Z-API, 4 variáveis na Vercel, webhook "Ao receber" com a URL e o token, ligar o envio); linha "Estado atual: 0012 ainda não aplicada". `.env.example` com as 4 variáveis vazias e comentário.
- [ ] **Step 4:** commit `test(e2e)+docs: WhatsApp de ponta a ponta e implantação da Fase 3B`.
