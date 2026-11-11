# Fase 3B — WhatsApp automático (Z-API)

Data: 2026-11-11 · Base: spec geral `2026-11-02-sistema-madame-fe-design.md` §5.7, §6.3 (passo 4), §6.6 e §9 (Fase 3); Fase 3A `2026-11-07-fase-3a-agendamento-online-design.md`. Desenho aprovado pelo usuário em 2026-11-11 (ritmo acelerado).

## 1. Objetivo e aceite

O sistema envia sozinho, pelo número da clínica (Z-API), confirmação, lembrete, pós-atendimento, aniversário e a resposta do pedido online; lê as respostas das clientes ("1" confirma, "2" pede remarcação).

**Aceite:**
- Agendamento marcado com ≥ 24h de antecedência recebe a confirmação 24h antes; com menos, em até 1 minuto (dentro da janela). Resposta "1" muda o status para `confirmado`.
- Resposta "2" e qualquer outra resposta aparecem no Início para a recepção.
- Nunca sai mais de 1 mensagem por minuto, nem mais que o limite por hora, nem fora da janela de horário.
- Falha de envio: até 3 tentativas (espera 5, 15, 45 min); depois `falhou` e aparece no Início. Z-API desconectada → aviso "WhatsApp desconectado" no Início e a fila acumula.
- Cancelar/remarcar agendamento cancela/reagenda as mensagens pendentes dele.
- Mensagens de marketing (aniversário) só para `aceita_whatsapp_marketing`.
- Sem chaves Z-API ou com o envio desligado, nada sai (a fila só acumula) e o resto do sistema funciona igual.
- Recepção e profissional não editam modelos nem configurações; profissional não vê a fila.

**Fora do escopo:** retorno por serviço, clientes sumidas, leads (Fase 5); mídia/anexos; múltiplos números.

## 2. Decisões

| Tema | Decisão |
|---|---|
| Ritmo | 1 mensagem por execução; execução a cada minuto (pg_cron + pg_net chamando o site) |
| Autenticação do relógio | Token aleatório gerado pela própria migração numa tabela que só o `service_role` lê; o job envia no cabeçalho `x-cron-token`; a rota compara lendo com o cliente admin. Ninguém digita segredo |
| URL do site | Guardada na mesma tabela (`whatsapp_relogio.url`), nula por padrão (job não faz nada); o controlador grava a URL do site em cada projeto ao implantar |
| Credenciais Z-API | Variáveis de ambiente do servidor `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`, e `ZAPI_WEBHOOK_TOKEN` (segredo da URL do webhook). Coladas pelo usuário na Vercel |
| Liga/desliga | `configuracoes_clinica.whatsapp_ativo boolean default false` |
| Texto | Modelos por tipo com 1–5 variações; variável `{nome}` (primeiro nome), `{data}` (dd/MM), `{hora}` (HH:mm), `{servico}`, `{profissional}`, `{clinica}`; sorteio da variação no envio; texto final gravado na fila ao enviar |
| Quando renderizar | No envio (pega dados atuais). Avulsa: texto já pronto |
| Condições no envio | Confirmação só se o agendamento ainda está `pendente`; lembrete só se `confirmado`; pós só se `atendido`; senão a mensagem vira `cancelada` (motivo) sem enviar |
| Confirmação | `agendado_para = inicio − 24h` (ou agora, se já passou) ao criar ou remarcar agendamento não cancelado com status `pendente` |
| Lembrete | `inicio − 2h` |
| Pós-atendimento | Ao entrar em `atendido`: dia seguinte 10:00 SP |
| Aniversário | Job diário 09:00 SP enfileira para clientes ativas com aniversário hoje, opt-in e WhatsApp; uma por cliente por ano |
| Pedido online | Aprovar/recusar enfileira `pedido_aprovado`/`pedido_recusado` (agendado para agora); o botão "Avisar no WhatsApp" continua só quando o envio automático está desligado |
| Resposta | Webhook `/api/webhooks/zapi?token=…`; ignora `fromMe` e grupos; associa ao próximo agendamento (início ≥ agora − 2h, não cancelado) do telefone; "1" (após trim, também "1." / "sim") → confirma se `pendente`; "2" → marca `quer_remarcar`; outra → `para_ler` |
| Status da conexão | A cada execução do relógio grava `whatsapp_status` (conectado/desconectado/sem_chaves, verificado_em) vindo do endpoint de status da Z-API (no máximo 1 consulta a cada 5 min) |
| Exclusão | Nada é apagado; cancelar com motivo |

## 3. Banco — migração `0012_whatsapp.sql`

- `configuracoes_clinica` ganha `whatsapp_ativo bool not null default false`.
- `create type tipo_mensagem as enum ('confirmacao','lembrete','pos_atendimento','aniversario','pedido_aprovado','pedido_recusado','avulsa')`; `status_mensagem as enum ('pendente','enviando','enviada','falhou','cancelada')`.
- **`modelos_mensagem`** (tipo pk exceto avulsa, `variacoes text[]` 1–5 itens, cada 1–1000 caracteres, `ativo bool`, atualizado_em) com textos padrão inseridos pela migração.
- **`fila_mensagens`**: id, tipo, cliente_id (null para pedido online), pedido_online_id, agendamento_id, telefone (`^55\d{10,11}$`), texto (null até enviar, exceto avulsa), agendado_para, status, tentativas int, proxima_tentativa_em, erro text, id_externo, enviada_em, cancelada_motivo, criado_por, criado_em, atualizado_em. Índices (status, agendado_para), agendamento_id. Unique parcial: um `aniversario` por cliente por ano; um `confirmacao`/`lembrete`/`pos_atendimento` pendente por agendamento.
- **`mensagens_recebidas`**: id, telefone, texto, id_externo unique, recebida_em, agendamento_id null, classificacao (`confirmou`|`quer_remarcar`|`para_ler`), lida_em, lida_por.
- **`whatsapp_relogio`** (linha única): token text (gerado `encode(gen_random_bytes(32),'hex')`), url text null. Só `service_role` lê (revoke all de anon/authenticated).
- **`whatsapp_status`** (linha única): estado (`conectado`|`desconectado`|`sem_chaves`), verificado_em.
- **Gatilho em agendamentos** (after insert/update de status, inicio): cancela pendentes de confirmação/lembrete do agendamento ao cancelar/remarcar; reagenda confirmação (se pendente) e lembrete; entrando em `atendido` enfileira pós-atendimento. Só cria se a cliente tem WhatsApp.
- **Funções (security definer, search_path '')**:
  - `proxima_mensagem()` (só service_role): se `whatsapp_ativo` e agora dentro da janela (SP) e enviadas na última hora < limite e nenhuma enviada no último minuto → trava (`for update skip locked`) a pendente mais antiga com `agendado_para ≤ now()` e `proxima_tentativa_em ≤ now()` (ou nula), marca `enviando`, devolve linha + dados para renderizar (nome, data/hora, serviço, profissional, status do agendamento, variações do modelo).
  - `concluir_envio(p_id, p_texto, p_id_externo)`, `falhar_envio(p_id, p_erro)` (backoff 5/15/45 min; 3ª falha → `falhou`), `descartar_envio(p_id, p_motivo)` (condição não atendida → `cancelada`) — só service_role.
  - `registrar_recebida(p_telefone, p_texto, p_id_externo)` — só service_role; idempotente por id_externo; aplica a regra "1"/"2".
  - `enviar_avulsa(p_cliente, p_texto, p_agendamento)` (dona/recepção) → uuid; `cancelar_mensagem(p_id, p_motivo)` e `reenviar_mensagem(p_id)` (dona/recepção; reenviar só `falhou`/`cancelada` → nova pendente agora); `marcar_recebida_lida(p_id)` (dona/recepção).
  - `enfileirar_aniversarios()` (job diário).
  - `gravar_status_whatsapp(p_estado)` (service_role).
- **pg_cron**: `whatsapp_relogio` a cada minuto (`net.http_post` para `url || '/api/whatsapp/processar'` com o token; no-op se url nula ou pg_net ausente) e `whatsapp_aniversarios` diário 12:00 UTC (09:00 SP). Criação tolerante como em 0009.
- **RLS**: modelos — todos autenticados leem, só dona escreve (update); fila — dona e recepção leem, profissional nada; recebidas — dona e recepção; escrita só por funções.

## 4. Servidor

- `src/lib/whatsapp/zapi.ts`: `enviarTexto(telefone, texto) → { ok: true; idExterno } | { ok: false; erro; desconectado?: boolean }`, `statusConexao() → 'conectado'|'desconectado'|'sem_chaves'`. Base `https://api.z-api.io/instances/{ID}/token/{TOKEN}`, cabeçalho `Client-Token`; timeout 10 s. Único módulo que conhece a Z-API.
- `src/lib/dominio/whatsapp.ts` (puro): `renderizarMensagem(variacoes, dados, sortear)`, `dentroDaJanela(agora, inicio, fim)`, `classificarResposta(texto)`, `podeEnviar(tipo, statusAgendamento)`, `TEXTOS_PADRAO`, `ROTULO_TIPO`.
- `src/app/api/whatsapp/processar/route.ts` (POST): confere `x-cron-token` contra `whatsapp_relogio.token` (admin client; comparação em tempo constante); atualiza status (≤ 1 vez a cada 5 min); sem chaves → sai; `proxima_mensagem()` → renderiza → condição → `enviarTexto` → concluir/falhar. Responde 200 sempre que autenticado.
- `src/app/api/webhooks/zapi/route.ts` (POST): confere `?token=` com `ZAPI_WEBHOOK_TOKEN`; ignora `fromMe`/grupo; `registrar_recebida`.
- `src/lib/auth/rotas.ts`: as duas rotas de API são públicas para o middleware (autenticam por token).

## 5. Telas

- **Configurações → WhatsApp** (dona): interruptor "Envio automático ativo", janela (início/fim), limite por hora, estado da conexão, editor dos modelos por tipo (variações em caixas de texto, botão adicionar/remover, prévia com dados de exemplo, lista das variáveis).
- **Mensagens** (`/mensagens`, dona e recepção; menu "Mensagens", ícone MessageCircle): abas `Fila` (filtro por status, cliente, tipo; ações Cancelar e Tentar de novo) e `Respostas` (para ler / quer remarcar / confirmou; marcar como lida; link para o agendamento).
- **Envio avulso**: botão "Enviar WhatsApp" na ficha da cliente e no detalhe do agendamento (diálogo com texto, prefixado "Oi, {primeiro nome}!").
- **Início**: alerta "WhatsApp desconectado" (dona e recepção) quando estado ≠ conectado e envio ativo; cartão "Respostas do WhatsApp" (quer remarcar + para ler, não lidas); cartão "Mensagens com falha".
- **Pedidos online**: após aprovar/recusar, com envio ativo mostra "Mensagem enviada para a fila"; desligado, mantém o botão "Avisar no WhatsApp".

## 6. Testes

- **Vitest:** renderização (variáveis, primeiro nome, variação sorteada com função injetada); janela (bordas, fuso SP); classificação ("1", " 1 ", "1.", "sim", "2", "Quero remarcar", "ok"); zapi.ts com `fetch` simulado (sucesso, 4xx, timeout, desconectado, sem chaves); rotas (token errado → 401; fluxo completo com mocks; webhook ignora fromMe).
- **Banco:** gatilhos (criar com 48h → confirmação em inicio−24h; com 2h → agora; remarcar reagenda; cancelar cancela; atendido → pós 10:00 do dia seguinte SP; sem WhatsApp não cria); `proxima_mensagem` respeita desligado, janela, limite/hora e 1/min, skip locked; backoff e `falhou` na 3ª; `registrar_recebida` "1" confirma pendente, idempotente; aniversário uma por ano e só opt-in; RLS por perfil; `whatsapp_relogio` ilegível para authenticated.
- **Playwright (com backend):** dona edita modelo e liga o envio; recepção envia avulsa e vê na fila como pendente; cancela; respostas aparecem no Início (inserindo recebida via admin).

## 7. Implantação

1. Aplicar `0012` em testes e produção antes do merge (envio nasce desligado).
2. Controlador grava `whatsapp_relogio.url` = URL do site em cada projeto (produção: `https://sistema-madamef.vercel.app`).
3. Usuário: cria conta Z-API, conecta o número da clínica, cola `ZAPI_INSTANCE_ID`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN` e um `ZAPI_WEBHOOK_TOKEN` (texto aleatório) na Vercel; no painel Z-API configura o webhook "Ao receber" para `https://sistema-madamef.vercel.app/api/webhooks/zapi?token=<ZAPI_WEBHOOK_TOKEN>`.
4. Dona revisa os modelos e liga "Envio automático ativo".

## 8. Riscos

| Risco | Mitigação |
|---|---|
| Bloqueio do número | 1/min, limite/hora, janela, variações, opt-in de marketing |
| Relógio chamado por terceiros | token aleatório só no banco; 401 sem ele |
| Mensagem duplicada | trava `skip locked` + status `enviando`; unique parciais; webhook idempotente |
| Confirmação para quem já confirmou | condição verificada no envio |
| Z-API fora do ar | backoff, `falhou` visível, alerta de desconexão |
