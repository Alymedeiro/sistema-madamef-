# Fase 5 — CRM (retorno, clientes sumidas, leads, aniversariantes)

Data: 2026-11-12 · Base: spec geral `2026-11-02-sistema-madame-fe-design.md` §5.7, §6.6, §6.9 e §9 (Fase 5). Usa a fila de WhatsApp da Fase 3B (`2026-11-11-fase-3b-whatsapp-design.md`). Desenho aprovado pelo usuário em 2026-11-12 (ritmo acelerado: detalhes decididos com bom senso).

## 1. Objetivo e aceite

A dona e a recepção têm um menu **CRM** que mostra quem precisa voltar (retorno por serviço), quem sumiu (sem atendimento há N dias), o funil de leads e os aniversariantes. A partir das listas elas mandam WhatsApp pela fila existente. A dona vê 4 indicadores no Início.

**Aceite:**
- As listas seguem as regras do §2 (datas em São Paulo, exclusões corretas).
- A mensagem automática de retorno sai uma vez por atendimento de origem, só com opt-in de marketing.
- O envio em lote de reativação só enfileira para clientes com WhatsApp e opt-in, sem repetir em 30 dias, e informa quantas foram puladas.
- Todas as mensagens passam pela fila: respeitam o liga/desliga, a janela de horário e o limite por hora.
- Leads: criar, editar, mover de etapa, marcar perdido (motivo opcional), converter em cliente (cria ou liga à cliente com o mesmo WhatsApp), enviar WhatsApp avulso.
- Profissional não vê o menu CRM nem lê `leads` (RLS).
- Funciona em 390 / 1024 / 1440 px.

**Fora do escopo:** formulário público de leads; campanhas com cupom; relatórios de conversão detalhados; arrastar cartões no funil.

## 2. Regras

| Tema | Regra |
|---|---|
| Retorno — origem | Para cada par (cliente ativa, serviço com `dias_retorno`), o agendamento `atendido` **mais recente** daquele serviço |
| Retorno — data | `data_retorno = (inicio do atendimento em SP)::date + dias_retorno` |
| Retorno — lista | `data_retorno ≤ hoje + 7`; exclui cliente com agendamento futuro `pendente`/`confirmado` (qualquer serviço). Situação: 🔴 atrasado (`< hoje`), 🟡 hoje/esta semana |
| Retorno — automático | Job diário 09:00 SP: enfileira `retorno` para as origens com `data_retorno` entre `hoje − 2` e `hoje` (tolerância a job perdido), cliente ativa com WhatsApp e opt-in, sem agendamento futuro, e sem `retorno` já criado (não cancelado) para a mesma origem. Atrasos mais antigos ficam para envio manual (botão na linha) |
| Clientes sumidas | Cliente ativa cujo último `atendido` (qualquer serviço) foi há mais de `dias_cliente_sumida` dias (padrão 90) e sem agendamento futuro `pendente`/`confirmado`. Quem nunca foi atendida não entra |
| Reativação em lote | Dona/recepção escolhem as clientes e confirmam. Enfileira `reativacao` para agora. Pula quem não tem WhatsApp, quem não tem opt-in e quem teve `reativacao` (não cancelada) nos últimos 30 dias. Devolve enfileiradas e puladas |
| Na hora do envio | `retorno` e `reativacao` são cancelados se a cliente perdeu o opt-in ("Cliente sem opt-in de marketing") ou se já tem agendamento futuro ("Cliente já agendou"). Vencidos há mais de 24 h perdem a validade, como o aniversário |
| Aniversariantes | Lista de hoje e dos próximos 7 dias (29/02 vira 28/02 em ano não bissexto). A mensagem automática já existe (Fase 3B) |
| Leads — etapas | `novo` → `em_conversa` → `orcamento_enviado` → `agendou` \| `perdido` (motivo opcional ≤ 200). Qualquer etapa pode ir para qualquer outra |
| Converter lead | Exige a confirmação do aceite LGPD (checkbox) e pergunta o opt-in de marketing. Se já existe cliente com o mesmo WhatsApp, liga o lead a ela (sem criar outra); senão cria a cliente (nome, WhatsApp, origem). Lead convertido guarda `cliente_id` e `convertido_em`. Converter não muda a etapa |
| Indicadores (Início, só dona) | Retornos nos próximos 7 dias (inclui atrasados); clientes sumidas; leads em aberto (`novo`, `em_conversa`, `orcamento_enviado`); leads convertidos no mês (`convertido_em` no mês corrente SP) |
| Exclusão | Leads não são apagados |

## 3. Banco

Duas migrações, porque um valor novo de enum não pode ser usado na mesma transação em que é criado:
- `0014_crm_tipos.sql`: `alter type public.tipo_mensagem add value 'retorno'` e `add value 'reativacao'`.
- `0015_crm.sql`: o resto.

### 3.1 Modelos de mensagem
Inserir `retorno` ("Oi, {nome}! Já está na hora de renovar seu {servico}. Quer que a gente reserve um horário para você? {clinica}") e `reativacao` ("Oi, {nome}! Sentimos sua falta aqui na {clinica}. Que tal agendar um momento para você? É só responder esta mensagem."). Ambos editáveis na tela de modelos existente. Os rótulos novos entram no TS.

### 3.2 `fila_mensagens`
- Coluna `lead_id uuid references leads` (avulsa para lead; nesse caso `cliente_id` é nulo). Índice.
- Unique parcial: um `retorno` por `agendamento_id` (origem) com `status not in ('cancelada','falhou')`.
- `proxima_mensagem()` (create or replace, com o corpo atual mais as regras do §2 "Na hora do envio" para `retorno`/`reativacao` e a validade de 24 h). Para `retorno`, `servico` vem do agendamento de origem; `nome` da cliente.
- `enviar_avulsa`: nova variante `enviar_avulsa_lead(p_lead uuid, p_texto text) returns uuid` (dona/recepção; lead com WhatsApp).

### 3.3 `leads`
`id`, `nome` (1–120), `whatsapp` (`^55\d{10,11}$`, opcional), `servico_id` (interesse, opcional), `origem` (mesmo check de `clientes.origem`, opcional), `etapa` enum `etapa_lead` (`novo`,`em_conversa`,`orcamento_enviado`,`agendou`,`perdido`) default `novo`, `perdido_motivo` (≤ 200; só com etapa `perdido`, limpo ao sair), `responsavel_id` → colaboradores (opcional), `observacoes` (≤ 2000), `cliente_id` → clientes, `convertido_em`, `criado_por`, `criado_em`, `atualizado_em`. Check: `cliente_id` e `convertido_em` juntos. Índices em etapa, cliente_id, whatsapp.

RLS: select/insert/update para dona e recepção; nada para profissional e anon; sem delete. `cliente_id`/`convertido_em` só mudam pela função de conversão (gatilho `before update` recusa mudança direta).

### 3.4 Funções (dona e recepção; `security definer`, `search_path=''`, perfil checado; senão P0001)
- `crm_retornos(p_ate date) returns table(cliente_id, cliente_nome, whatsapp, aceita_marketing, servico_id, servico_nome, agendamento_id, ultimo_atendimento timestamptz, data_retorno date, retorno_enviado_em timestamptz)` — regras do §2, `data_retorno ≤ p_ate`, ordenado por data.
- `crm_sumidas() returns table(cliente_id, nome, whatsapp, aceita_marketing, ultimo_atendimento timestamptz, dias_sem_vir int, reativacao_enviada_em timestamptz)`.
- `enviar_retorno(p_agendamento uuid) returns uuid` — envio manual de uma linha (exige WhatsApp; respeita o opt-in → erro "A cliente não aceitou mensagens de marketing."; não duplica uma pendente).
- `enviar_reativacao(p_clientes uuid[]) returns table(enfileiradas int, puladas int)` — no máximo 500 por chamada.
- `converter_lead(p_lead uuid, p_aceite_lgpd boolean, p_aceita_marketing boolean) returns uuid` (id da cliente) — `p_aceite_lgpd` false → "Confirme o aceite da LGPD."; lead já convertido → "Este lead já virou cliente.".
- `crm_indicadores() returns table(retornos int, sumidas int, leads_abertos int, convertidos_mes int)` — só dona.
- `enfileirar_retornos_do_dia(p_hoje date) returns int` (interna) + `enfileirar_retornos()` (job). pg_cron `crm_retornos` diário 12:00 UTC (09:00 SP), criação tolerante como em 0012.

## 4. Telas

### 4.1 Menu
Novo recurso `crm` ("CRM", ícone `HeartHandshake`, `/crm`) para dona e recepção, entre Mensagens e Serviços. A barra inferior continua com 4 fixos + "Mais".

### 4.2 `/crm` — abas Retorno · Sumidas · Leads · Aniversariantes (`?aba=`)
- **Retorno:** tabela (cartões no celular): cliente (link para a ficha), serviço, último atendimento, data do retorno com selo, mensagem ("enviada em dd/mm" / "sem opt-in" / "sem WhatsApp"); botão **Enviar retorno**.
- **Sumidas:** checkbox por linha e "marcar todas"; cliente, último atendimento, dias sem vir, opt-in, última reativação. Botão **Enviar reativação (N)** → diálogo com o texto do modelo e a contagem → resultado "X na fila, Y puladas".
- **Leads:** botão **Novo lead**. Computador (≥ 1024): colunas por etapa; celular/tablet: filtro por etapa + lista. Cartão: nome, serviço de interesse, origem, responsável, dias desde a criação. Ações: editar, **Mover para…**, **Converter em cliente** (diálogo LGPD + opt-in), **Enviar WhatsApp** (texto livre), abrir a ficha quando convertido. Perdidos e "agendou" ficam numa coluna/filtro própria; por padrão mostra os últimos 60 dias dessas duas etapas.
- **Aniversariantes:** hoje e próximos 7 dias: cliente, data, idade que faz, opt-in, mensagem do dia (status da fila).

### 4.3 Início (dona)
Quatro cartões novos com os números de `crm_indicadores()`, cada um linkando para a aba correspondente.

### 4.4 Configurações
Campo "Dias para cliente sumida" (1–730) na seção da clínica, se ainda não existir.

## 5. Código
- `src/lib/dominio/crm.ts` (puro): `dataRetorno`, `situacaoRetorno`, `diasSemVir`, `ehSumida`, `aniversariantesEntre` (reaproveita `aniversario.ts`), `ETAPAS_LEAD` e rótulos, `podeConverter`. Espelho das regras SQL para testes.
- `src/app/(app)/crm/`: `page.tsx`, `dados.ts`, `actions.ts` (zod), `schemas.ts`.
- `src/features/crm/*`: componentes das abas e diálogos.
- `src/lib/dominio/permissoes.ts`: recurso `crm`.
- `src/lib/dominio/whatsapp.ts`: rótulos de `retorno` e `reativacao`.
- `src/lib/supabase/tipos.ts`: tipos novos.

## 6. Testes
- **Vitest:** data de retorno na virada do mês e no fuso SP; situação (atrasado/semana); sumida no limite de N dias; aniversariantes com 29/02; schemas zod de lead; actions (perfil, erros do banco traduzidos).
- **Banco:** retorno usa o atendimento mais recente do serviço; cliente com agendamento futuro sai das listas; job do dia enfileira uma vez e respeita o opt-in; `enviar_reativacao` pula sem opt-in/sem WhatsApp/recente e conta certo; envio cancela retorno se a cliente agendou ou perdeu o opt-in; `converter_lead` cria ou liga pelo WhatsApp e recusa sem LGPD; RLS de `leads` (profissional nada; ninguém apaga; `cliente_id` não muda direto); indicadores.
- **Playwright (3 tamanhos, com backend):** abrir as 4 abas; criar e mover lead; converter; reativação em lote; profissional não vê o menu.

## 7. Implantação
Aplicar `0014` e `0015` em testes e depois na produção **antes** do merge. Atualizar `docs/implantacao.md` (Fase 5). Nenhuma variável nova. Após publicar: a dona preenche "dias para retorno" nos serviços que têm retorno e revisa os modelos Retorno e Reativação.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Disparo em massa de retornos atrasados na primeira execução | Automático só para `data_retorno` entre hoje − 2 e hoje; atrasados antigos só no manual |
| Mensagem duplicada | Unique parcial de retorno por origem; reativação com carência de 30 dias |
| Marketing sem consentimento | Opt-in checado ao enfileirar e de novo no envio |
| Cliente duplicada ao converter lead | Liga à cliente existente com o mesmo WhatsApp |
| Lista pesada | Funções no banco com índices existentes; limite de 500 no lote |
