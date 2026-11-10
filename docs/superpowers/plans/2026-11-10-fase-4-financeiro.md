# Fase 4 — Financeiro: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a seção "Caixa" por **Financeiro**: painel com 7 cartões e filtro de período, contas a pagar (com contas fixas, vale e anexo), contas a receber (com baixa no caixa do dia e lançamento manual), fluxo de caixa, relatório em PDF e avisos de vencimento no sininho.

**Architecture:** Todo número vem do Postgres (`resumo_financeiro`, `fluxo_caixa`) e toda escrita passa por funções `security definer`; RLS garante dona-tudo / recepção-só-caixa-do-dia / profissional-nada. A tela é uma rota `/financeiro` com abas por `?aba=` e período por `?periodo=`, Server Components para ler e Server Actions para escrever, como nas fases anteriores. O espelho em TypeScript (`src/lib/dominio/financeiro.ts`) cobre períodos, situação, marcos de aviso e competência — testável sem banco. PDF com `pdf-lib` (já no projeto).

**Tech Stack:** o das Fases 1–3A. Sem dependência nova (gráfico em SVG à mão).

**Spec:** `docs/superpowers/specs/2026-11-09-fase-4-financeiro-design.md` (autoridade).

## Global Constraints

- Tudo das Global Constraints das Fases 1–3A continua valendo (pt-BR, fuso `America/Sao_Paulo`, **centavos inteiros**, perfis `dona | recepcao | profissional`, RLS em toda tabela, toque ≥ 44 px, viewports 1440/1024/390, `pnpm test:db` local com `shim.sql` só de teste, `tipos.ts` à mão na mesma tarefa da migração, mensagens P0001 exatas).
- Migração nova única: `supabase/migrations/0010_financeiro.sql` (Tasks 1–3 escrevem nela; não aplicada em lugar nenhum até a Task 10). Funções novas: `set search_path = ''`, `revoke ... from public, anon, authenticated`, `grant` só a quem chama.
- **Nada é apagado:** sem privilégio de `delete` em `contas_pagar`, `contas_fixas`, `contas_receber`, `recebimentos`; cancelar exige motivo (1–200 caracteres).
- Categorias exatas: `aluguel`, `fornecedor`, `produto`, `salario`, `imposto`, `vale`, `outros` (rótulos: Aluguel, Fornecedor, Produto, Salário, Imposto, Vale, Outros).
- Período: `?periodo=` ∈ `mes` (padrão) | `mes_passado` | `proximo_mes` | `ano` | `tudo` | `personalizado` (`&de=AAAA-MM-DD&ate=AAAA-MM-DD`, de ≤ ate); intervalo fechado [de, ate] em dias de São Paulo. `tudo` = de `2000-01-01` até hoje + 5 anos. Fluxo agrupa por mês quando o período tem mais de 62 dias.
- Situação (exibição): `paga`/`recebida` 🟢 · `aberta` com vencimento ≥ hoje 🟡 "Em aberto" · `aberta` com vencimento < hoje 🔴 "Vencida" · `cancelada` ⚫.
- Marcos de aviso: d = vencimento − hoje (SP). Aviso se d ∈ {7, 3, 1, 0} ou d < 0 (um por dia). Chave: `<pagar|receber>:<id>:<d>` para d ≥ 0 e `<pagar|receber>:<id>:vencida:<AAAA-MM-DD de hoje>` para d < 0. Textos: `vence em 7 dias` / `vence em 3 dias` / `vence amanhã` / `vence hoje` / `vencida há 1 dia` / `vencida há N dias`.
- Contas fixas: gera competências até o fim do **mês seguinte** a hoje; dia > último dia do mês → último dia do mês.
- Anexo: bucket privado `financeiro`, `file_size_limit 5242880`, `allowed_mime_types {image/jpeg,image/png,application/pdf}`, caminho `contas_pagar/<uuid>.<jpg|png|pdf>`; URL assinada 300 s; envio e leitura só dona.
- Mensagens exatas (P0001): `Esta parcela já foi recebida.` · `Abra o caixa do dia antes de receber.` · `Esta conta já foi paga.` · `Esta conta foi cancelada.` · `Informe o motivo do cancelamento.` · `Apenas a dona pode lançar contas.`
- Rótulos e textos de tela: menu **Financeiro** (ícone `Wallet`), título **Financeiro**, subtítulo `Atendimentos, pacotes e despesas da clínica`; cartões `Recebido`, `Pago`, `Saldo em caixa`, `A receber`, `A pagar`, `Saldo projetado`, `Vencidos`; abas `Painel`, `Contas a receber`, `Contas a pagar`, `Fluxo de caixa`, `Caixa do dia`; botões `Lançar vale`, `Despesa com foto/PDF`, `Novo lançamento`, `Exportar PDF`.
- Paleta da clínica (tokens existentes em `src/app/globals.css`); cartão "Saldo em caixa" em dourado (`bg-ouro`/`text-primary-foreground`); Vencidos em fundo vermelho claro.
- **Não aplicar 0010 na produção** neste plano.

## Review Focus

1. **Parcela "a receber" de um pagamento e o mesmo valor contado duas vezes** no Recebido (uma vez como pagamento `a_receber`, outra no recebimento): Recebido deve excluir pagamentos com forma `a_receber` e somar só os recebimentos → testes em Task 3 (SQL) e Task 4 (TS).
2. **Fechar o caixa com parcelas recebidas no dia**: total por forma e dinheiro esperado incluem os recebimentos → teste em Task 2.
3. **Conta fixa com dia 31 em fevereiro e virada de ano** (gerar em 15/12 cria dezembro e janeiro, uma vez só, mesmo chamando duas vezes) → testes em Tasks 1 e 4.
4. **Recepção tentando ler contas a pagar, totais ou o PDF por URL direta** → 0 linhas / erro / redirect → testes em Tasks 1–3, 5 e 9.
5. **Período personalizado invertido ou com data inválida** (`de=2026-12-31&ate=2026-01-01`, `de=2026-02-30`) → cai no padrão "Este mês" sem erro → teste em Task 4.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/0010_financeiro.sql` | tipos, tabelas, bucket, RLS, funções |
| `supabase/tests/10_financeiro.db.test.ts` | testes de banco |
| `src/lib/supabase/tipos.ts` | tipos novos |
| `src/lib/dominio/financeiro.ts` (+ test) | períodos, situação, avisos, competência, resumo puro |
| `src/lib/dominio/permissoes.ts` (+ test) | recurso `financeiro` |
| `src/app/(app)/financeiro/page.tsx`, `actions.ts` (+ test), `schemas.ts`, `dados.ts` (+ test), `exportar/route.ts` (+ test) | rota |
| `src/app/(app)/caixa/page.tsx` | redirect para `/financeiro?aba=caixa` |
| `src/features/financeiro/*` | cabeçalho, filtro, cartões, abas, listas, diálogos, gráfico |
| `src/lib/financeiro/pdf-relatorio.ts` (+ test) | PDF |
| `src/features/avisos/*`, `src/app/(app)/layout.tsx`, `src/features/inicio/*` | sininho e cartão "Contas vencendo" |
| `e2e/financeiro.spec.ts`, `docs/implantacao.md` | telas e implantação |

---

### Task 1: Banco — contas a pagar, contas fixas, vale e anexo

**Files:** Create `supabase/migrations/0010_financeiro.sql` (seções 1–3), `supabase/tests/10_financeiro.db.test.ts`; Modify `src/lib/supabase/tipos.ts`.

**Interfaces — Produces:**
- Enums `public.categoria_despesa` (valores das Global Constraints) e `public.status_conta ('aberta','paga','cancelada')`.
- `public.contas_fixas (id, descricao text 1–120, categoria, fornecedor text null ≤120, valor_centavos int > 0, dia_vencimento int 1–31, ativa bool default true, inicio date (1º dia do mês), criado_por, criado_em, atualizado_em)`.
- `public.contas_pagar (id, descricao 1–120, categoria, fornecedor null, colaborador_id null FK, valor_centavos > 0, vencimento date, status default 'aberta', pago_em date null, forma public.forma_pagamento null check <> 'a_receber', anexo_path text null check ~ '^contas_pagar/[0-9a-f-]{36}\.(jpg|png|pdf)$', conta_fixa_id null FK, competencia date null, cancelada_motivo, cancelada_em, cancelada_por, lancada_por, criado_em, atualizado_em)`; `unique (conta_fixa_id, competencia)`; check: `status='paga'` ⇔ `pago_em` e `forma` não nulos; `status='cancelada'` ⇔ campos de cancelamento não nulos; `categoria='vale'` ⇔ `colaborador_id` não nulo.
- RLS: as duas tabelas só `perfil_atual()='dona'` (select); sem insert/update/delete para `authenticated` (escrita por funções).
- Funções (dona; senão `Apenas a dona pode lançar contas.`):
  - `criar_conta_pagar(p_descricao, p_categoria, p_fornecedor, p_valor_centavos, p_vencimento date, p_anexo_path text) returns uuid`
  - `editar_conta_pagar(p_conta, p_descricao, p_categoria, p_fornecedor, p_valor_centavos, p_vencimento, p_anexo_path) returns void` — só `aberta`.
  - `pagar_conta(p_conta uuid, p_pago_em date, p_forma forma_pagamento) returns void` — `for update`; paga → `Esta conta já foi paga.`; cancelada → `Esta conta foi cancelada.`
  - `cancelar_conta_pagar(p_conta, p_motivo text) returns void` — motivo vazio → `Informe o motivo do cancelamento.`; já paga → `Esta conta já foi paga.`
  - `lancar_vale(p_colaborador uuid, p_valor_centavos int, p_data date, p_forma forma_pagamento, p_obs text) returns uuid` — cria conta `vale` já `paga` (descricao `Vale — <nome da colaboradora>` + obs).
  - `criar_conta_fixa(p_descricao, p_categoria, p_fornecedor, p_valor_centavos, p_dia int, p_inicio date) returns uuid`; `desativar_conta_fixa(p_id) returns void`.
  - `gerar_contas_fixas(p_ate date) returns int` — para cada fixa ativa e cada competência de `inicio` até o mês de `p_ate`, insere a conta (`on conflict do nothing`), vencimento = dia ou último dia do mês; devolve quantas criou.
- Bucket `financeiro` + políticas `financeiro_select`/`financeiro_insert` em `storage.objects` só dona e caminho da regex acima (padrão de 0006: insert no bucket, sem `alter table storage.objects`).

- [ ] **Step 1: Testes de banco (falhando)**: recepção/profissional/anon não leem `contas_pagar` nem `contas_fixas` (0 linhas ou 42501); recepção chamando `criar_conta_pagar` → `Apenas a dona pode lançar contas.`; `pagar_conta` duas vezes → `Esta conta já foi paga.`; cancelar sem motivo → mensagem; delete por authenticated → 42501; `lancar_vale` cria paga com categoria vale e colaborador; `gerar_contas_fixas('2027-01-31')` com fixa dia 31 iniciada em 2026-11 cria nov(30), dez(31), jan(31) = 3 e a segunda chamada devolve 0; fixa iniciada em 2027-02 dia 31 → vencimento 2027-02-28; storage: recepção não insere em `financeiro`.
- [ ] **Step 2:** `pnpm test:db supabase/tests/10_financeiro.db.test.ts` → FAIL.
- [ ] **Step 3:** escrever seções 1–3 da 0010 e `tipos.ts`.
- [ ] **Step 4:** `pnpm test:db` (todos) e `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(db): contas a pagar, contas fixas, vale e anexo (0010)`.

### Task 2: Banco — contas a receber manuais, recebimentos e fechamento do caixa

**Files:** Modify `0010_financeiro.sql` (seções 4–5), `10_financeiro.db.test.ts`, `tipos.ts`.

**Interfaces — Consumes:** Task 1 (`status_conta` não é usado aqui; contas_receber mantém `recebido_em`). **Produces:**
- `contas_receber` ganha `descricao text null ≤120`, `origem_manual bool not null default false`, `cancelada_motivo/em/por`, `lancada_por`; `pagamento_id` passa a nullable; check `origem_manual = (pagamento_id is null)`; manual exige `descricao`.
- `public.recebimentos (id, conta_receber_id uuid unique FK, caixa_id FK, forma forma_pagamento check <> 'a_receber', valor_centavos > 0, recebido_por, recebido_em timestamptz default now())`.
- `criar_conta_receber(p_cliente, p_descricao, p_valor_centavos, p_vencimento) returns uuid` (dona) — manual, `numero=1,total_parcelas=1`.
- `cancelar_conta_receber(p_conta, p_motivo)` (dona) — só em aberto.
- `receber_parcela(p_conta uuid, p_forma forma_pagamento) returns uuid` (dona/recepção) — caixa de hoje aberto `for share` (senão `Abra o caixa do dia antes de receber.`); conta `for update`, não cancelada (`Esta conta foi cancelada.`) e não recebida; insere `recebimentos` com o valor da parcela e grava `recebido_em`; 23505 → `Esta parcela já foi recebida.`
- `fechar_caixa` recriado (`create or replace`, mesma assinatura e retorno) somando por forma `pagamentos (valor − desconto, excluindo forma a_receber)` + `recebimentos` do caixa.
- RLS: `contas_receber` dona tudo; recepção vê `recebido_em is null and cancelada_em is null and vencimento <= hoje` **ou** recebidas em recebimento do caixa aberto de hoje. `recebimentos`: dona tudo; recepção só do caixa aberto de hoje.

- [ ] **Step 1: Testes (falhando):** `receber_parcela` sem caixa → mensagem; duas vezes (inclusive em duas conexões) → uma ok, outra `Esta parcela já foi recebida.`; cancelada → mensagem; recepção recebe e vê a parcela; recepção não vê parcela vencendo amanhã; `fechar_caixa` com pagamento pix 100,00 + recebimento pix 50,00 → pix 15000 e total 15000 (pagamento `a_receber` não entra); manual sem descrição → erro; profissional não vê nada.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar + `tipos.ts`. **Step 4:** `pnpm test:db`, `pnpm typecheck` → PASS (inclusive suítes 03/07 de caixa sem regressão).
- [ ] **Step 5:** commit `feat(db): contas a receber manuais, recebimentos no caixa e fechamento (0010)`.

### Task 3: Banco — resumo, fluxo de caixa e avisos lidos

**Files:** Modify `0010_financeiro.sql` (seção 6), testes, `tipos.ts`.

**Interfaces — Produces** (todas dona; outros perfis → `Acesso não autorizado`):
- `resumo_financeiro(p_de date, p_ate date) returns table (recebido bigint, recebido_qtd int, pago bigint, pago_qtd int, a_receber bigint, ja_recebido bigint, a_pagar bigint, ja_pago bigint, vencidos_qtd int, vencidos_total bigint)`:
  - recebido = Σ `pagamentos.valor − desconto` com forma ≠ `a_receber` e data do caixa em P + Σ `recebimentos.valor` com `recebido_em` (SP) em P; qtd = nº de linhas somadas.
  - pago = Σ `contas_pagar.valor` com status `paga` e `pago_em` em P.
  - a_receber = Σ contas_receber em aberto (não canceladas, não recebidas) com vencimento em P; ja_recebido = Σ recebidas com vencimento em P.
  - a_pagar / ja_pago análogos em contas_pagar (`aberta` / `paga`, vencimento em P).
  - vencidos = contas em aberto (pagar + receber) com vencimento < hoje, qualquer P.
  - Saldo em caixa e projetado são calculados na tela (recebido − pago; + a_receber − a_pagar).
- `fluxo_caixa(p_de date, p_ate date, p_agrupar text /* 'dia'|'mes' */) returns table (periodo date, entradas bigint, saidas bigint)` — só períodos com movimento; e `fluxo_por_forma(p_de, p_ate) returns table (forma forma_pagamento, total bigint)`, `despesas_por_categoria(p_de, p_ate) returns table (categoria categoria_despesa, total bigint)`.
- `public.avisos_lidos (colaborador_id FK, chave text 1–120, lido_em default now(), primary key (colaborador_id, chave))`; RLS: dona lê os próprios; `marcar_avisos_lidos(p_chaves text[]) returns void` (dona, `on conflict do nothing`).
- `public.relatorios_gerados (id, colaborador_id FK, aba text, de date, ate date, gerado_em default now())`; RLS: só dona lê; `registrar_relatorio(p_aba text, p_de date, p_ate date) returns void` (dona).

- [ ] **Step 1: Testes (falhando):** cenário fixo (pagamento 200,00 com 20,00 de desconto em 2026-11-05; pagamento `a_receber` 300,00 em 3 parcelas de 100,00 vencendo 05/11, 05/12, 05/01, a primeira recebida em 06/11; conta paga 80,00 em 10/11; conta aberta 50,00 vencendo 03/11; conta cancelada 999,00) → novembro: recebido 28000 (qtd 2), pago 8000, a_receber 0, ja_recebido 10000, a_pagar 5000, vencidos inclui a de 03/11; cancelada nunca entra; `fluxo_caixa` de novembro por dia tem 05/11 = 18000 entrada, 06/11 = 10000, 10/11 = 8000 saída; recepção chamando `resumo_financeiro` → erro; `marcar_avisos_lidos` idempotente.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test:db`, `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(db): resumo financeiro, fluxo de caixa e avisos lidos (0010)`.

### Task 4: Regras puras do financeiro

**Files:** Create `src/lib/dominio/financeiro.ts`, `src/lib/dominio/financeiro.test.ts`.

**Interfaces — Produces:**
- `type FiltroPeriodo = "mes" | "mes_passado" | "proximo_mes" | "ano" | "tudo" | "personalizado"`.
- `periodoDoFiltro(p: { periodo?: string; de?: string; ate?: string }, agora: Date): { filtro: FiltroPeriodo; de: string; ate: string; rotulo: string }` — inválido/invertido → `mes`; rótulos `Novembro de 2026`, `Outubro de 2026`, `2026`, `Tudo`, `01/11/2026 a 15/11/2026`.
- `agrupamento(de: string, ate: string): "dia" | "mes"` (> 62 dias → mes).
- `situacaoConta(c: { status: "aberta"|"paga"|"cancelada"; vencimento: string }, hoje: string): "paga" | "em_aberto" | "vencida" | "cancelada"` (receber: mapear recebida→paga no chamador).
- `type ContaAviso = { tipo: "pagar" | "receber"; id: string; nome: string; valorCentavos: number; vencimento: string; parcela?: string }`.
- `avisosPendentes(contas: ContaAviso[], hoje: string, lidas: Set<string>): { chave: string; texto: string; conta: ContaAviso; dias: number }[]` — Global Constraints; ordenado por vencimento.
- `vencimentoDaCompetencia(competencia: string /* AAAA-MM-01 */, dia: number): string`.
- `saldos(r: { recebido: number; pago: number; aReceber: number; aPagar: number }): { saldoCaixa: number; saldoProjetado: number }`.

- [ ] **Step 1: Testes (falhando):** `periodoDoFiltro({periodo:"mes_passado"}, 2027-01-10)` → de `2026-12-01` ate `2026-12-31`; `proximo_mes` em 2026-12-20 → `2027-01-01..2027-01-31`; personalizado invertido e `de=2026-02-30` → `mes`; meia-noite SP (2026-12-01T02:30Z = 30/11 23:30 SP) → novembro; `agrupamento` 62 vs 63 dias; `situacaoConta` vence hoje → em_aberto, ontem → vencida; `avisosPendentes`: d=7,3,1,0 geram textos exatos, d=2 não, d=−1 `vencida há 1 dia`, d=−10 `vencida há 10 dias`, chave vencida muda com o dia, lida não aparece; `vencimentoDaCompetencia("2028-02-01",31)` = `2028-02-29`, `("2027-02-01",31)` = `2027-02-28`, `("2026-11-01",31)` = `2026-11-30`; `saldos`.
- [ ] **Step 2:** `pnpm test src/lib/dominio/financeiro.test.ts` → FAIL. **Step 3:** implementar (reusar `tempo.ts`). **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(financeiro): regras de período, situação, avisos e competência`.

### Task 5: Rota `/financeiro`, menu, filtro, cartões e painel

**Files:** Create `src/app/(app)/financeiro/page.tsx`, `dados.ts` (+ test), `src/features/financeiro/{cabecalho.tsx,filtro-periodo.tsx,cartoes.tsx,abas.tsx,painel.tsx}`; Modify `src/lib/dominio/permissoes.ts` (+ test), `src/app/(app)/caixa/page.tsx` (redirect), mover o conteúdo de caixa para `src/features/financeiro/aba-caixa.tsx` reaproveitando `src/features/caixa/*`.

**Interfaces — Consumes:** Task 3 `resumo_financeiro`; Task 4 `periodoDoFiltro`, `saldos`. **Produces:**
- Recurso `financeiro` substitui `caixa` (rótulo `Financeiro`, href `/financeiro`, ícone `Wallet`, perfis dona e recepção). `perfisComAcesso("financeiro")` = dona, recepcao.
- `carregarResumo(supabase, de, ate): Promise<Resumo>` em `dados.ts`, chamando antes `gerar_contas_fixas(fim do mês seguinte)`.
- Página: `?aba=` ∈ `painel` (padrão dona) | `receber` | `pagar` | `fluxo` | `caixa` (único permitido à recepção; qualquer outra aba para recepção → `caixa`). Cabeçalho/filtro/cartões só para dona. `/caixa` → `redirect("/financeiro?aba=caixa")`.
- Painel: 7 cartões (Global Constraints) + "Próximos vencimentos (7 dias)" (pagar e receber em aberto, d 0..7).
- [ ] **Step 1: Testes (falhando):** `permissoes.test.ts` (recepção acessa `financeiro`; profissional não; item de menu `Financeiro` em `/financeiro`); `dados.test.ts` (`carregarResumo` chama `gerar_contas_fixas` antes de `resumo_financeiro` com as datas certas; mapeia snake_case → camelCase).
- [ ] **Step 2:** FAIL. **Step 3:** implementar página, componentes e redirect. **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(financeiro): seção Financeiro com período, cartões e painel`.

### Task 6: Aba Contas a pagar, Novo lançamento, Lançar vale e Despesa com foto/PDF

**Files:** Create `src/app/(app)/financeiro/actions.ts` (+ test), `schemas.ts`, `src/features/financeiro/{lista-pagar.tsx,dialogo-conta-pagar.tsx,dialogo-pagar.tsx,dialogo-cancelar.tsx,dialogo-vale.tsx,dialogo-novo-lancamento.tsx,anexo.ts}`.

**Interfaces — Consumes:** Task 1 RPCs; Task 4 `situacaoConta`. **Produces (ações, todas `exigirPerfil("dona")`):** `criarContaPagar(e)`, `editarContaPagar(e)`, `pagarConta(e: { contaId; pagoEm; forma })`, `cancelarConta(e: { tipo: "pagar"|"receber"; contaId; motivo })`, `lancarVale(e: { colaboradorId; valor: string /* "1.234,56" */; data; forma; obs? })`, `criarContaFixa(e)`, `desativarContaFixa(id)`, `urlAnexo(contaId): Promise<{ ok: true; url } | { ok: false; erro }>` (signed 300 s). Valores digitados em reais convertidos com o parser de dinheiro existente (`src/lib/dominio/dinheiro.ts`). `listarContasPagar(supabase, { de, ate, situacao, busca, categoria })` em `dados.ts`.
- Anexo: `anexo.ts` envia do navegador ao bucket `financeiro` com o JWT da dona, caminho `contas_pagar/<uuid>.<ext>` (JPEG/PNG/PDF ≤ 5 MB; outro → `Escolha uma foto (JPEG ou PNG) ou um PDF de até 5 MB.`); "Despesa com foto/PDF" = diálogo de nova conta com o anexo obrigatório; "Novo lançamento" pergunta `Conta a pagar` / `Conta a receber`.
- Lista: filtros situação (padrão Em aberto), busca, categoria; colunas da spec §3.4.
- [ ] **Step 1: Testes (falhando)** em `actions.test.ts`: recepção → negado sem chamar o banco; valor `"1.234,56"` vira `123456`; `pagarConta` repassa mensagem `Esta conta já foi paga.`; `cancelarConta` sem motivo recusado antes do banco; `lancarVale` chama a RPC com os argumentos certos; conta fixa dia 0 ou 32 recusada; `urlAnexo` usa 300 s; `listarContasPagar` aplica filtros de situação (vencida = aberta e vencimento < hoje).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck` → PASS.
- [ ] **Step 5:** commit `feat(financeiro): contas a pagar, contas fixas, vale e despesa com anexo`.

### Task 7: Abas Contas a receber, Fluxo de caixa e receber no Caixa do dia

**Files:** Modify `actions.ts` (+ test), `dados.ts` (+ test); Create `src/features/financeiro/{lista-receber.tsx,dialogo-receber.tsx,dialogo-conta-receber.tsx,fluxo.tsx,grafico-fluxo.tsx,receber-hoje.tsx}`.

**Interfaces — Consumes:** Tasks 2–4. **Produces:** `receberParcela(e: { contaId; forma })` (`exigirPerfil("dona","recepcao")`), `criarContaReceber(e: { clienteId; descricao; valor; vencimento })` (dona); `listarContasReceber(supabase, filtros)`; `carregarFluxo(supabase, de, ate)` → `{ linhas: { periodo; entradas; saidas; saldo; acumulado }[]; porForma; porCategoria }` com `agrupamento()`.
- Aba Caixa do dia ganha o bloco `Parcelas a receber hoje e vencidas` (lista + Receber) para dona e recepção.
- Gráfico: barras SVG entradas × saídas por período, acessível (`role="img"` + `aria-label` com totais).
- [ ] **Step 1: Testes (falhando):** `receberParcela` por profissional negado; mensagens `Abra o caixa do dia antes de receber.` e `Esta parcela já foi recebida.` repassadas; `carregarFluxo` calcula saldo e acumulado a partir de linhas `[{05/11, 18000, 0}, {10/11, 0, 8000}]` → acumulado `18000, 10000`; `criarContaReceber` valida descrição e valor.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(financeiro): contas a receber, receber no caixa do dia e fluxo de caixa`.

### Task 8: Sininho de avisos e cartão "Contas vencendo"

**Files:** Create `src/features/avisos/{sininho.tsx,dados.ts,dados.test.ts,actions.ts}`; Modify `src/app/(app)/layout.tsx`, `src/features/inicio/{dados.ts,cartoes.tsx}`, `src/app/(app)/inicio/page.tsx`.

**Interfaces — Consumes:** Task 3 `avisos_lidos`/`marcar_avisos_lidos`; Task 4 `avisosPendentes`. **Produces:** `carregarAvisos(supabase, hoje): Promise<AvisoItem[]>` (contas em aberto pagar+receber com vencimento ≤ hoje + 7, exclui lidas); ação `marcarAvisosLidos(chaves: string[])` (dona). Sininho só para dona: badge com contagem (máx. "9+"), lista com `nome — R$ valor — texto`, link para `/financeiro?aba=pagar|receber&conta=<id>`, botão `Marcar todos como lidos`. Início (dona): cartão `Contas vencendo` com os 5 primeiros.
- [ ] **Step 1: Testes (falhando)** em `dados.test.ts`: lida não volta; conta paga não aparece; ordem por vencimento; layout não consulta avisos para recepção (teste do carregador com perfil).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `pnpm test`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(avisos): sininho de vencimentos e cartão Contas vencendo`.

### Task 9: Relatório em PDF

**Files:** Create `src/lib/financeiro/pdf-relatorio.ts` (+ test), `src/app/(app)/financeiro/exportar/route.ts` (+ test).

**Interfaces — Consumes:** Tasks 5–7 carregadores; `textoSeguroWinAnsi` de `src/lib/ficha/pdf-termo.ts`; logo `public/brand/logo-madame-fe.png`. **Produces:**
- `gerarPdfRelatorio(d: { aba: "painel"|"receber"|"pagar"|"fluxo"; periodoRotulo: string; filtros: string[]; geradoPor: string; geradoEm: Date; cartoes?: Resumo; colunas: string[]; linhas: string[][]; totais: [string, string][] }): Promise<Uint8Array>` — A4 retrato, cabeçalho com logo + "Madame Fê Clinic" + título da aba + período + filtros + "Gerado em dd/MM/aaaa HH:mm por <nome>", tabela com quebra de página e repetição do cabeçalho da tabela, rodapé `Página N de M`.
- `GET /financeiro/exportar?aba=&periodo=&de=&ate=&situacao=&busca=&categoria=` — `exigirPerfil("dona")` (recepção → 403), `maxDuration = 60`, `Content-Disposition: attachment; filename="financeiro-<aba>-<de>-<ate>.pdf"`; chama `registrar_relatorio` (Task 3) antes de gerar.
- [ ] **Step 1: Testes (falhando):** PDF com 300 linhas tem ≥ 2 páginas e o texto extraído contém título, período e totais (mesmo método de extração usado em `pdf-termo.test.ts`); rota com recepção → 403; rota chama `registrar_relatorio` com aba/de/ate; parâmetros inválidos → período padrão; nome do arquivo.
- [ ] **Step 2:** FAIL. **Step 3:** implementar + botão `Exportar PDF` no cabeçalho apontando para a rota com os filtros atuais. **Step 4:** `pnpm test`, `pnpm typecheck`, `pnpm build` → PASS.
- [ ] **Step 5:** commit `feat(financeiro): relatório em PDF por aba e período`.

### Task 10: Telas de ponta a ponta e documentação

**Files:** Create `e2e/financeiro.spec.ts`; Modify `docs/implantacao.md`, `README.md`.

- [ ] **Step 1:** `e2e/financeiro.spec.ts` (com backend, guardado por `pularSemBackend`; dados únicos por execução e limpeza, padrão de `e2e/agendar.spec.ts`), nos 3 tamanhos: dona cria conta fixa e vê a do mês; marca paga e o cartão Pago muda; recepção vê só `Caixa do dia` e recebe uma parcela; filtro `Mês passado` muda o rótulo; `Exportar PDF` baixa `application/pdf`; sininho mostra aviso e some após `Marcar todos como lidos`; `/caixa` redireciona.
- [ ] **Step 2:** `pnpm e2e` (backend pulado), `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:db`, `pnpm build` → PASS.
- [ ] **Step 3:** `docs/implantacao.md` seção "Fase 4 — Financeiro": aplicar 0010 em testes e produção antes do merge; conferências (`select count(*) from pg_policies where tablename in ('contas_pagar','contas_fixas','recebimentos','avisos_lidos')`, bucket `financeiro` privado 5 MB, `fechar_caixa` soma recebimentos); linha "Estado atual: 0010 ainda não aplicada".
- [ ] **Step 4:** commit `test(e2e)+docs: Financeiro de ponta a ponta e implantação da Fase 4`. (A aplicação da 0010 no projeto de testes é feita pelo controlador depois da revisão final.)
