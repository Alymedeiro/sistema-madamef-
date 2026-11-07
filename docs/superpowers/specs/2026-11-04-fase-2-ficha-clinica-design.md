# Fase 2 — Ficha clínica, pacotes e pagamento dividido — Especificação

**Data:** 2026-11-04
**Status:** aguardando revisão da cliente
**Base:** especificação geral `docs/superpowers/specs/2026-11-02-sistema-madame-fe-design.md` (seções 3, 5.3, 5.4, 6.3, 6.8, 7) e Fase 1 já entregue (migrações 0001–0005).

---

## 1. Objetivo

Transformar o cadastro da cliente num **prontuário digital completo** e completar a parte de vendas do atendimento:

- anamnese configurável, preenchida e assinada no tablet;
- termos de consentimento por procedimento, assinados com o dedo e guardados em PDF;
- fotos de antes/depois/evolução com comparação;
- evoluções (anotações da profissional por atendimento);
- pacotes de sessões (venda, consumo, validade);
- **pagamento dividido**: um atendimento ou pacote pago com mais de uma forma (ex.: parte Pix, parte dinheiro);
- registro de acesso aos dados de saúde (LGPD).

**Critérios de aceite (resumo):** cliente assina termo no tablet e o PDF fica na ficha; fotos só visíveis para dona e profissionais vinculadas; sessão de pacote descontada ao marcar "atendido"; um atendimento pode ser pago com várias formas cuja soma fecha o total; todo acesso a anamnese, termos, fotos e evoluções fica registrado.

**Fora do escopo:** WhatsApp, Google Agenda, agendamento online (Fase 3); comissões, contas a pagar, estoque com baixa automática, relatórios (Fase 4); estorno/cancelamento de pagamento (Fase 4).

---

## 2. Decisões tomadas

| Tema | Decisão |
|---|---|
| Anamnese | Modelo padrão de estética editável pela dona; versões preservadas; cliente preenche e assina no tablet |
| Termos | Um modelo de termo por serviço (opcional); assinatura com o dedo; PDF gerado no servidor |
| Exigência do termo | **Aviso, não bloqueio**: ao abrir ou concluir um atendimento cujo serviço tem termo ainda não assinado (na versão atual), o sistema mostra "Termo pendente" com botão "Colher assinatura". A dona pode ver a lista de atendimentos concluídos sem termo |
| Anamnese pendente | Aviso no cartão da agenda e na ficha quando a cliente não tem anamnese ou a última tem mais de 12 meses |
| Fotos | Câmera do tablet/celular ou galeria; JPEG/PNG/HEIC convertido para JPEG no navegador, máx. 2560 px e 5 MB |
| Pacotes | Validade opcional; falta não consome sessão; dona pode estornar uma sessão revertendo o status |
| Pagamento dividido | Uma **cobrança** por atendimento ou pacote, com 1 a 4 partes (formas); soma das partes = valor − desconto |

---

## 3. Permissões (complementa a tabela da seção 3 da especificação geral)

| Recurso | Dona | Recepção | Profissional |
|---|---|---|---|
| Modelos de anamnese e de termo | Edita | Consulta | Consulta |
| Anamnese da cliente | Vê, aplica | Aplica e vê | Vê (clientes vinculadas) |
| Termos assinados | Vê, colhe | Colhe e vê | Vê e colhe (clientes vinculadas) |
| Fotos | Vê, adiciona, arquiva | ❌ | Vê e adiciona (clientes vinculadas) |
| Evoluções | Vê | Vê | Vê e adiciona (clientes vinculadas; edita só as próprias por 24h) |
| Pacotes | Vende, vê, cancela | Vende e vê | Vê (clientes vinculadas) |
| Cobrança (pagamento dividido) | ✅ | ✅ (caixa do dia) | ❌ |
| Registro de acessos | Vê | ❌ | ❌ |

Tudo aplicado com RLS e funções `security definer`, como na Fase 1. Nenhum dado clínico é apagado; correções criam nova versão ou são arquivadas.

---

## 4. Modelo de dados (migração `0006_ficha_clinica.sql` e `0007_pacotes_cobranca.sql`)

### 4.1 Ficha clínica
- **modelos_anamnese**: título, versão (inteiro, crescente), perguntas `jsonb` (lista de `{ id, tipo: texto|sim_nao|sim_nao_detalhe|multipla|data, texto, obrigatoria, opcoes? }`), ativo. Editar cria nova versão; só uma versão ativa.
- **anamneses**: cliente, modelo + versão, respostas `jsonb` (`{ [perguntaId]: valor }`), `assinatura_path` (storage), preenchida_por (colaborador), preenchida_em.
- **modelos_termo**: título, texto (markdown simples), versão, ativo. `servicos.modelo_termo_id` passa a ter FK.
- **termos_assinados**: cliente, modelo + versão, agendamento (opcional), `assinatura_path`, `pdf_path`, `hash_sha256` do PDF, assinado_em, colhido_por, dispositivo (user agent resumido).
- **fotos**: cliente, agendamento (opcional), servico (opcional), tipo (`antes` | `depois` | `evolucao`), `path`, tirada_em, enviada_por, arquivada (bool).
- **evolucoes**: cliente, agendamento, profissional, texto, criado_em; editável pela autora por 24h.
- **auditoria**: colaborador, ação (`visualizou` | `criou` | `alterou` | `arquivou`), entidade, entidade_id, cliente_id, ocorrido_em. Inserção só por função `security definer` `registrar_acesso(...)` e por gatilhos nas tabelas clínicas; leitura só dona.

### 4.2 Armazenamento
- Bucket privado `ficha-clinica`; caminhos `clientes/<cliente_id>/{anamneses|termos|fotos}/<uuid>.<ext>`.
- Políticas em `storage.objects` usando as mesmas regras de acesso (fotos: dona ou profissional vinculada; termos/anamneses: dona, recepção ou profissional vinculada).
- Arquivos abertos só por URL assinada de 5 minutos, gerada no servidor após checar permissão e registrar o acesso.

### 4.3 Pacotes
- **pacotes_vendidos**: cliente, serviço, total_sessoes (1–50), sessoes_usadas, valor_total_centavos, validade (data, opcional), status (`ativo` | `concluido` | `expirado` | `cancelado`), vendido_por, vendido_em.
- `agendamentos.pacote_vendido_id` ganha FK.
- Gatilho em `agendamentos`: ao passar para `atendido` com pacote → `sessoes_usadas + 1` (bloqueia se já esgotado ou expirado); ao sair de `atendido` (reversão da dona) → `- 1`. Ao atingir o total → `concluido`.
- Rotina diária (ou verificação na leitura) marca `expirado` quando passa da validade com sessões restantes.

### 4.4 Cobrança e pagamento dividido
- **cobrancas**: origem (`agendamento` | `pacote`), agendamento_id **único** (quando origem = agendamento), pacote_vendido_id **único** (quando origem = pacote), cliente, valor_bruto_centavos, desconto_centavos, caixa_id, lancada_por, lancada_em.
- **pagamentos** passa a ter `cobranca_id` (FK). Cada parte da cobrança é uma linha de `pagamentos` com sua forma, valor e parcelas. Pagamentos antigos da Fase 1 são migrados para uma cobrança cada.
- O índice único `pagamentos_agendamento_unico` (0005) é substituído pela unicidade em `cobrancas`.
- RPC **`registrar_cobranca(p_origem, p_agendamento, p_pacote, p_desconto_centavos, p_partes jsonb)`** — `p_partes` = lista de 1 a 4 `{ forma, valor_centavos, parcelas, vencimentos?, valores_parcelas? }`. Na mesma transação: exige caixa de hoje aberto; atendimento `atendido` (ou pacote recém-vendido); soma das partes = bruto − desconto; cada parte > 0; regras de parcelas da Fase 1 por forma; cria contas a receber das partes `a_receber`. Erros com mensagens claras em português.
- `registrar_pagamento` (Fase 1) continua existindo como atalho de uma parte só, chamando `registrar_cobranca`.
- Atendimento com pacote ativo **não** gera cobrança (já foi pago na venda do pacote).
- `fechar_caixa` e relatórios continuam somando `pagamentos` por forma — sem mudança de resultado.

---

## 5. Telas e fluxos

### 5.1 Ficha da cliente
Abas: **Dados · Anamnese · Termos · Fotos · Evoluções · Pacotes · Histórico** (abas aparecem conforme o perfil). Ao abrir Anamnese, Termos, Fotos ou Evoluções o sistema registra o acesso.

### 5.2 Anamnese
- Botão "Preencher anamnese" abre o formulário em **modo tablet** (tela cheia, letras grandes, sem menu); a recepção entrega o tablet à cliente.
- Ao final: resumo das respostas + campo de assinatura + "Confirmar". Volta à tela normal só após confirmação.
- Respostas "sim" em perguntas de alerta (alergias, gestante, uso de anticoagulante etc., marcadas no modelo) aparecem destacadas no topo da ficha e no cartão da agenda como "⚠ Atenção".
- Configurações → "Modelo de anamnese": a dona edita perguntas (adicionar, reordenar, marcar obrigatória/alerta). Salvar cria nova versão.

### 5.3 Termos de consentimento
- Configurações → "Termos": a dona cria e edita termos (texto); no cadastro do serviço escolhe o termo.
- Colher assinatura: modo tablet com o texto do termo, nome e CPF da cliente, data; campo de assinatura; "Li e concordo".
- Servidor gera o PDF (texto + dados + imagem da assinatura + data/hora + identificador), calcula o hash e guarda.
- Aviso "Termo pendente" no detalhe do atendimento e ao marcar "Atendido".

### 5.4 Fotos
- Botão "Adicionar fotos": câmera ou galeria, várias de uma vez; escolher tipo (antes/depois/evolução) e serviço/atendimento.
- Galeria por data e serviço; tocar abre em tela cheia; "Comparar" põe duas lado a lado.
- Arquivar (dona) esconde a foto sem apagar.

### 5.5 Evoluções
- No detalhe do atendimento (agenda) e na aba da ficha: campo de texto "Evolução / observações"; lista cronológica.

### 5.6 Pacotes
- Na ficha: "Vender pacote" → serviço, nº de sessões, valor total (sugestão = preço × sessões, editável), validade opcional → abre a **cobrança** (pagamento dividido).
- Lista de pacotes com barra de progresso (usadas/total), validade, status.
- Na agenda, ao criar agendamento de uma cliente com pacote ativo do mesmo serviço: opção "Usar sessão do pacote" (marcada por padrão).

### 5.7 Cobrança com pagamento dividido
- O diálogo de pagamento da Fase 1 ganha "+ Adicionar outra forma". Cada linha: forma, valor, parcelas (quando aplicável). Mostra "Falta R$ X" / "Sobra R$ X" e só habilita "Confirmar" quando fecha exatamente.
- O caixa do dia lista cada cobrança com suas partes.

---

## 6. Segurança e LGPD
- Dados clínicos nunca são apagados por usuários; arquivamento e versões.
- URL assinada de 5 min; nenhum caminho de arquivo público.
- Registro de acesso em toda leitura de dado clínico (server-side, antes de entregar os dados).
- Assinaturas e PDFs só são criados pelo servidor a partir da imagem enviada; o hash permite comprovar que o PDF não mudou.
- Exportação dos dados da cliente (spec geral §7) entra nesta fase: botão da dona "Exportar dados da cliente" gera um ZIP com JSON + PDFs + fotos.

---

## 7. Ajustes herdados da Fase 1 (entram na migração 0006)
- `normalizar_busca` com `set search_path = ''`.
- Índices para chaves estrangeiras sem índice (agendamentos.criado_por, agendamentos.servico_id, caixas.aberto_por, caixas.fechado_por, pagamentos.lancado_por).
- Consultas de "sem pagamento" passam a usar `cobrancas` (índice único utilizável).

---

## 8. Testes
- **Banco (Vitest + pg):** RLS de cada nova tabela e do storage por perfil; gatilho de consumo de pacote (atendido, falta, reversão, esgotado, expirado); `registrar_cobranca` (soma exata, 1–4 partes, a receber, duplicidade, caixa fechado, perfis); auditoria gravada; migração de pagamentos antigos para cobranças.
- **Domínio (Vitest):** divisão e validação das partes do pagamento; versões de anamnese; alertas; cálculo de progresso/validade do pacote.
- **Ações (fake Supabase):** permissões, URL assinada só após permissão + auditoria, geração do PDF (conteúdo e hash).
- **Telas (Playwright):** modo tablet da anamnese e do termo (assinatura desenhada no canvas), comparação de fotos, pagamento dividido — rodam contra o projeto `madame-fe-testes` com a trava `E2E_PERMITIR_PROJETO`.

---

## 9. Entrega
Uma fase, executada em tarefas com revisão por etapa, nesta ordem: (1) banco da ficha clínica + storage; (2) banco de pacotes e cobranças; (3) assinatura e modo tablet; (4) anamnese; (5) termos e PDF; (6) fotos; (7) evoluções; (8) pacotes na ficha e na agenda; (9) pagamento dividido; (10) auditoria e exportação; (11) testes de tela e implantação das migrações no Supabase.

## 10. Pendências da clínica
- Revisar o modelo padrão de anamnese (o sistema virá com ele pronto).
- Textos dos termos de consentimento de cada procedimento (o sistema virá com um modelo genérico para adaptar).
