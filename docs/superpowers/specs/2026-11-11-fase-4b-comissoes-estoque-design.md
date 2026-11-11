# Fase 4B — Comissões automáticas e estoque com baixa automática

Data: 2026-11-11 · Base: spec geral `2026-11-02-sistema-madame-fe-design.md` §5.1–5.2, §5.6, §6.3 (passos 2–3), §6.4 e §9 (Fase 4). Complementa a Fase 4 (`2026-11-09-fase-4-financeiro-design.md`). Desenho aprovado pelo usuário em 2026-11-11 (ritmo acelerado: detalhes decididos com bom senso).

## 1. Objetivo e aceite

Ao marcar um agendamento como **atendido**, o sistema gera a comissão da profissional e dá baixa nos produtos que o serviço consome. A dona acompanha e paga comissões no Financeiro e controla o estoque (entradas, ajustes, histórico) em Produtos.

**Aceite:**
- Marcar "atendido" gera exatamente uma comissão e as baixas de estoque do serviço; desfazer o "atendido" cancela a comissão e devolve o estoque.
- A comissão usa a % do serviço ou, se vazia, a % padrão da profissional; a base é o valor efetivo do atendimento (§3.2) e acompanha a cobrança lançada depois.
- "Pagar comissões" de uma profissional num mês marca todas como pagas e lança uma despesa paga (categoria `salario`) que aparece no Pago e no Fluxo de caixa.
- O estoque só muda por movimentos; o histórico soma exatamente o estoque atual.
- Recepção e profissional não leem comissões, movimentos de estoque nem custos (RLS), e não veem as telas.
- Funciona em 390 / 1024 / 1440 px.

**Fora do escopo:** venda de produto no caixa; a profissional ver a própria comissão; comissão por produto vendido; metas.

## 2. Decisões

| Tema | Decisão |
|---|---|
| % de comissão | % do serviço (opcional) sobrepõe a % padrão da profissional (padrão 0). Ambas 0–100 com até 2 casas, guardadas em tabelas só da dona (como `produtos_custos`), porque `colaboradores` e `servicos` são lidos por todos |
| Base avulso | Cobrança do agendamento (bruto − desconto) se existir; senão `valor_previsto_centavos` |
| Base pacote | `valor_total_centavos ÷ total_sessoes` do pacote (arredondado ao centavo) |
| Cobrança lançada depois | Recalcula base e valor da comissão enquanto ela estiver `aberta` |
| Valor | `round(base × % / 100)` em centavos |
| Competência | 1º dia do mês do início do agendamento (São Paulo) |
| Desfazer "atendido" | Comissão `aberta` → `cancelada` (motivo automático); comissão `paga` → bloqueia a mudança de status ("A comissão deste atendimento já foi paga.") |
| Voltar a "atendido" | Reabre a mesma linha (uma comissão por agendamento), recalculada |
| Pagar comissões | Dona escolhe profissional + mês; marca as `abertas` como `pagas` e cria conta a pagar já paga (`salario`, "Comissão — <nome> — <mm/aaaa>", forma e data escolhidas) ligada a elas |
| Estoque | `produtos.estoque_atual` só muda por `movimentos_estoque` (trigger); pode ficar negativo |
| Baixa automática | Ao entrar em "atendido": um movimento `baixa_atendimento` por item de `servico_produtos`; ao sair: `estorno_atendimento` com a quantidade oposta |
| Entrada (compra) | Quantidade > 0 e custo unitário; atualiza `produtos_custos`; opcional "lançar despesa" cria conta a pagar `produto` em aberto (vencimento informado) |
| Ajuste | Nova quantidade contada (≥ 0) + motivo; grava a diferença |
| Cadastro de produto | "Estoque atual" deixa de ser editável; na criação, a quantidade inicial vira um movimento `ajuste` ("Estoque inicial") |
| Exclusão | Nada é apagado |

## 3. Banco — migração `0011_comissoes_estoque.sql`

### 3.1 Percentuais (só a dona lê e escreve)
- `colaboradores_comissao (colaborador_id pk → colaboradores, percentual numeric(5,2) not null check (between 0 and 100), atualizado_em)`. Sem linha = 0%.
- `servicos_comissao (servico_id pk → servicos, percentual numeric(5,2) not null check (between 0 and 100), atualizado_em)`. Sem linha = usa a da profissional.
- RLS no padrão de `produtos_custos`: select/insert/update só dona; delete só dona e só em `servicos_comissao` (limpar a % do serviço é configuração, não registro).

### 3.2 `comissoes`
`id`, `agendamento_id` **unique** not null, `profissional_id`, `servico_id`, `competencia date` (1º dia do mês), `base_centavos int ≥ 0`, `percentual numeric(5,2)`, `valor_centavos int ≥ 0`, `status` (`aberta` | `paga` | `cancelada`), `cancelada_em`, `cancelada_motivo`, `conta_pagar_id` (preenchida ao pagar), `pago_em date`, `criado_em`, `atualizado_em`. Checks: paga ⇔ conta_pagar_id e pago_em não nulos; cancelada ⇔ cancelada_em não nulo.

Função interna `base_comissao(p_agendamento) returns int`: pacote → `round(valor_total / total_sessoes)`; senão cobrança (bruto − desconto) se existir; senão `valor_previsto_centavos`.

### 3.3 `movimentos_estoque`
`id`, `produto_id`, `tipo` (`entrada` | `ajuste` | `baixa_atendimento` | `estorno_atendimento`), `quantidade numeric(12,3) ≠ 0` (com sinal: entrada > 0; baixa < 0; estorno > 0; ajuste ± ), `custo_unitario_centavos int` (entrada), `agendamento_id` (baixa/estorno), `motivo text ≤ 200` (ajuste obrigatório), `conta_pagar_id` (entrada com despesa), `responsavel_id` (null quando gerado pelo gatilho sem usuário), `criado_em`. Trigger `after insert` soma `quantidade` em `produtos.estoque_atual`.
- `produtos.estoque_atual`: gatilho `before update` em `produtos` recusa mudança de `estoque_atual` fora do gatilho de movimentos (marcador local de transação `set_config('app.movimento_estoque','1', true)`) — "O estoque só muda por entrada ou ajuste."; insert de produto com estoque ≠ 0 também é recusado (o estoque inicial entra como ajuste). Ajuste de migração: para cada produto com estoque ≠ 0, um movimento `ajuste` "Saldo anterior" **sem** reaplicar o trigger (inserção com o trigger de soma desativado na migração), para o histórico fechar com o saldo.

### 3.4 Gatilho em `agendamentos` (after insert/update of status)
Entrando em `atendido`: upsert da comissão (insert ou reabre a cancelada, recalculando) e baixas de estoque. Saindo de `atendido`: se comissão `paga` → `raise` (a mudança é desfeita); se `aberta` → `cancelada`, motivo "Atendimento desmarcado"; estornos de estoque dos itens baixados (soma por produto das baixas − estornos desse agendamento, para nunca estornar o que não baixou). Gatilho `security definer`, `search_path=''`.

Gatilho em `cobrancas` (after insert, origem `agendamento`): se houver comissão `aberta` desse agendamento, recalcula base e valor. Cobrança de pacote não muda comissões (a base do pacote vem do valor do pacote).

### 3.5 Funções (dona; `security definer`, `search_path=''`)
- `pagar_comissoes(p_profissional, p_competencia, p_pago_em, p_forma) returns uuid` — trava as comissões abertas do par; nenhuma → "Não há comissões em aberto."; total > 0 cria `contas_pagar` paga (`salario`); total 0 (todas a 0%) só marca pagas sem conta. Devolve o id da conta (ou null).
- `resumo_comissoes(p_de date, p_ate date)` — por profissional: qtd, base, valor aberto, valor pago (competência entre de e ate).
- `entrada_estoque(p_produto, p_quantidade, p_custo_unitario, p_lancar_despesa bool, p_vencimento date, p_fornecedor text) returns uuid`.
- `ajustar_estoque(p_produto, p_quantidade_contada, p_motivo) returns uuid` — diferença 0 → "O estoque já está com essa quantidade.".
- Estoque inicial: a action de criar produto insere o produto com estoque 0 e, se a quantidade inicial for > 0, chama `ajustar_estoque(produto, quantidade, 'Estoque inicial')`.

### 3.6 RLS
`colaboradores_comissao`, `servicos_comissao`: §3.1. `comissoes`, `movimentos_estoque`: select só dona; sem insert/update/delete para `authenticated` (só funções e gatilhos). Sem delete/truncate para ninguém.

## 4. Telas

### 4.1 Equipe
Campo "Comissão padrão (%)" no cadastro/edição (dona; grava em `colaboradores_comissao`).

### 4.2 Serviços
Campo "Comissão (%)" opcional ("vazio = usa a da profissional"; grava/remove em `servicos_comissao`).

### 4.3 Financeiro → aba **Comissões** (dona)
Filtro de período existente (competência). Resumo por profissional (cartões ou tabela: atendimentos, base, a pagar, pago) com botão **Pagar comissões** por profissional/mês (diálogo: mês, data, forma; mostra total). Lista detalhada: data do atendimento, cliente, serviço, profissional, base, %, valor, situação (🟡 aberta · 🟢 paga · ⚫ cancelada). Filtro de situação e profissional. Exportar PDF.

### 4.4 Produtos → aba **Estoque** (dona)
"Abaixo do mínimo" no topo; tabela de produtos com estoque, mínimo, custo; ações **Entrada** e **Ajuste** (diálogos). Histórico de movimentos (período, produto, tipo). Na página do produto: histórico dele. Recepção/profissional continuam vendo a lista de produtos como hoje (sem custo, sem abas novas).

### 4.5 Agenda
Ao desmarcar "atendido" com comissão paga, mostrar a mensagem do banco.

## 5. Código

- `src/lib/dominio/comissoes.ts` (puro): `percentualEfetivo`, `baseComissao`, `valorComissao`, `competenciaDe` — espelho do SQL para testes.
- `src/lib/dominio/estoque.ts` (puro): `diferencaAjuste`, `saldoDosMovimentos`, rótulos de tipo.
- `src/app/(app)/financeiro/`: dados e ações da aba Comissões; PDF da aba.
- `src/app/(app)/produtos/`: aba Estoque, ações de entrada/ajuste.
- `src/features/comissoes/*`, `src/features/estoque/*`.
- Permissões: abas `comissoes` (financeiro) e `estoque` (produtos) só dona.

## 6. Testes

- **Vitest:** % efetiva (serviço × profissional × vazio), base (avulso com/sem cobrança, pacote com divisão inexata), arredondamento, competência na virada do mês em SP; diferença de ajuste; saldo dos movimentos.
- **Banco:** atendido gera 1 comissão e baixas; desfazer cancela e estorna; refazer reabre sem duplicar; comissão paga bloqueia desfazer; cobrança depois recalcula; pagar_comissoes cria conta paga e entra no resumo_financeiro; entrada/ajuste atualizam estoque e custo; RLS por perfil (recepção/profissional não leem percentuais, comissões nem movimentos; ninguém altera `estoque_atual` direto); saldo inicial migrado bate.
- **Playwright (3 tamanhos, com backend):** marcar atendido e ver comissão e baixa; pagar comissões; entrada e ajuste de estoque; recepção não vê as abas.

## 7. Implantação

Aplicar `0011` em testes e depois na produção **antes** do merge. Atualizar `docs/implantacao.md` (Fase 4B). Nenhuma variável nova. Após publicar: a dona preenche a comissão padrão de cada profissional e, se quiser, a % por serviço; confere os produtos usados por serviço.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Comissão duplicada | unique `agendamento_id` |
| Estornar mais do que baixou | estorno = soma líquida das baixas do agendamento |
| Estoque divergir do histórico | escrita direta revogada; teste compara soma × saldo |
| Comissão paga e atendimento desfeito | bloqueado no gatilho com mensagem |
| % antiga x nova | % gravada na comissão no momento; recalcula só a base enquanto aberta |
