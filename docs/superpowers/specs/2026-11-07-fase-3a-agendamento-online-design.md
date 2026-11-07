# Fase 3A — Agendamento online com aprovação

Data: 2026-11-07 · Base: spec geral `2026-11-02-sistema-madame-fe-design.md` §5.5 e §6.5 · Sequência da Fase 3: **3A agendamento online** → 3B WhatsApp (Z-API) → 3C Google Agenda.

## 1. Objetivo e critério de aceite

A cliente pede um horário pela página pública `/agendar` (link da bio do Instagram); a recepção aprova ou recusa; a cliente é avisada pelo WhatsApp (nesta fase, por um botão que abre o WhatsApp com a mensagem pronta; na 3B passa a ser automático).

**Aceite:**
- Pedido feito em `/agendar` aparece no Início e na agenda (🟡) em segundos.
- Aprovar cria agendamento **confirmado** (origem `online`) vinculado a uma cliente existente ou recém-cadastrada; recusar ou expirar libera o horário.
- Dois pedidos simultâneos para o mesmo horário/profissional: só um é aceito.
- A página pública não expõe nenhum dado de agenda além de horários livres.
- Funciona em celular (390 px), tablet (1024 px) e computador (1440 px).

**Fora do escopo da 3A:** envio automático de WhatsApp (3B), Google Agenda (3C), sinal via Pix, escolha de vários serviços num pedido.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Onde fica o pedido | Tabela própria `pedidos_online`; **não** cria cliente nem agendamento antes da aprovação |
| Aviso à cliente | Botão "Avisar no WhatsApp" (`https://wa.me/55…?text=…`) após aprovar/recusar |
| Anti-spam | Cloudflare Turnstile + máx. 3 pedidos aguardando por telefone + máx. 5 pedidos/hora por aparelho (hash do IP) |
| Reserva | Pedido aguardando segura o horário por 24h; expiração calculada na leitura |
| Retenção (LGPD) | Pedidos não aprovados: nome e telefone apagados após 90 dias (tarefa diária `pg_cron`) |
| Acesso público | Nenhum acesso direto do papel `anon`; tudo passa pelo servidor Next.js |

## 3. Página pública `/agendar`

Rota pública (fora do login), identidade visual da clínica, layout pensado primeiro para celular.

1. **Serviço** — só serviços ativos com `permite_online`. Serviços com `exige_avaliacao` aparecem como **"Agendar avaliação de {serviço}"**; o pedido é marcado `avaliacao = true` e usa a duração do próprio serviço.
2. **Profissional** — profissionais ativas que realizam o serviço (`colaborador_servicos`) + **"Qualquer uma"**.
3. **Dia e horário** — calendário de hoje até a antecedência máxima (padrão 60 dias); no dia escolhido, horários de 15 em 15 min.
   - Livre = dentro de uma jornada da profissional **e** sem agendamento não cancelado, bloqueio ou pedido aguardando sobreposto **e** início ≥ agora + antecedência mínima (padrão 2h) **e** fim dentro da jornada.
   - "Qualquer uma": o horário aparece se ao menos uma profissional estiver livre; ao criar o pedido, o banco escolhe a primeira livre (ordem por nome) e grava em `profissional_id`; `profissional_escolhida_id` fica nulo.
   - Tudo em horário de São Paulo.
4. **Dados** — nome (2–80 caracteres) e WhatsApp (validado com `src/lib/dominio/telefone.ts`), caixa obrigatória "Li e aceito o aviso de privacidade" (texto configurável; link abre o aviso).
5. **Enviar** — tela "Pedido recebido! A Madame Fê Clinic vai te responder pelo WhatsApp em breve." com resumo (serviço, profissional, data/hora).

**Erros mostrados:** "Esse horário acabou de ser reservado, escolha outro." · "Você já tem 3 pedidos aguardando resposta. Aguarde o retorno da clínica." · "Muitas tentativas. Tente novamente mais tarde." · "Não foi possível confirmar que você não é um robô."

**Desligada:** com `online_ativo = false`, a página mostra "Agendamento online indisponível no momento. Fale com a clínica: {telefone}".

## 4. Lado da recepção

- **Início:** card "Pedidos online aguardando (N)" — mais antigo primeiro, com tempo restante até expirar; link para a tela de pedidos.
- **Agenda:** bloco 🟡 "Pedido online — {primeiro nome}" no horário, na coluna de `profissional_id`. Tocar abre o pedido.
- **Profissional:** vê o bloco na própria agenda (sem telefone, sem ações).
- **Tela "Pedidos online"** (`/agenda/pedidos`): filtros aguardando / aprovados / recusados / expirados; dona e recepção.

**Aprovar** (dona/recepção):
1. Sugestão de cliente pelo telefone normalizado: "É a {nome} (cadastrada)?" — ou cadastro rápido pré-preenchido (nome, WhatsApp; aceite LGPD marcado com a data do pedido, já que a cliente aceitou o aviso na página).
2. Pode trocar profissional e ajustar horário; aplicam-se as regras da agenda (sobreposição nunca; fora da jornada exige confirmação de encaixe, como hoje).
3. Confirmar cria o agendamento `confirmado`, `origem = 'online'`, e marca o pedido `aprovado` com o id do agendamento — na mesma transação.
4. Botão **"Avisar no WhatsApp"** com: "Oi, {primeiro nome}! Seu horário de {serviço} com {profissional} está confirmado para {dd/mm} às {hh:mm}. Madame Fê Clinic".

**Recusar** (dona/recepção): motivo opcional (até 200 caracteres); pedido `recusado`; horário liberado. "Avisar no WhatsApp": "Oi, {primeiro nome}! Infelizmente o horário pedido para {serviço} não está disponível. Você pode escolher outro em {site}/agendar ou responder esta mensagem."

**Expirar:** pedido `aguardando` com `criado_em` há mais de 24h é tratado como expirado em toda leitura e em toda checagem de horário livre; uma função `expirar_pedidos_online()` grava o status (chamada ao listar e pela tarefa diária).

## 5. Banco — migração `0009_agendamento_online.sql`

### 5.1 Configurações
`configuracoes_clinica` ganha `online_ativo boolean default false` e `online_aviso_privacidade text` (texto padrão incluído). Antecedência mínima/máxima já existem.

### 5.2 Tabela `pedidos_online`
`id`, `servico_id`, `profissional_escolhida_id` (null = qualquer), `profissional_id` (atribuída, not null), `inicio`, `fim`, `avaliacao bool`, `nome`, `whatsapp` (normalizado, só dígitos com DDI), `status` (`aguardando` | `aprovado` | `recusado` | `expirado`), `motivo_recusa`, `agendamento_id`, `decidido_por`, `decidido_em`, `aceite_privacidade_em`, `ip_hash`, `criado_em`, `atualizado_em`, `dados_apagados_em`.
- Exclusion constraint: um `profissional_id` não tem dois pedidos `aguardando` sobrepostos (`tstzrange`).
- RLS: `anon` sem acesso; dona e recepção leem tudo; profissional lê só os próprios via função que omite `whatsapp`. Escrita só por funções `security definer`.

### 5.3 Funções
- `horarios_livres_online(p_servico, p_profissional, p_dia) → setof timestamptz` — só para o servidor (`service_role`); respeita `online_ativo`, `permite_online`, jornada, bloqueios, agendamentos, pedidos aguardando não vencidos e antecedência. A regra de cálculo também existe em TypeScript (`src/lib/dominio/online.ts`) para testes e para a tela; o banco é a fonte de verdade na criação.
- `criar_pedido_online(p_servico, p_profissional, p_inicio, p_nome, p_whatsapp, p_ip_hash) → uuid` — `service_role`; trava (`pg_advisory_xact_lock` por profissional) e confere tudo; limite de 3 aguardando por telefone e 5/hora por `ip_hash`; "qualquer uma" escolhe a primeira profissional livre.
- `aprovar_pedido_online(p_pedido, p_cliente, p_profissional, p_inicio, p_encaixe) → uuid` (agendamento) e `recusar_pedido_online(p_pedido, p_motivo)` — dona/recepção; recusam pedido que não está `aguardando` ("Este pedido já foi respondido.").
- `expirar_pedidos_online()` e `apagar_dados_pedidos_antigos()` (90 dias, não aprovados).
- Gatilho em `agendamentos` (insert/update de horário ou profissional, status ≠ cancelado): recusa sobreposição com pedido aguardando não vencido de outra origem — "Há um pedido online neste horário. Aprove ou recuse o pedido primeiro." A aprovação do próprio pedido passa (o pedido muda de status na mesma transação, antes do insert).
- `pg_cron`: diária às 03:00 (São Paulo) chamando expirar + apagar.

## 6. Servidor (Next.js)

- `src/app/agendar/` (público): páginas e server actions `buscarHorarios` e `enviarPedido`, usando o cliente admin **somente** nessas duas ações, depois de validar entrada (zod), Turnstile e limite.
- Turnstile: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (pública) e `TURNSTILE_SECRET_KEY` (servidor). Sem chave secreta configurada, a verificação é pulada e só os limites protegem (registrado no log do servidor).
- `ip_hash` = SHA-256 de `IP + segredo do servidor`; o IP não é gravado.
- `src/lib/auth/rotas.ts`: `/agendar` entra nas rotas públicas.
- `src/lib/dominio/online.ts`: cálculo de horários livres, montagem das mensagens e do link `wa.me` (puro, testável).
- Tela de pedidos, card no Início e bloco na agenda reutilizam os padrões existentes (`exigirPerfil`, `mensagemErroBanco`).

## 7. Configurações (dona)

Seção "Agendamento online" em `/configuracoes`: interruptor ativo, antecedência mínima (h) e máxima (dias), texto do aviso de privacidade, e o link público para copiar. Em Serviços, o campo "permite online" já existe.

## 8. Testes

- **Vitest (regras):** horários livres (jornada com intervalos, bloqueio, agendamento, pedido aguardando, pedido vencido não bloqueia, antecedência mín./máx., "qualquer uma", virada de dia em São Paulo, serviço que não cabe no fim da jornada); mensagens e link `wa.me`; validação de nome/telefone.
- **Banco:** corrida de dois `criar_pedido_online` no mesmo horário (um falha); limite por telefone e por `ip_hash`; expiração; aprovar/recusar por perfil (profissional e anon falham); aprovação cria agendamento e muda status atomicamente; gatilho de agendamento interno x pedido; `anon` não lê `pedidos_online`; limpeza de 90 dias.
- **Playwright (3 tamanhos):** cliente faz pedido; recepção aprova e o agendamento aparece; recusa libera o horário; página desligada mostra o telefone. Turnstile em modo de teste (chaves de teste oficiais da Cloudflare).

## 9. Implantação

1. Aplicar `0009` no projeto de testes e depois na produção **antes** do merge (o merge publica na Vercel).
2. Ativar a extensão `pg_cron` (já disponível no Supabase gratuito; a migração cria o agendamento).
3. Clínica: criar conta gratuita na Cloudflare → Turnstile → widget para o domínio do site; chave pública vai para `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, secreta direto na Vercel como `TURNSTILE_SECRET_KEY`.
4. Marcar em Serviços quais permitem online; ligar "Agendamento online ativo" em Configurações.
5. Atualizar `docs/implantacao.md` com a seção Fase 3A.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Spam de pedidos | Turnstile + limites por telefone e aparelho + interruptor para desligar |
| Pedido segura horário e ninguém responde | Expira em 24h; card com tempo restante no Início |
| Telefone digitado errado | Recepção vê o número antes de avisar; mensagem é enviada manualmente na 3A |
| Dados de quem não virou cliente | Apagados em 90 dias; aviso de privacidade aceito no pedido |
