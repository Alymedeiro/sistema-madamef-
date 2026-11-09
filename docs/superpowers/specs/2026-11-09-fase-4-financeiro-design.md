# Fase 4 — Financeiro (painel, contas a pagar e a receber, fluxo de caixa, PDF e avisos)

Data: 2026-11-09 · Base: spec geral `2026-11-02-sistema-madame-fe-design.md` §5.6, §6.4 e §9 (Fase 4). Referência visual enviada pelo usuário (tela "Financeiro" com cartões, filtro de período e abas). Comissões e estoque da Fase 4 original ficam **fora** desta entrega.

## 1. Objetivo e aceite

Centralizar todo o financeiro da clínica numa seção **Financeiro** (antiga "Caixa"): painel com indicadores, contas a pagar, contas a receber, fluxo de caixa, caixa do dia, relatório em PDF e avisos de vencimento dentro do sistema.

**Aceite:**
- Dona vê os 7 cartões, as 4 abas e o caixa do dia; os números do painel batem com as listas e com o fechamento do caixa para qualquer período.
- Recepção vê só a aba **Caixa do dia** (inclui "parcelas a receber hoje"); profissional não vê nada. Garantido no banco (RLS), não só na tela.
- Conta fixa mensal gera a conta de cada mês uma única vez.
- Receber uma parcela entra no caixa do dia aberto e não pode ser recebida duas vezes.
- O sininho avisa nos marcos 7, 3, 1 dia antes, no dia e "vencida há N dias".
- PDF de cada aba sai com logo, período, filtros, tabela e totais.
- Funciona em 390 / 1024 / 1440 px.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Nome e rota | Menu **Financeiro**, rota `/financeiro`; `/caixa` redireciona para `/financeiro?aba=caixa` |
| Acesso | Dona: tudo. Recepção: só aba Caixa do dia + receber parcelas. Profissional: nada |
| Contas a pagar | Avulsas + **contas fixas mensais** (modelo gera a conta de cada mês) |
| Vale | Botão "Lançar vale": despesa já paga, categoria `vale`, ligada à colaboradora |
| Despesa com foto/PDF | Anexo opcional (JPEG/PNG/PDF ≤ 5 MB) guardado em bucket privado `financeiro`; sem leitura automática |
| Receber parcela | Escolhe a forma; entra no caixa do dia aberto (tabela `recebimentos`); `fechar_caixa` passa a somar recebimentos |
| A receber manual | Permitido (cliente, descrição, valor, vencimento), além das parcelas de pagamento "a receber" |
| Avisos | Calculados na leitura a partir das contas abertas; marcos 7/3/1/0 e vencida diária; só "lidos" é gravado |
| PDF | Gerado no servidor com `pdf-lib` (já no projeto), fonte e logo da clínica |
| Cores | Layout da referência com a paleta da clínica (rosé/dourado); cartão "Saldo em caixa" em dourado |
| Exclusão | Nada é apagado: cancelar com motivo |

## 3. Telas

### 3.1 Cabeçalho (dona)
Título **Financeiro**, subtítulo "Atendimentos, pacotes e despesas da clínica". Botões: **Lançar vale** · **Despesa com foto/PDF** · **Novo lançamento** (pergunta: conta a pagar ou a receber) · **Exportar PDF** (da aba e período atuais).

### 3.2 Filtro de período (todas as abas da dona)
Chips: **Este mês** (padrão) · **Mês passado** · **Próximo mês** · **Este ano** · **Tudo** · **Personalizado** (de/até). Estado na URL (`?periodo=mes|mes_passado|proximo_mes|ano|tudo|personalizado&de=&ate=&aba=`). Dias em São Paulo, intervalos fechados [de, ate].

### 3.3 Cartões (período P)
Grandes: **Recebido** (R$ + "N recebimento(s) confirmados") · **Pago** (R$ + "N pagamento(s) confirmados") · **Saldo em caixa** (Recebido − Pago; "No azul/No vermelho").
Menores: **A receber** (em aberto vencendo em P; "já recebido: R$ X") · **A pagar** (em aberto vencendo em P; "já pago: R$ X") · **Saldo projetado** (Saldo em caixa + A receber − A pagar) · **Vencidos** (quantidade e total em aberto com vencimento < hoje, independente de P; fundo vermelho claro).
Valores sempre com centavos.

### 3.4 Abas
1. **Contas a receber** — colunas: cliente, descrição/origem (atendimento, pacote, manual), parcela n/N, vencimento, valor, situação (🟢 recebida · 🟡 em aberto · 🔴 vencida · ⚫ cancelada), recebida em. Ações: **Receber** (forma de pagamento → caixa do dia; exige caixa aberto), **Nova conta a receber** (manual), **Cancelar** (motivo; só manuais ou parcelas ainda em aberto).
2. **Contas a pagar** — colunas: descrição, categoria (`aluguel`, `fornecedor`, `produto`, `salario`, `imposto`, `vale`, `outros`), fornecedor/colaboradora, vencimento, valor, situação, paga em, 📎 anexo. Ações: **Nova conta** (com "repete todo mês no dia X"), **Marcar como paga** (data, forma), **Editar** (só em aberto), **Cancelar** (motivo), abrir anexo (URL assinada 300 s).
3. **Fluxo de caixa** — por dia (ou por mês quando P > 62 dias): entradas (pagamentos do caixa líquidos de desconto + recebimentos de parcelas), saídas (contas pagas), saldo do dia e acumulado; totais por forma de pagamento e por categoria de despesa; gráfico simples de barras entradas × saídas.
4. **Caixa do dia** — tela atual (abrir, lançar, fechar) + bloco "Parcelas a receber hoje e vencidas" com botão **Receber**.

Cada lista: filtro de situação (Todas · Em aberto · Vencidas · Pagas/Recebidas · Canceladas; padrão "Em aberto"), busca por nome/descrição, filtro de categoria (a pagar). Lista do painel "Próximos vencimentos (7 dias)".

### 3.5 Sininho (dona)
No topo do app, em todas as telas: contador de não lidos; lista com "Aluguel — R$ 3.500,00 — vence em 3 dias" / "Maria Silva — parcela 2/3 — R$ 150,00 — vencida há 2 dias"; toque abre a conta; "Marcar todos como lidos". Cartão "Contas vencendo" no Início (dona).
Marcos: d = vencimento − hoje (SP). Aviso quando d ∈ {7, 3, 1, 0}; e para d < 0, um aviso por dia ("vencida há |d| dias"). Chave do aviso = (tipo, conta, marco ou data). Lido não volta; novo marco gera novo aviso. Conta paga/recebida/cancelada some.

### 3.6 Recepção
Menu **Financeiro** abre direto em Caixa do dia; nenhuma outra aba, cartão, filtro de período ou PDF.

## 4. Banco — migração `0010_financeiro.sql`

- `create type categoria_despesa as enum ('aluguel','fornecedor','produto','salario','imposto','vale','outros')`; `status_conta as enum ('aberta','paga','cancelada')`.
- **`contas_fixas`**: descrição, categoria, fornecedor, valor_centavos > 0, dia_vencimento 1–31, ativa, início (mês), criado_por.
- **`contas_pagar`**: descrição, categoria, fornecedor (texto), colaborador_id (vales), valor_centavos > 0, vencimento date, status, pago_em date, forma (forma_pagamento sem `a_receber`), anexo_path, conta_fixa_id + competencia (date, 1º dia do mês) com **unique (conta_fixa_id, competencia)**, cancelada_motivo, cancelada_em/por, lancada_por.
- **`contas_receber`** (existente) ganha: `descricao`, `origem_manual bool`, `pagamento_id` passa a nullable (manual), `cancelada_em/por/motivo`; check: manual ⇔ pagamento_id null.
- **`recebimentos`**: conta_receber_id **unique** (uma baixa por parcela), caixa_id, forma, valor_centavos, recebido_por, recebido_em. `recebido_em` da parcela é preenchido junto.
- **`avisos_lidos`**: colaborador_id, chave text, lido_em; unique (colaborador_id, chave).
- Bucket privado **`financeiro`** (5 MB, JPEG/PNG/PDF), caminho `contas_pagar/<uuid>.<ext>`; leitura e envio só dona.
- **Funções** (`security definer`, `search_path=''`):
  - `gerar_contas_fixas(p_ate date)` — cria as contas das competências até p_ate (dona), dia 31 → último dia do mês; idempotente pelo unique.
  - `receber_parcela(p_conta uuid, p_forma forma_pagamento)` — dona/recepção; exige caixa de hoje aberto (trava `for share`), conta aberta não cancelada; insere `recebimentos`; 23505 → "Esta parcela já foi recebida.".
  - `pagar_conta(p_conta uuid, p_pago_em date, p_forma)`, `cancelar_conta_pagar(p_conta, p_motivo)`, `cancelar_conta_receber(p_conta, p_motivo)`, `lancar_vale(p_colaborador, p_valor, p_data, p_forma, p_obs)` — dona.
  - `resumo_financeiro(p_de date, p_ate date)` — dona; devolve os 7 cartões.
  - `fluxo_caixa(p_de date, p_ate date, p_agrupar text)` — dona.
  - `fechar_caixa` (0003) atualizado para somar também `recebimentos` do caixa por forma.
- **RLS**: `contas_fixas`, `contas_pagar`, `avisos_lidos` só dona; `contas_receber` dona tudo, recepção só em aberto com vencimento ≤ hoje (para receber) e as recebidas no caixa de hoje; `recebimentos` dona tudo, recepção só do caixa de hoje. Escrita só por funções. Sem delete.

## 5. Servidor e código

- `src/lib/dominio/financeiro.ts` (puro): `periodoDoFiltro`, `situacaoConta`, `marcosAviso`, `avisosPendentes`, `resumo` (espelho do SQL para testes), `vencimentoDaCompetencia`.
- `src/app/(app)/financeiro/` — página com abas (Server Components), ações (zod + `exigirPerfil`), rota `exportar/route.ts` (PDF, dona, `maxDuration 60`).
- `src/features/financeiro/*` — cartões, filtro, listas, diálogos (nova conta, vale, despesa com anexo, pagar, receber, cancelar), gráfico (SVG simples, sem lib nova).
- `src/features/avisos/*` — sininho no layout do app (dona).
- Permissões: recurso `caixa` vira `financeiro` (rótulo "Financeiro", ícone Wallet); `/caixa` redireciona.
- Anexo: enviado do navegador direto ao Storage com o JWT da dona (mesmo padrão das fotos), depois registrado.

## 6. Testes

- **Vitest:** `periodoDoFiltro` (mês passado/próximo na virada de ano, personalizado inválido); `situacaoConta` (vencida hoje às 00:01 SP); `marcosAviso` (7/3/1/0, −1, −10; conta paga some); `vencimentoDaCompetencia` (31 em fevereiro, bissexto); `resumo` com cancelada ignorada e desconto.
- **Banco:** RLS por perfil (recepção não lê contas_pagar nem resumo; profissional nada); `receber_parcela` duas vezes → mensagem; sem caixa aberto → erro; `fechar_caixa` soma recebimentos; `gerar_contas_fixas` idempotente; `resumo_financeiro` bate com somas manuais nos limites do período.
- **PDF:** conteúdo (título, período, totais) e paginação com 300 linhas.
- **Playwright (3 tamanhos):** criar conta fixa e ver a do mês; marcar paga; receber parcela no caixa do dia (recepção); filtro de período altera cartões; exportar PDF; sininho mostra e marca como lido.

## 7. Implantação

Aplicar `0010` em testes e depois produção **antes** do merge. Atualizar `docs/implantacao.md` (Fase 4). Nenhuma variável nova.

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Números do painel divergirem do caixa | Uma única função SQL de resumo; testes que comparam com o fechamento |
| Parcela recebida duas vezes | unique em `recebimentos.conta_receber_id` |
| Conta fixa duplicada | unique (conta_fixa_id, competencia) |
| Recepção ver dado financeiro | RLS + telas; testes por perfil |
| PDF grande demorar | paginação; `maxDuration 60`; período "Tudo" agrupa por mês |
