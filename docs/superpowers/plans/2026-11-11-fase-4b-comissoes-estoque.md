# Fase 4B — Comissões e Estoque: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao marcar "atendido", gerar a comissão da profissional e dar baixa nos produtos do serviço; a dona paga comissões no Financeiro (aba Comissões) e controla o estoque em Produtos (aba Estoque).

**Architecture:** Regras no Postgres: gatilho em `agendamentos` (entrada/saída de `atendido`) cria/cancela a comissão e grava movimentos de estoque; `produtos.estoque_atual` só muda pelo gatilho de `movimentos_estoque`. Escrita da dona por funções `security definer`; RLS só dona em percentuais, comissões e movimentos. Telas no padrão das fases anteriores (Server Components leem, Server Actions com zod escrevem), espelho puro em TS para testes.

**Tech Stack:** o das Fases 1–4. Sem dependência nova.

**Spec:** `docs/superpowers/specs/2026-11-11-fase-4b-comissoes-estoque-design.md` (autoridade).

## Global Constraints

- Tudo das Global Constraints das Fases 1–4 continua valendo (pt-BR, `America/Sao_Paulo`, **centavos inteiros**, perfis `dona | recepcao | profissional`, RLS em toda tabela, toque ≥ 44 px, viewports 1440/1024/390, `pnpm test:db` local com `shim.sql` só de teste, `tipos.ts` à mão na tarefa da migração, mensagens P0001 exatas, nada é apagado).
- Migração única nova: `supabase/migrations/0011_comissoes_estoque.sql` (Tasks 1–2). Não aplicar em lugar nenhum neste plano (o controlador aplica em testes depois da revisão final). Funções: `set search_path = ''`, `revoke ... from public, anon, authenticated`, `grant` só a quem chama; internas sem grant.
- Percentual: `numeric(5,2)` entre 0 e 100. Valor da comissão = `round(base × percentual / 100)` (centavos, arredondamento half-up do Postgres `round(numeric)`). Base de pacote = `round(valor_total_centavos::numeric / total_sessoes)`.
- Competência = `date_trunc('month', (inicio at time zone 'America/Sao_Paulo'))::date`.
- Status de comissão: `aberta` | `paga` | `cancelada` (rótulos: Em aberto 🟡, Paga 🟢, Cancelada ⚫).
- Tipos de movimento: `entrada` | `ajuste` | `baixa_atendimento` | `estorno_atendimento` (rótulos: Entrada, Ajuste, Baixa (atendimento), Estorno (atendimento)).
- Despesa de comissão: `contas_pagar` categoria `salario`, já paga, descrição exata `Comissão — <nome da profissional> — <MM/AAAA>`. Despesa de compra: categoria `produto`, em aberto, descrição `Compra — <nome do produto>`.
- Mensagens exatas (P0001): `A comissão deste atendimento já foi paga.` · `Não há comissões em aberto.` · `O estoque só muda por entrada ou ajuste.` · `O estoque já está com essa quantidade.` · `Informe o motivo do ajuste.` · `A quantidade deve ser maior que zero.` · `A quantidade contada não pode ser negativa.` · `Apenas a dona pode lançar contas.` (reaproveitada de 0010 via `exigir_dona_financeiro()`).
- Motivo automático ao desmarcar: `Atendimento desmarcado`. Motivo do saldo migrado: `Saldo anterior`. Motivo do estoque inicial: `Estoque inicial`.
- Rótulos de tela: aba Financeiro `Comissões`; aba Produtos `Estoque`; botões `Pagar comissões`, `Entrada`, `Ajuste`; campos `Comissão padrão (%)` (Equipe) e `Comissão (%)` com ajuda `Vazio = usa a comissão padrão da profissional.` (Serviços).

## Review Focus

1. **Desmarcar e remarcar "atendido" várias vezes** (atendido → confirmado → atendido): continua uma comissão só (reaberta e recalculada) e o estoque volta exatamente ao saldo de antes + uma baixa → teste em Task 2 (DB).
2. **Serviço sem produtos vinculados ou produto desativado/removido do serviço depois da baixa**: desmarcar estorna o que foi baixado naquele agendamento (soma líquida por produto), não a lista atual do serviço → teste em Task 2.
3. **Cobrança com desconto lançada depois do atendido, e cobrança de pacote**: a comissão aberta é recalculada para bruto − desconto; cobrança de pacote não mexe → teste em Task 1.
4. **Profissional/recepção marcando atendido** (os usuários reais que fazem isso): o gatilho grava comissão e movimentos mesmo sem acesso de leitura a essas tabelas, e eles continuam sem ler nada → teste em Task 2.
5. **Pagar comissões com todas a 0%** (profissional sem % configurada): marca pagas sem criar despesa de R$ 0,00 e devolve null → teste em Task 1.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0011_comissoes_estoque.sql` | percentuais, comissões, movimentos, gatilhos, funções, RLS |
| `supabase/tests/11_comissoes.db.test.ts`, `11b_estoque.db.test.ts` | testes de banco |
| `src/lib/supabase/tipos.ts` | tipos novos |
| `src/lib/dominio/comissoes.ts`, `estoque.ts` (+ tests) | regras puras |
| `src/lib/dominio/permissoes.ts` (+ test) | abas `comissoes` e `estoque` |
| `src/app/(app)/equipe/*`, `servicos/*`, `produtos/*` | campos de % e estoque inicial |
| `src/app/(app)/financeiro/dados-comissoes.ts`, `actions-comissoes.ts` (+ tests), `relatorio.ts` | aba Comissões e PDF |
| `src/features/comissoes/*` | lista, resumo, diálogo pagar |
| `src/app/(app)/produtos/estoque/*` ou aba em `produtos/page.tsx`, `src/features/estoque/*` | aba Estoque, diálogos, histórico |
| `e2e/comissoes-estoque.spec.ts`, `docs/implantacao.md` | telas e implantação |

---

### Task 1: Banco — percentuais, comissões e pagamento

**Files:** Create `supabase/migrations/0011_comissoes_estoque.sql` (seções 1–2), `supabase/tests/11_comissoes.db.test.ts`; Modify `src/lib/supabase/tipos.ts`.

**Interfaces — Produces:**
- `public.colaboradores_comissao (colaborador_id uuid pk FK on delete cascade, percentual numeric(5,2) not null check 0–100, atualizado_em)`; `public.servicos_comissao (servico_id uuid pk FK on delete cascade, percentual …, atualizado_em)`. RLS: select/insert/update só dona; delete só dona e só em `servicos_comissao`.
- `create type public.status_comissao as enum ('aberta','paga','cancelada')`.
- `public.comissoes (id, agendamento_id uuid not null unique FK, profissional_id FK, servico_id FK, competencia date, base_centavos int ≥ 0, percentual numeric(5,2), valor_centavos int ≥ 0, status default 'aberta', cancelada_em, cancelada_motivo text 1–200, conta_pagar_id FK null, pago_em date null, criado_em, atualizado_em)`; checks: `(status='paga') = (pago_em is not null)`; `(status='cancelada') = (cancelada_em is not null)`; `conta_pagar_id is null or status='paga'`. Índices em `(profissional_id, competencia)`, `conta_pagar_id`.
- Internas (sem grant): `percentual_comissao(p_servico uuid, p_profissional uuid) returns numeric` (serviço → profissional → 0); `base_comissao(p_agendamento uuid) returns int` (pacote → `round(valor_total/total_sessoes)`; cobrança do agendamento → bruto − desconto; senão `valor_previsto_centavos`); `gravar_comissao(p_agendamento uuid)` — upsert (insert ou, se existir `cancelada`/`aberta`, recalcula percentual/base/valor/competência e volta a `aberta`, limpando campos de cancelamento; se `paga`, não mexe).
- Gatilho `agendamentos_comissao` (after insert or update of status on agendamentos, security definer): entrando em `atendido` → `gravar_comissao`; saindo de `atendido` → se comissão `paga` → `raise 'A comissão deste atendimento já foi paga.'`; se `aberta` → `cancelada`, `cancelada_em = now()`, motivo `Atendimento desmarcado`. (Task 2 acrescenta estoque nesse mesmo gatilho ou num gatilho irmão — ver Task 2.)
- Gatilho `cobrancas_comissao` (after insert on cobrancas when origem = 'agendamento'): recalcula base/valor da comissão `aberta` desse agendamento.
- `pagar_comissoes(p_profissional uuid, p_competencia date, p_pago_em date, p_forma forma_pagamento) returns uuid` (dona via `exigir_dona_financeiro()`): trava `for update` as `aberta` do par; nenhuma → `Não há comissões em aberto.`; soma > 0 → insere `contas_pagar` (salario, paga, descrição das Global Constraints, `lancada_por = colaborador_atual_id()`) e liga; soma 0 → só marca pagas; devolve o id da conta ou null.
- `resumo_comissoes(p_de date, p_ate date) returns table (profissional_id uuid, nome text, competencia date, qtd int, base bigint, aberto bigint, pago bigint)` (dona; `exigir_dona_leitura_financeiro()`), exclui canceladas, competência entre `date_trunc('month', p_de)` e `p_ate`.

- [ ] **Step 1: Testes (falhando)** em `11_comissoes.db.test.ts`: serviço 30% + profissional 10% → 30%; sem % do serviço → 10%; nenhum → 0 e valor 0; atendido avulso sem cobrança, previsto 20000 e 30% → base 20000, valor 6000, competência = mês SP (agendamento 2026-11-30T23:30-03:00 → 2026-11-01); cobrança depois bruto 20000 desconto 5000 → base 15000 valor 4500; pacote 100000 em 3 sessões → base 33333; desmarcar → cancelada com motivo; remarcar → mesma linha `aberta` (count = 1); `pagar_comissoes` cria conta salario paga com a descrição exata e valor = soma, e `resumo_financeiro` do mês passa a ter esse valor em `pago`; desmarcar atendido com comissão paga → `A comissão deste atendimento já foi paga.` e status do agendamento continua `atendido`; segunda chamada → `Não há comissões em aberto.`; todas 0% → retorno null, nenhuma conta criada; recepção/profissional/anon: 0 linhas em `comissoes`, `colaboradores_comissao`, `servicos_comissao`; recepção chamando `pagar_comissoes` → `Apenas a dona pode lançar contas.`; profissional marcando o próprio atendido gera a comissão.
- [ ] **Step 2:** `pnpm test:db supabase/tests/11_comissoes.db.test.ts` → FAIL.
- [ ] **Step 3:** escrever seções 1–2 da 0011 e `tipos.ts`.
- [ ] **Step 4:** `pnpm test:db` (todas as suítes, sem regressão em 02/07/10) e `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(db): comissões automáticas e pagamento de comissões (0011)`.

### Task 2: Banco — movimentos de estoque e baixa automática

**Files:** Modify `0011_comissoes_estoque.sql` (seções 3–4), `tipos.ts`; Create `supabase/tests/11b_estoque.db.test.ts`.

**Interfaces — Consumes:** Task 1 (gatilho de agendamentos, `exigir_dona_financeiro`, `criar_conta_pagar` de 0010). **Produces:**
- `create type public.tipo_movimento_estoque as enum ('entrada','ajuste','baixa_atendimento','estorno_atendimento')`.
- `public.movimentos_estoque (id, produto_id FK, tipo, quantidade numeric(12,3) not null check <> 0, custo_unitario_centavos int null check ≥ 0, agendamento_id FK null, motivo text null 1–200, conta_pagar_id FK null, responsavel_id FK null, criado_em)`; checks: entrada ⇒ quantidade > 0 e custo não nulo; baixa ⇒ < 0 e agendamento; estorno ⇒ > 0 e agendamento; ajuste ⇒ motivo não nulo. Índices `(produto_id, criado_em)`, `agendamento_id`.
- Gatilho `movimentos_estoque_saldo` (after insert): `set_config('app.movimento_estoque','1',true)`; `update produtos set estoque_atual = estoque_atual + new.quantidade`; volta o marcador a `''`.
- Gatilho `produtos_estoque_protegido` (before insert or update on produtos): insert com `estoque_atual <> 0` ou update que muda `estoque_atual` sem o marcador → `O estoque só muda por entrada ou ajuste.`
- Migração de saldo: para cada produto com `estoque_atual <> 0`, insere `ajuste` com a quantidade atual e motivo `Saldo anterior` **com o gatilho de saldo desativado** (`alter table … disable trigger movimentos_estoque_saldo` / `enable`), de modo que soma dos movimentos = saldo.
- No gatilho de agendamentos (função irmã `agendamentos_estoque`, after insert or update of status): entrando em `atendido` → um `baixa_atendimento` por item de `servico_produtos` do serviço (quantidade negativa); saindo → para cada produto com soma líquida < 0 dos movimentos desse agendamento, `estorno_atendimento` com o oposto. A ordem entre os dois gatilhos não importa; se o de comissão levantar erro, a transação inteira desfaz.
- `entrada_estoque(p_produto uuid, p_quantidade numeric, p_custo_unitario_centavos int, p_lancar_despesa boolean, p_vencimento date, p_fornecedor text) returns uuid` (dona): quantidade ≤ 0 → `A quantidade deve ser maior que zero.`; grava movimento; upsert `produtos_custos.custo_unitario_centavos`; se `p_lancar_despesa` e `round(qtd × custo) > 0` → `criar_conta_pagar('Compra — <nome>', 'produto', p_fornecedor, round(qtd×custo), p_vencimento, null)` e liga `conta_pagar_id`. Devolve o id do movimento.
- `ajustar_estoque(p_produto uuid, p_quantidade_contada numeric, p_motivo text) returns uuid` (dona): contada < 0 → `A quantidade contada não pode ser negativa.`; motivo vazio → `Informe o motivo do ajuste.`; diferença 0 → `O estoque já está com essa quantidade.`; grava `ajuste` com a diferença.
- RLS `movimentos_estoque`: select só dona; sem insert/update/delete para `authenticated`; `revoke delete, truncate … from service_role`.

- [ ] **Step 1: Testes (falhando)** em `11b_estoque.db.test.ts`: serviço com 2 produtos (0,5 ml e 1 un) → atendido baixa 0,5 e 1; desmarcar estorna; atendido → confirmado → atendido: saldo = inicial − 0,5 (uma baixa líquida); remover o produto do serviço depois da baixa e desmarcar → ainda estorna o que baixou; estoque pode ficar negativo; `update produtos set estoque_atual = 10` pela dona → `O estoque só muda por entrada ou ajuste.`; `entrada_estoque(3, 1250, true, '2026-12-10', 'Fornecedor X')` → saldo +3, custo 1250, conta a pagar `produto` aberta valor 3750 descrição `Compra — <nome>`; ajuste para o mesmo valor → mensagem; ajuste sem motivo → mensagem; contada −1 → `A quantidade contada não pode ser negativa.`; soma dos movimentos = `estoque_atual` em todos os produtos após o roteiro; produto com saldo antes da migração (inserido com o gatilho desligado no setup, imitando dado antigo) tem `ajuste` `Saldo anterior`; recepção/profissional: 0 linhas em `movimentos_estoque`, `entrada_estoque` → `Apenas a dona pode lançar contas.`; profissional marcando atendido gera as baixas.
- [ ] **Step 2:** FAIL. **Step 3:** implementar seções 3–4 + `tipos.ts`. **Step 4:** `pnpm test:db`, `pnpm typecheck` → PASS (ajustar fixtures de suítes antigas que inserem produto com estoque ≠ 0, se houver, para usar estoque 0 + ajuste).
- [ ] **Step 5:** commit `feat(db): movimentos de estoque e baixa automática no atendimento (0011)`.

### Task 3: Regras puras e permissões

**Files:** Create `src/lib/dominio/comissoes.ts` (+ test), `src/lib/dominio/estoque.ts` (+ test); Modify `src/lib/dominio/permissoes.ts` (+ test).

**Interfaces — Produces:**
- `percentualEfetivo(servicoPct: number | null, profissionalPct: number | null): number`; `baseComissao(a: { pacote?: { valorTotal: number; totalSessoes: number } | null; cobranca?: { bruto: number; desconto: number } | null; valorPrevisto: number }): number`; `valorComissao(base: number, pct: number): number`; `competenciaDe(inicioIso: string): string /* AAAA-MM-01 */`; `ROTULO_STATUS_COMISSAO`.
- `diferencaAjuste(atual: number, contada: number): number` (3 casas, sem erro de ponto flutuante: trabalhar em milésimos inteiros); `saldoDosMovimentos(qs: number[]): number`; `ROTULO_TIPO_MOVIMENTO`; `formatarCompetencia("2026-11-01") → "11/2026"`.
- `AbaFinanceiro` ganha `"comissoes"` (rótulo `Comissões`, dona, entre `fluxo` e `caixa`); novo `AbaProdutos = "produtos" | "estoque"` com `abasDeProdutos(perfil)` (dona: ambas; recepção/profissional: só `produtos`) e `abaDeProdutos(perfil, pedida)`.
- [ ] **Step 1: Testes (falhando):** 30/10 → 30; null/10 → 10; null/null → 0; pacote 100000/3 → 33333; cobrança 20000−5000 → 15000; sem cobrança → previsto; `valorComissao(33333, 12.5)` → 4167; `competenciaDe("2026-12-01T02:30:00Z")` → `2026-11-01`; `diferencaAjuste(0.1, 0.3)` → 0.2 exato; recepção não tem `comissoes` nem `estoque`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(dominio): regras de comissão e estoque e novas abas`.

### Task 4: Cadastros — % na Equipe e em Serviços, estoque inicial em Produtos, aviso na Agenda

**Files:** Modify `src/app/(app)/equipe/{schemas.ts,actions.ts,[id]/page.tsx}` (+ schemas.test), formulário de colaborador em `src/features/equipe/*`; `src/app/(app)/servicos/{schemas.ts,actions.ts,[id]/page.tsx}` (+ tests); `src/app/(app)/produtos/{schemas.ts,actions.ts,[id]/page.tsx}` (+ tests) e formulário de produto.

**Interfaces — Consumes:** Task 1 tabelas de %; Task 2 `ajustar_estoque`. **Produces:**
- Equipe: campo `comissaoPadraoPct` (texto pt-BR "12,5" → 12.5; vazio = 0; fora de 0–100 → `A comissão deve estar entre 0 e 100%.`), salvo em `colaboradores_comissao` (upsert) após salvar/convidar; carregado só para a dona.
- Serviços: `comissaoPct` opcional (vazio → delete em `servicos_comissao`; valor → upsert), mesma validação e ajuda das Global Constraints.
- Produtos: schema perde `estoqueAtual` na edição; na criação vira `estoqueInicial` (≥ 0); insert com estoque 0 e, se > 0, `rpc('ajustar_estoque', { p_produto, p_quantidade_contada, p_motivo: 'Estoque inicial' })`; falha do ajuste → `O produto foi salvo, mas não foi possível lançar o estoque inicial. <erro>`. Na edição, o estoque aparece só como leitura com link `Ver estoque` (dona) para `/produtos?aba=estoque&produto=<id>`.
- Agenda: a ação que muda status já repassa `mensagemErroBanco`; garantir com teste que `A comissão deste atendimento já foi paga.` chega ao usuário (sem código novo se já repassa).
- [ ] **Step 1: Testes (falhando):** schemas aceitam "12,5", "0", "", recusam "101" e "-1"; `salvarServico` com "" remove a linha de %; `salvarProduto` novo com estoque 4 chama `ajustar_estoque` com motivo `Estoque inicial` e não envia `estoque_atual`; edição não envia `estoque_atual`; recepção não grava %; ação de status repassa a mensagem de comissão paga.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(cadastros): percentual de comissão e estoque inicial por ajuste`.

### Task 5: Financeiro — aba Comissões, Pagar comissões e PDF

**Files:** Create `src/app/(app)/financeiro/{dados-comissoes.ts,actions-comissoes.ts}` (+ tests), `src/features/comissoes/{resumo.tsx,lista.tsx,dialogo-pagar-comissoes.tsx}`; Modify `src/app/(app)/financeiro/page.tsx`, `relatorio.ts` (+ test), `src/features/financeiro/abas.tsx` se preciso.

**Interfaces — Consumes:** Task 1 `resumo_comissoes`, `pagar_comissoes`; Task 3 abas e rótulos; período e PDF da Fase 4. **Produces:**
- `carregarComissoes(supabase, { de, ate, situacao, profissionalId }) → { resumo: LinhaResumo[]; linhas: LinhaComissao[] }` — linhas com data do atendimento, cliente, serviço, profissional, base, %, valor, status; filtro de situação `Todas | Em aberto (padrão) | Pagas | Canceladas` e de profissional.
- `pagarComissoes(e: { profissionalId; competencia: "AAAA-MM-01"; pagoEm; forma })` (`exigirPerfil("dona")`) → `Resultado`; revalida `/financeiro`.
- Tela: resumo por profissional e mês (atendimentos, base, a pagar, pago) com `Pagar comissões` quando a pagar > 0; diálogo mostra o total e pede data (padrão hoje) e forma (sem `a_receber`).
- PDF: `AbaRelatorio` ganha `comissoes` com colunas `Data, Cliente, Serviço, Profissional, Base, %, Valor, Situação` e totais `A pagar`, `Pago`.
- [ ] **Step 1: Testes (falhando):** recepção → negado sem chamar o banco; competência inválida recusada; mensagem `Não há comissões em aberto.` repassada; `carregarComissoes` monta resumo/linhas a partir de linhas de exemplo e aplica o filtro padrão Em aberto; relatório da aba comissoes tem as colunas e totais acima.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(financeiro): aba Comissões com pagamento e PDF`.

### Task 6: Produtos — aba Estoque, entrada, ajuste e histórico

**Files:** Create `src/app/(app)/produtos/{dados-estoque.ts,actions-estoque.ts}` (+ tests), `src/features/estoque/{aba-estoque.tsx,dialogo-entrada.tsx,dialogo-ajuste.tsx,historico.tsx}`; Modify `src/app/(app)/produtos/page.tsx` (abas por `?aba=`), `src/app/(app)/produtos/[id]/page.tsx` (histórico do produto, dona).

**Interfaces — Consumes:** Task 2 `entrada_estoque`, `ajustar_estoque`, `movimentos_estoque`; Task 3 `abasDeProdutos`, `ROTULO_TIPO_MOVIMENTO`. **Produces:**
- `registrarEntrada(e: { produtoId; quantidade: string /* "1,5" */; custo: string /* "12,50" */; lancarDespesa: boolean; vencimento?; fornecedor? })`, `ajustarEstoque(e: { produtoId; contada: string; motivo })` (dona) → `Resultado`; revalidam `/produtos` e `/inicio`.
- `carregarEstoque(supabase, { produtoId?, de, ate })` → produtos (estoque, mínimo, custo, `abaixo` flag) e movimentos (data, produto, tipo, quantidade com sinal, custo, motivo/agendamento, responsável), mais recentes primeiro, limite 200.
- Tela: `Abaixo do mínimo` no topo; tabela com ações `Entrada` e `Ajuste`; histórico com filtro de produto e período (reaproveitar o filtro de período do Financeiro se servir, senão últimos 30 dias). Recepção/profissional: página como hoje, sem abas.
- [ ] **Step 1: Testes (falhando):** quantidade "1,5" → 1.5; "0" na entrada recusado antes do banco; vencimento obrigatório quando `lancarDespesa`; mensagens do banco repassadas (`O estoque já está com essa quantidade.`); recepção negada; `carregarEstoque` marca `abaixo` quando estoque ≤ mínimo em produto ativo.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(estoque): aba Estoque com entrada, ajuste e histórico`.

### Task 7: Telas de ponta a ponta e documentação

**Files:** Create `e2e/comissoes-estoque.spec.ts`; Modify `docs/implantacao.md`.

- [ ] **Step 1:** `e2e/comissoes-estoque.spec.ts` (com backend, `pularSemBackend`, dados únicos por execução, trava compartilhada `e2e/trava-caixa.ts` quando mexer em caixa, limpeza tolerante — padrão de `e2e/financeiro.spec.ts`), nos 3 tamanhos: dona configura 20% no serviço; recepção marca atendido; dona vê a comissão em aberto na aba Comissões e o estoque baixado na aba Estoque; `Pagar comissões` → situação Paga e despesa em Contas a pagar; entrada e ajuste mudam o estoque; recepção não vê as abas `Comissões` nem `Estoque`.
- [ ] **Step 2:** `pnpm e2e` (backend pulado), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build` → PASS.
- [ ] **Step 3:** `docs/implantacao.md` seção "Fase 4B — Comissões e estoque": aplicar 0011 em testes e produção antes do merge; conferências (`pg_policies` em `comissoes`, `movimentos_estoque`, `colaboradores_comissao`, `servicos_comissao`; para todo produto, soma de `movimentos_estoque.quantidade` = `estoque_atual`); depois de publicar: dona preenche % padrão e % por serviço e confere produtos por serviço; linha "Estado atual: 0011 ainda não aplicada".
- [ ] **Step 4:** commit `test(e2e)+docs: comissões e estoque de ponta a ponta e implantação da Fase 4B`.
