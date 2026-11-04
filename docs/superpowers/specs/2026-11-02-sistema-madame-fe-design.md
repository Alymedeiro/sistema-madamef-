# Sistema Madame Fê Clinic — Especificação de Design

**Data:** 2026-11-02
**Status:** aguardando revisão da cliente
**Repositório:** https://github.com/Alymedeiro/sistema-madamef-

---

## 1. Objetivo

Sistema de gestão para **uma clínica de estética específica (Madame Fê Clinic)**, usado no dia a dia da operação. Reúne em um só lugar: agenda, cadastro de clientes com ficha clínica, cadastro de serviços e produtos, CRM com WhatsApp automático e financeiro.

**Critérios de sucesso**
- A clínica deixa de usar caderno/planilha para agenda e cadastro (fim da Fase 1).
- Toda a equipe acessa pelo navegador em **computador, tablet e celular**.
- Cada pessoa vê apenas o que seu perfil permite; **financeiro completo só para a dona**.
- Lembretes e confirmações por WhatsApp reduzem faltas (Fase 3).
- A dona enxerga faturamento, comissões, contas e lucro do mês (Fase 4).

**Fora do escopo (por enquanto):** emissão de nota fiscal, integração com maquininha / link de pagamento, sinal via Pix no agendamento online, integração com Instagram, multi-clínica (SaaS), sincronização Google Agenda → sistema.

---

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Público | Uma clínica, uso diário |
| Dispositivos | Web responsiva (computador, tablet, celular) + instalável como app (PWA) |
| Integrações iniciais | WhatsApp, Google Agenda, agendamento online |
| WhatsApp | API não oficial via **Z-API**, usando o número atual da clínica |
| Agendamento online | **Pedido com aprovação** da recepção; serviços "exige avaliação" não são agendáveis diretamente |
| Google Agenda | **Mão única**: sistema → agenda Google de cada profissional |
| Stack | Next.js + Supabase + Vercel |
| Pagamentos no balcão | Recepção lança pagamentos e abre/fecha caixa; não vê relatórios nem demais telas financeiras |

---

## 3. Perfis e permissões

A dona pode cadastrar, editar e desativar colaboradores a qualquer momento. Colaborador desativado perde o acesso imediatamente.

| Recurso | Dona | Recepção | Profissional |
|---|---|---|---|
| Agenda | Todas, edita | Todas, agenda/remarca/aprova pedidos online | Só a própria; altera status dos seus atendimentos |
| Clientes – dados básicos | Todas | Todas, cadastra/edita | Só clientes vinculadas* |
| Anamnese e termos | Todas | Aplica anamnese e colhe assinatura; visualiza | Clientes vinculadas, visualiza |
| Fotos antes/depois | Todas | ❌ | Clientes vinculadas, adiciona/visualiza |
| Observações/evolução | Todas | Visualiza | Clientes vinculadas, adiciona |
| Pacotes | Todos, vende | Vende/consulta | Consulta (clientes vinculadas) |
| Serviços e produtos | Edita | Consulta | Consulta |
| Pagamento do atendimento + caixa do dia | ✅ | ✅ lança e abre/fecha caixa | ❌ |
| Contas a pagar/receber, comissões, estoque (custos), relatórios | ✅ | ❌ | ❌ |
| CRM (leads, listas de reativação) | ✅ | ✅ | ❌ |
| Modelos de mensagens WhatsApp | ✅ edita | Consulta | ❌ |
| Equipe e configurações | ✅ | ❌ | ❌ |

\* **Cliente vinculada** = cliente que tem ao menos um agendamento (qualquer status) com aquela profissional.

As permissões são aplicadas **no banco de dados (Row Level Security do Supabase)**, não apenas na tela.

---

## 4. Arquitetura

```
 Computador / Tablet / Celular  (navegador ou PWA instalado)
                 │
        Next.js (App Router, TypeScript) ── Vercel
        ├─ Telas internas (login obrigatório)
        ├─ Página pública de agendamento online
        ├─ Rotas de API / webhooks (Z-API, Google OAuth)
        └─ Tarefas agendadas (Vercel Cron)
                 │
             Supabase
   ├─ PostgreSQL + Row Level Security (permissões por perfil)
   ├─ Auth (e-mail + senha por colaborador)
   ├─ Storage privado (fotos, assinaturas, PDFs de termos)
   └─ Backups diários
                 │
     ┌───────────┴────────────┐
   Z-API (WhatsApp)     Google Calendar API
```

**Tecnologias**
- Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- Supabase (Postgres, Auth, Storage, RLS); migrações versionadas no repositório
- Vercel Pro (hospedagem e cron)
- Testes: Vitest (regras de negócio), testes de RLS no banco, Playwright (telas em 3 tamanhos)
- Fuso horário fixo: `America/Sao_Paulo`; moeda: BRL; valores armazenados em centavos (inteiros)

**Princípio de isolamento:** cada integração externa fica atrás de um módulo próprio com interface simples (`enviarMensagem`, `criarEvento`…). Trocar Z-API pela API oficial no futuro altera só esse módulo.

**Ambientes:** `produção` e `testes` (projetos Supabase separados). Cada fase é validada em testes antes de ir para produção.

---

## 5. Modelo de dados

Todas as tabelas têm `id` (uuid), `criado_em`, `atualizado_em`. Exclusões de registros com histórico são lógicas (`ativo = false`).

### 5.1 Configuração e equipe
- **configuracoes_clinica**: nome, logo, endereço, telefone, horário de funcionamento por dia da semana, janela de envio WhatsApp (padrão 08h–20h), limite de mensagens/hora (padrão 60), dias para "cliente sumida" (padrão 90), antecedência mínima/máxima do agendamento online (padrão 2h / 60 dias).
- **colaboradores**: usuario_auth_id, nome, função (texto livre: esteticista, biomédica…), perfil (`dona` | `recepcao` | `profissional`), telefone, cor na agenda, comissão padrão %, ativo, google_calendar_conectado, google_refresh_token (criptografado).
- **jornadas**: colaborador, dia da semana, hora início, hora fim (vários intervalos por dia permitidos).
- **bloqueios_agenda**: colaborador, início, fim, motivo (folga, férias, curso).
- **colaborador_servicos**: quais serviços cada profissional realiza.

### 5.2 Serviços e produtos
- **categorias_servico**: nome.
- **servicos**: nome, categoria, descrição, duração (min), preço, comissão % (opcional, sobrepõe a do colaborador), `permite_online`, `exige_avaliacao`, `dias_retorno` (opcional), modelo de termo (opcional), ativo.
- **produtos**: nome, unidade (un, ml, ampola…), custo unitário, preço de venda (opcional), estoque atual, estoque mínimo, ativo.
- **servico_produtos**: serviço, produto, quantidade consumida por atendimento.

### 5.3 Clientes e ficha clínica
- **clientes**: nome, CPF (único, opcional), WhatsApp, e-mail, data de nascimento, endereço, origem (Instagram, indicação, Google, passou na frente, outro), `aceite_lgpd_em`, `aceita_whatsapp_marketing`, observações gerais, ativo.
- **modelos_anamnese**: título, versão, perguntas (JSON: tipo, texto, obrigatória, opções).
- **anamneses**: cliente, modelo + versão, respostas (JSON), preenchida_por, assinatura (arquivo), data.
- **modelos_termo**: título, texto, versão.
- **termos_assinados**: cliente, modelo + versão, agendamento (opcional), imagem da assinatura, PDF gerado, data/hora, dispositivo.
- **fotos**: cliente, agendamento (opcional), serviço, tipo (`antes` | `depois` | `evolucao`), caminho no storage, data, enviada_por.
- **evolucoes**: cliente, agendamento, profissional, texto.

### 5.4 Pacotes
- **pacotes_vendidos**: cliente, serviço, total de sessões, sessões usadas, valor total, validade (opcional), status (`ativo` | `concluido` | `expirado` | `cancelado`).

### 5.5 Agenda
- **agendamentos**: cliente, profissional, serviço, início, fim, status (`pendente` | `confirmado` | `atendido` | `faltou` | `cancelado`), origem (`interno` | `online`), pacote_vendido (opcional), valor previsto, observações, google_event_id, criado_por.
  - Restrição no banco: um profissional não pode ter dois agendamentos não cancelados sobrepostos (exclusion constraint em `tstzrange`).
- **pedidos_online**: dados informados pela cliente (nome, WhatsApp), serviço, profissional (ou "qualquer"), horário desejado, status (`aguardando` | `aprovado` | `recusado` | `expirado`), agendamento gerado.
  - Um pedido aguardando **reserva o horário** por até 24h; depois expira automaticamente.

### 5.6 Financeiro
- **caixas**: data, aberto_por, aberto_em, valor inicial (dinheiro), fechado_por, fechado_em, valor contado, diferença.
- **pagamentos**: caixa, cliente, origem (agendamento | pacote | venda de produto), forma (`pix` | `dinheiro` | `debito` | `credito` | `credito_parcelado` | `a_receber`), parcelas, valor, desconto, lançado_por.
- **contas_receber**: cliente, pagamento de origem, parcela n/N, valor, vencimento, recebido_em.
- **contas_pagar**: descrição, categoria (aluguel, fornecedor, produto, salário, imposto, outros), fornecedor, valor, vencimento, pago_em, recorrente (mensal).
- **comissoes**: profissional, agendamento, base de cálculo, %, valor, competência (mês), status (`aberta` | `paga`).
- **movimentos_estoque**: produto, tipo (`entrada` | `baixa_atendimento` | `venda` | `ajuste`), quantidade, agendamento (opcional), custo, responsável.

### 5.7 CRM e mensagens
- **leads**: nome, WhatsApp, interesse (serviço), origem, etapa (`novo` | `em_conversa` | `orcamento_enviado` | `agendou` | `perdido`), responsável, observações, cliente gerado.
- **modelos_mensagem**: tipo (confirmacao, lembrete, pos_atendimento, aniversario, retorno, reativacao, pedido_aprovado, pedido_recusado), variações de texto (lista, com variáveis `{nome}`, `{data}`, `{hora}`, `{servico}`, `{profissional}`), ativo.
- **fila_mensagens**: cliente/lead, telefone, tipo, texto final, agendado_para, status (`pendente` | `enviada` | `falhou` | `cancelada`), tentativas, erro, id externo Z-API, enviada_em.
- **mensagens_recebidas**: telefone, texto, recebida_em, agendamento relacionado, processada.

### 5.8 Auditoria
- **auditoria**: colaborador, ação (`visualizou` | `criou` | `alterou` | `excluiu`), entidade, id da entidade, data/hora. Obrigatória para anamnese, termos, fotos e evoluções.

---

## 6. Telas e fluxos

### 6.1 Navegação
Menu lateral (computador/tablet) ou inferior (celular), filtrado pelo perfil:
**Início · Agenda · Clientes · Serviços e Produtos · CRM · Financeiro · Equipe · Configurações**

**Início (painel do dia):** atendimentos de hoje, pedidos online aguardando, confirmações pendentes, aniversariantes, alertas (WhatsApp desconectado, estoque baixo, contas vencendo — estes dois só para a dona).

### 6.2 Agenda
- Visão **dia** (uma coluna por profissional) e **semana**; no celular, uma profissional por vez com troca por abas.
- Novo agendamento: tocar no horário → cliente (busca ou cadastro rápido) → serviço (preenche duração e valor) → salvar. Opção de usar sessão de pacote ativo.
- Validações: sobreposição, fora da jornada, bloqueio, profissional não realiza o serviço. Dona/recepção podem forçar encaixe fora da jornada com confirmação; sobreposição nunca é permitida.
- Arrastar para remarcar (computador/tablet).
- Cores de status: 🟡 pendente · 🔵 confirmado · 🟢 atendido · 🔴 faltou · ⚫ cancelado.

### 6.3 Fechamento do atendimento (status → "atendido")
Executado em uma única transação:
1. Se vinculado a pacote: incrementa sessões usadas; conclui o pacote ao chegar no total.
2. Gera comissão: `% do serviço` ou, se vazio, `% padrão da profissional`, sobre o valor efetivo do atendimento (valor − desconto; em pacote, valor total ÷ número de sessões).
3. Baixa de estoque dos produtos do serviço (estoque pode ficar negativo; gera alerta).
4. Agenda mensagem de pós-atendimento (dia seguinte, 10h) e, se o serviço tiver `dias_retorno`, mensagem de retorno.
5. Abre a tela de pagamento (recepção/dona) — exceto quando a sessão é de pacote já pago.

Falta ("faltou") **não** consome sessão de pacote. Cancelamento remove o evento do Google Agenda e cancela mensagens pendentes do agendamento.

### 6.4 Pagamento e caixa
- Pagamento exige caixa do dia aberto. Primeiro lançamento do dia oferece abrir o caixa.
- Formas: pix, dinheiro, débito, crédito, crédito parcelado (considerado recebido), "a receber" (gera parcelas em contas a receber com vencimentos).
- Fechamento: mostra total por forma de pagamento e pede o valor contado em dinheiro; registra diferença.
- Recepção vê apenas o caixa do dia em aberto; histórico de caixas e totais são da dona.

### 6.5 Agendamento online (página pública)
- Endereço próprio (ex.: `/agendar`), com logo e cores da clínica — pronto para link na bio do Instagram.
- Passos: serviço → profissional (ou "qualquer uma") → dia e horário livre → nome e WhatsApp → enviar.
- Lista apenas serviços com `permite_online`. Serviços com `exige_avaliacao` aparecem como **"Agendar avaliação de {serviço}"** e criam pedido de avaliação.
- Horários livres = jornada − agendamentos − bloqueios − pedidos aguardando, respeitando antecedência mínima/máxima.
- Proteção contra spam: captcha (Cloudflare Turnstile) e limite de pedidos por telefone/IP.
- O pedido aparece no painel e na agenda como 🟡. Recepção **aprova** (cria/vincula cliente e agendamento confirmado) ou **recusa/sugere outro horário**. A cliente recebe a resposta pelo WhatsApp.

### 6.6 WhatsApp (Z-API)
- **Envio:** todas as mensagens passam pela `fila_mensagens`. Um processador (cron a cada 5 min) envia as pendentes respeitando: janela de horário, limite por hora, intervalo aleatório de 20–60 s entre mensagens e variação aleatória entre os textos do modelo.
- **Mensagens de marketing** (aniversário, reativação, retorno) só para clientes com `aceita_whatsapp_marketing`.
- **Confirmação:** 24h antes do horário (ou imediatamente se marcado com menos de 24h). Resposta **1** → confirmado; **2** → alerta para a recepção remarcar; outra resposta → mostrada no painel.
- **Recebimento:** webhook da Z-API (`/api/webhooks/zapi`, protegido por token secreto) grava em `mensagens_recebidas` e associa ao próximo agendamento do telefone.
- **Falhas:** até 3 tentativas com espera crescente; depois marca `falhou` e aparece no painel. Se a instância Z-API estiver desconectada, a fila acumula e o painel mostra **"WhatsApp desconectado"**.
- **Envio manual:** a partir da ficha ou da agenda, botão para enviar mensagem avulsa pela fila.

### 6.7 Google Agenda
- Cada profissional conecta sua conta Google uma vez (OAuth) em "Meu perfil".
- Criar/alterar/cancelar agendamento → cria/atualiza/apaga evento na agenda dela. Título: `{primeiro nome da cliente} – {serviço}` (sem dados de saúde).
- Falha na API não bloqueia a agenda: o agendamento é salvo e a sincronização é tentada de novo depois.

### 6.8 Ficha da cliente
Abas: **Dados · Anamnese · Termos · Fotos · Pacotes · Histórico** (abas visíveis conforme perfil).
- **Anamnese:** formulário configurável pela dona; preenchida no tablet pela cliente ou pela recepção; assinatura com o dedo; versões antigas preservadas.
- **Termos:** a cliente lê o texto, assina com o dedo; o sistema gera PDF com texto, assinatura, data/hora e guarda no storage.
- **Fotos:** envio pela câmera do tablet/celular; galeria por serviço e data; comparação antes/depois lado a lado.
- **Histórico:** atendimentos, valores pagos, pacotes, evoluções da profissional e mensagens enviadas.

### 6.9 CRM
- **Aniversariantes:** lista do dia/semana; mensagem automática às 09h do dia (modelo editável, cupom opcional no texto).
- **Retorno:** lista de clientes cujo `último atendimento do serviço + dias_retorno` chegou; mensagem automática.
- **Clientes sumidas:** sem atendimento há mais de N dias (padrão 90); envio em lote pela fila, com confirmação da dona/recepção antes de disparar.
- **Funil de leads:** quadro kanban com as etapas da seção 5.7; converter lead em cliente com um clique.
- **Pós-atendimento:** automático (seção 6.3).

### 6.10 Financeiro (somente dona)
- **Contas a pagar:** cadastro, recorrência mensal, alerta de vencimento (3 dias antes) e de atraso.
- **Contas a receber:** parcelas por cliente, baixa de recebimento, lista de atrasadas.
- **Comissões:** relatório por profissional e mês; marcar como paga.
- **Estoque:** entradas (compra), ajustes, histórico, lista de produtos abaixo do mínimo.
- **Relatórios** (por período): faturamento por forma de pagamento, por serviço, por profissional; ticket médio; serviços mais vendidos; entradas − saídas (resultado); taxa de faltas; novas clientes por origem.

---

## 7. Segurança e LGPD

- Login por colaborador (e-mail + senha, recuperação por e-mail). Sessão expira por inatividade (padrão 12h).
- RLS em todas as tabelas; testes automáticos garantem que cada perfil só acessa o permitido.
- Storage privado; arquivos abertos apenas por **URL assinada de curta duração** (5 min).
- Auditoria de acesso a dados de saúde (seção 5.8).
- Aceite da LGPD registrado no cadastro (data/hora); opção de exportar os dados da cliente e de anonimizá-la a pedido.
- Segredos (token Z-API, chaves Google, chave de serviço Supabase) só em variáveis de ambiente do servidor; nunca no navegador.
- Backups diários do Supabase (plano Pro).

---

## 8. Identidade visual

Baseada no logo oficial (`public/brand/logo-madame-fe.png`). O logo é usado como imagem — não recriado em fonte.

| Token | Cor | Uso |
|---|---|---|
| `blush` | `#FEEDF3` | fundo principal |
| `blush-forte` | `#F8D7E3` | cartões selecionados, destaques suaves |
| `ouro` | `#986818` | botões principais, títulos, ícones ativos |
| `ouro-escuro` | `#805008` | textos em dourado sobre fundo claro, hover |
| `ouro-claro` | `#E8C979` | bordas, divisores, brilho do dourado (gradiente com `ouro`) |
| `texto` | `#3D2B1F` | texto principal (marrom quente, alto contraste) |
| `branco` | `#FFFFFF` | superfície de cartões e formulários |

- **Títulos:** serifada clássica em caixa alta, alinhada ao logo (Cinzel).
- **Detalhes decorativos:** script elegante (Great Vibes) apenas em elementos pontuais, como a saudação da página de agendamento.
- **Texto e formulários:** sans-serif legível (Montserrat).
- Tablet: botões e áreas de toque ≥ 44 px; agenda e assinatura otimizadas para toque.
- Contraste mínimo AA (texto dourado só em `ouro-escuro` sobre `blush`/branco).
- Modo escuro: fora do escopo inicial.

---

## 9. Fases de entrega e critérios de aceite

### Fase 1 — Base
Login e perfis; Equipe (cadastro, jornadas, bloqueios, serviços que realiza); Clientes (dados básicos, aceite LGPD, histórico); Serviços, categorias e produtos (cadastro); Agenda completa (6.2) com fechamento simples (status + pagamento); Caixa do dia (6.4); Painel do dia; PWA; identidade visual.
**Aceite:** recepção agenda, remarca e cancela sem conflitos; profissional vê só a própria agenda e clientes vinculadas; recepção lança pagamento e fecha caixa; tudo funciona em computador, tablet e celular.

### Fase 2 — Ficha clínica
Anamnese configurável, termos com assinatura e PDF, fotos antes/depois, evoluções, pacotes de sessões (venda, consumo, validade), auditoria.
**Aceite:** cliente assina termo no tablet e o PDF fica na ficha; fotos só visíveis para dona e profissionais vinculadas; sessão de pacote é descontada ao marcar "atendido".

### Fase 3 — Integrações
Z-API (fila, confirmação 1/2, lembrete, pós-atendimento, aniversário), modelos de mensagem editáveis, Google Agenda, página de agendamento online com aprovação.
**Aceite:** confirmação chega 24h antes e a resposta "1" muda o status; pedido online aparece no painel e, aprovado, notifica a cliente; agendamento aparece na agenda Google da profissional.

### Fase 4 — Financeiro completo
Contas a pagar e a receber, comissões automáticas, estoque com baixa automática, relatórios.
**Aceite:** comissão e baixa de estoque gerados ao marcar "atendido"; relatório mensal bate com os lançamentos; recepção e profissionais não acessam nenhuma dessas telas nem dados.

### Fase 5 — CRM avançado
Retorno por serviço, clientes sumidas com envio em lote, funil de leads, indicadores no painel da dona.
**Aceite:** listas corretas conforme regras da seção 6.9; mensagens de marketing respeitam opt-in, janela de horário e limite por hora.

---

## 10. Testes

- **Regras de negócio (Vitest):** sobreposição de horários, cálculo de horários livres, comissão, consumo de pacote, baixa de estoque, montagem de mensagens com variáveis, regras da fila (janela, limite, espaçamento).
- **Permissões (banco):** para cada perfil, testes que tentam ler/escrever dados proibidos e devem falhar.
- **Integrações:** módulos Z-API e Google testados com respostas simuladas; webhook testado com payloads de exemplo.
- **Telas (Playwright):** fluxos principais em 1440 px (computador), 1024 px (tablet) e 390 px (celular).
- Cada fase só vai para produção após passar em todos os testes no ambiente de testes e validação da dona.

---

## 11. Custos mensais estimados

| Item | Estimativa |
|---|---|
| Supabase Pro | ~US$ 25 |
| Vercel Pro | ~US$ 20 |
| Z-API | ~R$ 100 |
| Domínio (anual, rateado) | ~R$ 5 |
| **Total** | **~R$ 250–400/mês** (varia com o dólar) |

---

## 12. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Bloqueio do número pelo WhatsApp (API não oficial) | Fila com espaçamento, limite por hora, variação de textos, opt-in de marketing; módulo isolado para migrar à API oficial se necessário |
| Z-API fora do ar / celular desconectado | Fila persistente com novas tentativas; alerta no painel |
| Dados de saúde (LGPD) | RLS, storage privado, URLs temporárias, auditoria, backups |
| Escopo grande | Entrega em 5 fases, cada uma utilizável sozinha |

---

## 13. Pendências antes de cada fase (dados da clínica)

- **Fase 1:** lista de colaboradores (nome, função, perfil, horários), lista de serviços (duração, preço, comissão), horário de funcionamento, domínio desejado.
- **Fase 2:** perguntas da anamnese e textos dos termos de consentimento.
- **Fase 3:** conta Z-API criada pela clínica; contas Google das profissionais; textos desejados das mensagens (o sistema virá com sugestões).
- **Fase 4:** categorias de despesas e contas fixas mensais.
