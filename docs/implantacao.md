# Guia de implantação — Madame Fê Clinic

Este guia leva o sistema do computador de quem desenvolveu até o ar, em dois projetos Supabase (um de **testes** e um de **produção**) e um projeto Vercel. As partes 1 a 7 são passo a passo para a dona da clínica (com ajuda de quem for acompanhar); a parte 8 é para a pessoa de tecnologia.

## O que você vai precisar

- Uma conta no [GitHub](https://github.com) com o repositório do sistema.
- Uma conta no [Supabase](https://supabase.com) e outra na [Vercel](https://vercel.com).
- Um e-mail da clínica para ser a conta da dona.
- Opcional: um domínio próprio (por exemplo `sistema.madamefe.com.br`).

> **Plano da Vercel.** O plano gratuito (Hobby) da Vercel é só para uso pessoal e não comercial. Como a clínica é uma empresa, use o plano **Pro**. O mesmo vale para o Supabase: use o plano **Pro** na produção (ele inclui backups diários e o encerramento de sessão por inatividade).

## 1. Criar os dois projetos no Supabase

1. Em supabase.com, clique em **New project** e crie `madame-fe-testes` (plano gratuito basta). Anote a senha do banco.
2. Crie também `madame-fe-producao`, no plano **Pro**, em uma região próxima (São Paulo). Guarde a senha em um gerenciador de senhas.
3. Em cada projeto, abra **Project Settings → API** e anote: **Project URL**, **anon public key** e **service_role key**.

A `service_role key` é secreta: dá acesso total ao banco. Nunca a envie por e-mail ou chat, nem a coloque em nada que comece com `NEXT_PUBLIC_`.

## 2. Criar as tabelas (migrations)

As tabelas e as regras de segurança estão em `supabase/migrations/`, em dezessete arquivos que **devem ser aplicados nesta ordem**: `0001_base.sql`, `0002_agenda.sql`, `0003_caixa.sql`, `0004_clientes_busca.sql`, `0005_pagamento_unico.sql`, `0006_ficha_clinica.sql`, `0007_pacotes_cobranca.sql`, `0008_ajustes_fase2.sql`, `0009_agendamento_online.sql`, `0010_financeiro.sql`, `0011_comissoes_estoque.sql`, `0012_whatsapp.sql`, `0013_whatsapp_status_where.sql`, `0014_crm_tipos.sql`, `0015_crm.sql`, `0016_robo_tipos.sql`, `0017_robo.sql`. (Se o projeto já está em uso, veja as seções "Fase 2", "Fase 3A", "Fase 4", "Fase 4B", "Fase 3B" e "Fase 5" abaixo antes de aplicar 0006 a 0017.)

Escolha uma das formas, para cada projeto:

- **Pela linha de comando** (quem desenvolve): `pnpm supabase login`, depois `pnpm supabase link --project-ref <ref-do-projeto>` e `pnpm supabase db push`. O `<ref-do-projeto>` aparece na URL do painel do Supabase.
- **Pelo painel**: em **SQL Editor**, abra cada arquivo (na ordem acima), cole o conteúdo e clique em **Run**.

Depois, para ter serviços de exemplo no projeto de **testes**, rode também `supabase/seed.sql` no SQL Editor. Na produção, cadastre os serviços reais pela tela Serviços.

**Atenção:** nunca aplique `supabase/tests/shim.sql` em um projeto real. Ele existe só para os testes locais de banco e recriaria estruturas que o Supabase já tem.

## Fase 2 — ficha clínica, pacotes e pagamento dividido

**O que as migrações criam**

- `0006_ficha_clinica.sql`: modelos versionados de anamnese e de termo (com um modelo de anamnese e um termo genérico de exemplo), anamneses, termos assinados, fotos, evoluções, auditoria de acessos, funções de permissão e o bucket privado `ficha-clinica` (limite de 5 MB; JPEG, PNG e PDF) com suas duas políticas. **O bucket é criado pela própria migração: não o crie à mão nem o torne público.**
- `0007_pacotes_cobranca.sql`: pacotes de sessões e cobranças com pagamento dividido (1 a 4 formas). Cada pagamento antigo vira uma cobrança, então o resultado do caixa não muda. Antes de converter, a migração presume que nenhum atendimento nem pagamento já esteja ligado a pacote (veja a conferência abaixo).
- `0008_ajustes_fase2.sql`: ajustes da revisão final — cortesia (atendimento de total zero é confirmado sem forma de pagamento e sai das listas "sem pagamento"); termos e anamneses só são gravados com os arquivos já no bucket, e cada arquivo serve a um único registro; a versão da anamnese tem de ser a do modelo; foto, termo e evolução ligados a um atendimento têm de ser da mesma cliente, e a cliente de um atendimento que já tem foto, termo ou evolução não pode ser trocada; pacote não pode ser usado em atendimento já cobrado; a venda de pacote não se repete num duplo toque.

**Estado atual:** 0006 (2026-11-04) e 0007 (2026-11-05) aplicadas no projeto de testes (`myfpjwtmfonuvsrsvato`), com as conferências e os avisos do Supabase verificados (só os avisos esperados de funções chamáveis por usuário logado). A 0008 foi aplicada no projeto de testes em 2026-11-06 (conferências prévias em `0`, `rolbypassrls = t`, avisos só os esperados). Na produção (`vxvrzhskytsbreexnbun`), 0006 (2026-11-06), 0007 e 0008 (2026-11-07) foram aplicadas com o banco ainda vazio; todas as conferências do passo 4 passaram.

**Passo manual na produção** (feito por quem tem acesso; nada disso é automático):

0. **Aplique 0006, 0007 e 0008 na produção ANTES do merge em main (o merge publica na Vercel).** O código da Fase 2 depende das três; publicado antes, quebra a ficha, o caixa e a agenda.
1. Faça um backup ou crie um ponto de restauração (Database > Backups).
2. Conferência antes da 0007, no SQL Editor (as duas devem devolver `0`):
   - `select count(*) from agendamentos where pacote_vendido_id is not null;`
   - `select count(*) from pagamentos where origem = 'pacote';`
   - Antes da 0008 (se 0006 já estiver aplicada; também devem devolver `0`): `select count(*) - count(distinct pdf_path) from termos_assinados;`, `select count(*) - count(distinct assinatura_path) from termos_assinados;` e `select count(*) - count(distinct assinatura_path) from anamneses;`
   - Ainda antes da 0008 — registros ligados a atendimento de outra cliente (cada uma deve devolver `0`):
     `select count(*) from termos_assinados x join agendamentos a on a.id = x.agendamento_id where a.cliente_id <> x.cliente_id;`,
     `select count(*) from fotos x join agendamentos a on a.id = x.agendamento_id where a.cliente_id <> x.cliente_id;` e
     `select count(*) from evolucoes x join agendamentos a on a.id = x.agendamento_id where a.cliente_id <> x.cliente_id;`
   - E anamnese com versão que não existe no modelo (deve devolver `0`):
     `select count(*) from anamneses x where not exists (select 1 from modelos_anamnese m where m.id = x.modelo_id and m.versao = x.modelo_versao);`
3. Aplique `0006_ficha_clinica.sql`, depois `0007_pacotes_cobranca.sql` e, por fim, `0008_ajustes_fase2.sql` (SQL Editor, ou `pnpm supabase link --project-ref vxvrzhskytsbreexnbun && pnpm supabase db push`).
4. Confira o resultado:
   - `select id, public, file_size_limit from storage.buckets where id = 'ficha-clinica';` deve dar `public = false` e `5242880`;
   - `select (select count(*) from pagamentos) = (select count(*) from pagamentos where cobranca_id is not null);` deve dar `true`;
   - `select count(*) from pg_policies where schemaname = 'storage' and policyname like 'ficha_clinica_%';` deve dar `2`;
   - `select versao, ativo from modelos_anamnese;` deve dar `1, true`;
   - `select pg_get_function_identity_arguments('public.vender_pacote'::regproc);` deve terminar em `p_id uuid` (0008).
   - `select rolbypassrls from pg_roles where rolname = (select proowner::regrole::name from pg_proc where proname = 'arquivo_ficha_existe');` deve dar `t` (0008: a função que confere os arquivos do bucket precisa enxergar `storage.objects` sem RLS; se der `f`, toda anamnese e todo termo novo são recusados).
   - **No projeto de testes, antes da produção:** depois de aplicar a 0008 lá, rode `pnpm e2e e2e/ficha.spec.ts -g "anamnese no tablet|termo: colhido"` (anamnese e termo gravados de ponta a ponta com os arquivos no bucket). Só siga para a produção com os dois passando.
5. Revise com a clínica o texto do modelo de anamnese e do termo genérico (são exemplos) em Configurações.

**Limitações aceitas**

- Auditoria: as leituras feitas pelo sistema são registradas. Uma pessoa autorizada que consulte o PostgREST ou o Storage diretamente, com o próprio login, **não** deixa registro de leitura (as escritas são sempre registradas por gatilho).
- A exportação dos dados da cliente (`/clientes/<id>/exportar`) tem `maxDuration` de 60 s; uma ficha com muitas fotos pode estourar esse tempo.
- `situacao_ficha` (data da última anamnese e "tem alerta") e `agendamentos_com_termo_pendente` devolvem só esses indicadores (datas e verdadeiro/falso) e são lidos **sem** registro na auditoria; o conteúdo da anamnese ou do termo só é entregue depois de `registrar_acesso`.
- Termo: a `modelo_versao` gravada **não** é conferida contra o modelo num insert feito direto pelo PostgREST (a anamnese é conferida por gatilho). O servidor grava a versão correta, e mesmo num insert direto o PDF e a assinatura têm de ser arquivos que já existem no bucket (`arquivo_ficha_existe`), cada um usado uma única vez.
- A entrega do tablet para a cliente (anamnese e termo em tela cheia) **não tem trava de saída**: a cliente pode sair da tela e navegar no sistema com o login de quem entregou. Entregue e receba o tablet em mãos.

**Testes de tela da Fase 2:** `e2e/componentes.spec.ts` (assinatura e conversor de foto) roda sem backend, usando a página de apoio `/e2e-harness`, que só existe quando o build é feito com `NEXT_PUBLIC_E2E_HARNESS=1` (o Playwright liga essa variável sozinho; em qualquer outro build a rota responde 404 e o middleware não a libera). `ficha.spec.ts` e `cobranca.spec.ts` exigem o projeto de testes com 0006, 0007 e 0008 aplicadas.

Cuidados com os testes de tela da Fase 2:

- `cobranca.spec.ts` **tenta apagar** o caixa de hoje do projeto de testes (com cobranças, pagamentos e contas a receber dele) e **libera** (cancela, ou arquiva no passado se a comissão já foi paga — ver Fase 4B) os agendamentos não cancelados da profissional de teste hoje às 13:00 e em 6 dias às 10:00, para poder rodar de novo no mesmo dia.
- Os E2E com backend deixam linhas permanentes no projeto de testes (clientes, serviços, termos, pacotes, fotos e auditoria "E2E"); nada disso vai para a produção, mas o projeto de testes cresce a cada execução.
- `pnpm e2e` faz o build com `NEXT_PUBLIC_E2E_HARNESS=1` e deixa esse build (com a página `/e2e-harness`) em `.next`. Antes de `pnpm start` para outro uso, rode `pnpm build` de novo.

## Fase 3A — agendamento online

A Fase 3A adiciona a página pública `/agendar` (a cliente pede um horário; a recepção aprova ou recusa) e a migration `0009_agendamento_online.sql` (tabela `pedidos_online`, funções de horários livres, pedido, aprovação e recusa, limpeza diária LGPD).

**Estado atual:** 0009 aplicada no projeto de testes `myfpjwtmfonuvsrsvato` em 2026-11-09 (RLS ligado, 1 política em `pedidos_online`, job `pedidos_online_limpeza` em `cron.job`, avisos do Supabase só os esperados). Na produção `vxvrzhskytsbreexnbun`, 0009 aplicada em 2026-11-09 (online_ativo = false, RLS ligado, 1 política, job `pedidos_online_limpeza` em `cron.job`).

0. **Aplique a 0009 no projeto de testes e na produção ANTES do merge em main (o merge publica na Vercel).** O código da Fase 3A depende dela; publicado antes, a agenda, o Início e `/agendar` quebram. Site de produção: https://sistema-madamef.vercel.app.
1. Aplique `0009_agendamento_online.sql` (SQL Editor, ou `pnpm supabase link --project-ref <ref> && pnpm supabase db push`), primeiro no projeto de testes.
2. Conferências (rode no SQL Editor depois de aplicar):
   - `select online_ativo from configuracoes_clinica;` deve devolver `false` (o agendamento online nasce desligado).
   - `select count(*) from pg_policies where tablename = 'pedidos_online';` deve devolver `1`.
   - `select jobname from cron.job where jobname = 'pedidos_online_limpeza';` deve devolver 1 linha. **Confirme sempre:** se a extensão `pg_cron` não estiver disponível, a migration apenas registra um aviso (notice) e segue sem criar o agendamento; nesse caso ative `pg_cron` (Database > Extensions) e crie à mão o job diário `pedidos_online_limpeza` (`0 6 * * *` UTC, 03:00 em São Paulo) com `select public.expirar_pedidos_online(); select public.apagar_dados_pedidos_antigos();` (as duas funções). Sem `pg_cron` a migration pula o agendamento sem erro, só com um aviso fácil de perder: confira sempre `cron.job`. Sem ele, nome e WhatsApp de pedidos não aprovados passam de 90 dias sem serem apagados.
   - Advisors de segurança (Supabase > Advisors, ou `get_advisors`) sem nenhum **ERROR**.
3. **Cloudflare Turnstile** (anti-robô gratuito): em dash.cloudflare.com > Turnstile, crie um widget para o domínio `sistema-madamef.vercel.app`. Na Vercel (Settings > Environment Variables), defina `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (chave do site) e `TURNSTILE_SECRET_KEY` (chave secreta) e faça um novo deploy.
   - **Defina as duas ou nenhuma.** Com `TURNSTILE_SECRET_KEY` mas sem `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, a página não mostra o widget e **todos os pedidos são bloqueados** com o erro "Não foi possível confirmar que você não é um robô". Sem a secreta, a verificação é pulada (com aviso no log do servidor): serve só para desenvolvimento.
   - `NEXT_PUBLIC_SITE_URL` também precisa estar definido: ele aparece no link de `/agendar` das mensagens de recusa.
4. Em **Serviços**, marque "Pode ser agendado online" nos serviços que podem ser pedidos (cada um precisa de ao menos uma profissional vinculada).
5. Em **Configurações**, revise o aviso de privacidade, a antecedência mínima (padrão 2 h) e máxima (padrão 60 dias) e ligue o **agendamento online**.
6. Ponha o link `https://sistema-madamef.vercel.app/agendar` na bio do Instagram e no WhatsApp.

Como funciona: o pedido reserva o horário por 24 horas; a recepção vê o card no Início e a lista em **Agenda > Pedidos online** (botão "Pedidos online" no topo da Agenda, só para dona e recepção), aprova (com cliente nova ou já cadastrada) ou recusa, e avisa a cliente pelo botão "Avisar no WhatsApp" (abre o wa.me com a mensagem pronta). Pedidos sem resposta em 24 h expiram e liberam o horário. Limites: 3 pedidos aguardando por WhatsApp e 5 pedidos por hora por IP (guardado só como hash e apagado depois de 1 dia).

**Teste de tela da Fase 3A:** `e2e/agendar.spec.ts` (pedido, aprovação, recusa e página desligada nos 3 tamanhos) exige o projeto de testes com a 0009 aplicada, `E2E_PERMITIR_PROJETO` e acesso a `challenges.cloudflare.com` (o Playwright usa as chaves de teste oficiais da Cloudflare, que sempre aprovam). Ele liga e desliga `online_ativo` (termina desligado), cria o serviço "E2E Agendamento Online", refaz a jornada da profissional de teste num dia da semana próprio de cada tamanho (quinta, sexta e sábado, 14 a 20 dias à frente) e apaga os pedidos, as clientes "Cliente Online E2E ..." e os agendamentos da profissional nesse dia. Os três tamanhos se revezam por um lock em arquivo, pois a configuração é única.

## Fase 4 — Financeiro

A Fase 4 adiciona o menu **Financeiro** (painel, contas a receber, contas a pagar, fluxo de caixa e caixa do dia, com exportação em PDF e o sininho de avisos de vencimento) e a migration `0010_financeiro.sql` (tabelas `contas_pagar`, `contas_fixas`, `recebimentos`, `avisos_lidos`, `relatorios_gerados`, bucket privado `financeiro` e as funções de lançar, pagar, cancelar, receber parcela, resumo e fluxo).

**Estado atual:** 0010 aplicada no projeto de testes `myfpjwtmfonuvsrsvato` em 2026-11-11 (1 política de leitura em cada uma das 5 tabelas novas, bucket `financeiro` privado com 5242880 bytes e 2 políticas, `fechar_caixa` somando recebimentos, avisos do Supabase só os esperados). Na produção `vxvrzhskytsbreexnbun`, 0010 aplicada em 2026-11-11 (mesmas conferências; nenhuma tabela pública sem RLS).

0. **Aplique a 0010 no projeto de testes e na produção ANTES do merge em main (o merge publica na Vercel).** O código da Fase 4 depende dela; publicado antes, `/financeiro`, `/caixa` e o sininho quebram. Aplique primeiro no projeto de testes, confira, e só então na produção.
1. Aplique `0010_financeiro.sql` (SQL Editor, ou `pnpm supabase link --project-ref <ref> && pnpm supabase db push`). Nunca aplique `shim.sql`.
2. Conferências (rode nos dois projetos):
   - Políticas de segurança: `select count(*) from pg_policies where tablename in ('contas_pagar','contas_fixas','recebimentos','avisos_lidos','relatorios_gerados');` deve dar **5** (uma política `select` por tabela; as 2 políticas do bucket ficam em `storage.objects` e não entram na conta). RLS ligado nas cinco tabelas, e nenhuma delas com privilégio de `delete`.
   - Bucket: em Storage > Buckets, `financeiro` existe, é **privado** e limita cada arquivo a **5 MB** (`file_size_limit = 5242880`; só JPG, PNG e PDF). Por SQL: `select public, file_size_limit from storage.buckets where id = 'financeiro';` deve dar `false` e `5242880`.
   - `fechar_caixa` soma os recebimentos: receba uma parcela no caixa de hoje e feche o caixa; o total por forma e o dinheiro esperado incluem o valor recebido.
3. **Mudança de comportamento:** `fechar_caixa` passou a somar os recebimentos de parcelas e **não conta mais os pagamentos com forma `a_receber` no `total_geral`** (eles só entram quando a parcela é recebida). Caixas já fechados antes da 0010 não são recalculados.

**Como a dona usa**

- **Contas fixas:** em *Contas a pagar*, **Novo lançamento > Conta a pagar** e marque **Repete todo mês** (aluguel, internet...). O sistema cria a conta de cada mês até o mês seguinte; em meses curtos o dia 31 vira o último dia do mês. Para encerrar, use **Parar de repetir** em "Contas fixas (todo mês)" (as contas já geradas continuam e podem ser canceladas uma a uma, com motivo).
- **Vale:** botão **Lançar vale** escolhe a colaboradora, o valor e a forma; entra como despesa já paga na categoria Vale.
- **Anexos:** **Despesa com foto/PDF** (ou o campo de anexo ao lançar/editar) guarda a foto do recibo ou o PDF da nota (até 5 MB); o clipe da linha abre o arquivo por um link que vale 5 minutos. Só a dona envia e lê.
- **Sininho:** no topo, só para a dona; avisa contas a pagar e a receber que vencem em 7, 3 e 1 dia, hoje e as vencidas (um aviso por dia). **Marcar todos como lidos** limpa a lista; clicar num aviso abre a conta.
- **Recepção:** vê só **Caixa do dia** (abrir, lançar, fechar e receber as parcelas que vencem hoje ou já venceram); contas a pagar, totais e PDF são só da dona.
- Nada é apagado: contas canceladas continuam na lista, com o motivo.

**Teste de tela da Fase 4:** `e2e/financeiro.spec.ts` (conta fixa, marcar paga e cartão Pago, filtro Mês passado, Exportar PDF, sininho, `/caixa` redirecionando e a recepção recebendo uma parcela, nos 3 tamanhos) exige o projeto de testes **com a 0010 aplicada** e `E2E_PERMITIR_PROJETO`. Contas, recebimentos e a conta fixa não podem ser apagados (nem pela chave de serviço): a limpeza cancela o que ficou em aberto e desativa a conta fixa; contas pagas, o recebimento, a cliente "Cliente E2E Financeiro ..." e os avisos lidos ficam no projeto de testes. Se hoje não houver caixa, o spec abre um (e ele fica). Os três tamanhos se revezam por um lock em arquivo. Os três specs que usam o caixa de hoje (`caixa`, `cobranca` e `financeiro`) compartilham uma trava em arquivo (`e2e/trava-caixa.ts`) e nunca rodam ao mesmo tempo; `caixa` e `cobranca` tentam zerar o caixa, mas toleram dados que não podem ser apagados (reaproveitam o caixa aberto e pulam, com mensagem, se ele já estiver fechado).

## Fase 4B — Comissões e estoque

A Fase 4B gera a comissão da profissional e dá baixa nos produtos do serviço quando o atendimento é marcado como **atendido**, e adiciona a aba **Comissões** no Financeiro, a aba **Estoque** em Produtos e a migration `0011_comissoes_estoque.sql` (tabelas `colaboradores_comissao`, `servicos_comissao`, `comissoes` e `movimentos_estoque`, gatilhos de atendimento e de estoque e as funções de pagar comissões, entrada e ajuste).

**Estado atual:** 0011 aplicada no projeto de testes `myfpjwtmfonuvsrsvato` em 2026-11-11 (políticas: comissoes 1, movimentos_estoque 1, colaboradores_comissao 3, servicos_comissao 4; nenhuma tabela pública sem RLS; soma dos movimentos = estoque_atual em todos os produtos; avisos do Supabase só os esperados). Na produção `vxvrzhskytsbreexnbun`, 0011 aplicada em 2026-11-11 (mesmas conferências; 1 produto com saldo virou ajuste "Saldo anterior").

0. **No projeto de testes, antes de tudo:** aplique a 0011 lá, faça as conferências do passo 2 e rode o E2E da Fase 4B (abaixo). Isso pode ser feito com folga, dias antes.
1. **Na produção, a 0011 vai IMEDIATAMENTE antes do merge em main (o merge publica na Vercel)** — de preferência fora do horário de atendimento, com o merge pronto para ser feito logo em seguida. O código da Fase 4B depende dela (publicado antes, a aba Comissões, a aba Estoque e marcar "atendido" quebram), mas a 0011 também **liga os gatilhos na hora em que é aplicada**, enquanto o sistema antigo ainda está publicado. Nessa janela entre aplicar e publicar:
   - **Comissão a 0%:** todo atendimento marcado como atendido já gera a comissão, e o **percentual é gravado no momento em que se marca** (depois só a base é recalculada, por exemplo quando a cobrança é lançada). Como ainda não há percentuais preenchidos, o que for marcado nessa janela — e depois dela, até a dona preencher os percentuais — fica com **0%**.
   - **Cadastro de produto antigo:** o formulário de produto antigo ainda tem o campo de estoque; o banco **recusa** criar um produto com estoque maior que zero e recusa mudar o estoque ao editar ("O estoque só muda por entrada ou ajuste."). Editar os outros campos continua funcionando; para cadastrar produto novo, deixe o estoque em 0 e lance a entrada pela aba Estoque depois do merge.
   Aplique `0011_comissoes_estoque.sql` (SQL Editor, ou `pnpm supabase link --project-ref <ref> && pnpm supabase db push`) e faça o merge logo depois. Nunca aplique `shim.sql`.
2. Conferências (rode nos dois projetos, logo depois de aplicar):
   - Políticas de segurança: `select tablename, count(*) from pg_policies where tablename in ('comissoes','movimentos_estoque','colaboradores_comissao','servicos_comissao') group by tablename;` deve listar as **4** tabelas, todas só para a dona; RLS ligado nas quatro, sem acesso do `anon`.
   - Estoque consistente: para todo produto, a soma de `movimentos_estoque.quantidade` é igual a `produtos.estoque_atual`. Por SQL: `select p.id, p.nome from public.produtos p where p.estoque_atual <> coalesce((select sum(m.quantidade) from public.movimentos_estoque m where m.produto_id = p.id), 0);` deve voltar **zero linhas** (os saldos que já existiam viram um movimento "Saldo anterior" na migração).
3. **Assim que publicar, ANTES de a equipe marcar atendimentos**, a dona: (a) preenche **Comissão padrão (%)** de cada profissional em *Equipe*; (b) preenche **Comissão (%)** dos serviços que têm percentual próprio (vazio = usa a padrão da profissional); (c) confere, em *Serviços*, os **produtos consumidos** por serviço, porque é eles que dão baixa no estoque a cada atendimento.
4. **Remédio para comissões a 0%:** se algum atendimento foi marcado como atendido antes de os percentuais estarem preenchidos (aparece em *Financeiro > Comissões* com 0%), a dona abre o atendimento na agenda, **desmarca** (volta para confirmado) e **marca de novo** como atendido: a comissão é recalculada com o percentual atual (e o estoque é estornado e baixado de novo, sem duplicar). Só funciona enquanto a comissão estiver **em aberto**; depois de paga ela não muda.

**Como a dona usa**

- **Comissão:** ao marcar o atendimento como atendido, a comissão (percentual do serviço, ou o padrão da profissional, sobre o valor cobrado já com desconto) entra **Em aberto** em *Financeiro > Comissões*. Desmarcar o atendimento cancela/recalcula a comissão; uma comissão **paga** não pode mais mudar.
- **Pagar comissões:** no resumo por profissional e mês, **Pagar comissões** pede a data e a forma e lança uma despesa de salário já paga (`Comissão — <profissional> — MM/AAAA`) em *Contas a pagar*; as comissões do mês ficam **Pagas**.
- **Estoque:** em *Produtos > Estoque* aparecem os produtos **Abaixo do mínimo**, a tabela com **Entrada** (compra, com opção de lançar em Contas a pagar) e **Ajuste** (contagem, com motivo) e o histórico de movimentos. O estoque só muda por entrada, ajuste ou atendimento; **Ver estoque**, no cadastro do produto, abre a aba já destacando o produto.
- **Recepção e profissional** não veem as abas Comissões nem Estoque; marcar atendido continua funcionando para eles.
- Nada é apagado: comissões canceladas e movimentos continuam no histórico.

**Teste de tela da Fase 4B:** `e2e/comissoes-estoque.spec.ts` (dona configura 20% no serviço, entrada e ajuste de estoque, recepção marca atendido e não vê as abas, dona vê a comissão em aberto e o estoque baixado, `?produto=<id>` destacando e filtrando, `Pagar comissões` com despesa em Contas a pagar, nos 3 tamanhos) exige o projeto de testes **com a 0011 aplicada** e `E2E_PERMITIR_PROJETO`. Comissões, movimentos e despesas não podem ser apagados: a limpeza só desativa o produto e o serviço criados ("E2E Comissões ..."); a comissão paga, a despesa de salário e os movimentos ficam no projeto de testes. O atendimento é da **segunda profissional de teste** (`E2E_PROFISSIONAL2_EMAIL`), que nenhum outro spec marca como atendido: "Pagar comissões" paga todas as comissões em aberto dela no mês sem tocar nas dos outros specs; os três tamanhos se revezam pela trava em arquivo de `e2e/trava-caixa.ts`.

**Rodar de novo no mesmo dia:** desde a 0011, um atendimento marcado como atendido tem comissão (e talvez movimentos de estoque) ligada a ele e **não pode mais ser apagado** (nem pela chave de serviço). Por isso os specs que reutilizam um horário fixo (`caixa`, `cobranca`, os que usam `prepararFicha` e a preparação `auth.setup.ts`) liberam o horário com `e2e/horario-livre.ts`: cancelam o agendamento que sobrou da execução anterior (a comissão em aberto é cancelada e o estoque estornado) ou, se a comissão dele já foi paga, movem o agendamento para um minuto "arquivado" entre 2000 e 2009. Esses agendamentos antigos ficam no projeto de testes.

## Fase 3B — WhatsApp (Z-API)

A Fase 3B manda WhatsApp automático pela Z-API: confirmação, lembrete, pós-atendimento, aniversário e resposta de pedido online, além do envio avulso e da leitura das respostas. Traz a tela **Mensagens** (`/mensagens`, abas Fila e Respostas), a seção **WhatsApp** em Configurações, os cartões **Respostas do WhatsApp** e **Mensagens com falha** no Início e a migration `0012_whatsapp.sql` (tabelas `modelos_mensagem`, `fila_mensagens`, `mensagens_recebidas`, `whatsapp_status` e `whatsapp_relogio`, gatilhos de agenda, funções da fila e os jobs `whatsapp_relogio`, `whatsapp_aniversarios` e `limpar_historico_cron`, que usam `pg_cron` e `pg_net`). O envio **nasce desligado**.

**Estado atual:** 0012 aplicada no projeto de testes `myfpjwtmfonuvsrsvato` em 2026-11-11 (políticas: modelos_mensagem 2, fila_mensagens 1, mensagens_recebidas 1, whatsapp_status 1; jobs whatsapp_relogio, whatsapp_aniversarios e limpar_historico_cron no cron; pg_net no schema extensions; whatsapp_relogio.url nula; nenhuma tabela pública sem RLS; avisos do Supabase só os esperados). Na produção `vxvrzhskytsbreexnbun`, 0012 aplicada em 2026-11-11 (mesmas conferências; envio desligado; url do relógio gravada logo após a publicação).

0. **No projeto de testes, antes de tudo:** aplique a 0012 lá, faça as conferências do passo 3 e rode o E2E da Fase 3B (abaixo).
1. **Aplique `0012_whatsapp.sql` em testes e na produção ANTES do merge em main** (o merge publica na Vercel; o código depende das tabelas). SQL Editor, ou `pnpm supabase link --project-ref <ref> && pnpm supabase db push`. Nunca aplique `shim.sql`. Com o envio desligado, nada sai.
2. **Grave a URL do relógio** (o job chama `/api/whatsapp/processar` nessa URL, a cada minuto, com um token que só existe no banco). Na **produção**:
   ```sql
   update public.whatsapp_relogio set url = 'https://sistema-madamef.vercel.app';
   ```
   No projeto de **testes** a `url` fica **sempre nula** (o relógio não chama ninguém). Nunca grave em testes uma URL de um deploy que tenha as chaves da Z-API: o E2E liga e desliga `whatsapp_ativo` no projeto de testes, e com a URL apontando para um deploy com chaves as mensagens da fila de testes sairiam de verdade.
3. Conferências (rode nos dois projetos, logo depois de aplicar):
   - Políticas: `select tablename, count(*) from pg_policies where tablename in ('modelos_mensagem','fila_mensagens','mensagens_recebidas','whatsapp_status') group by tablename;` deve listar as **4** tabelas; RLS ligado nelas e em `whatsapp_relogio` (esta sem nenhuma política: `authenticated` não lê).
   - Jobs: `select jobname from cron.job;` deve mostrar `whatsapp_relogio`, `whatsapp_aniversarios` e `limpar_historico_cron`.
   - Extensão: `select extname from pg_extension where extname = 'pg_net';` deve voltar uma linha.
   - Relógio (só na **produção**, depois do passo 2): rode `select public.disparar_relogio_whatsapp();`, espere alguns segundos e rode `select status_code, content from net._http_response order by created desc limit 1;`. Antes de cadastrar as chaves (passo 4) o esperado é **200** com `sem_chaves` no conteúdo. **401** quer dizer que a `url` aponta para o projeto errado (um deploy ligado a outro banco, cujo token não confere); corrija a `url` do passo 2. Nenhuma linha: confira se `pg_net` está instalada.
   - Histórico do `pg_cron`: o relógio roda a cada minuto e grava ~1440 linhas por dia em `cron.job_run_details`. O job `limpar_historico_cron` (todo dia, 03:17 SP) apaga as linhas com mais de 7 dias. Se o job não existir (pg_cron indisponível na hora da migration), limpe à mão de vez em quando: `delete from cron.job_run_details where end_time < now() - interval '7 days';`.
4. **Passos de quem usa (nunca cole as chaves no chat):**
   - Crie a conta na Z-API, crie a instância e conecte o número do WhatsApp da clínica (QR code).
   - Na Vercel (Settings > Environment Variables), cadastre as 4 variáveis do servidor **só no ambiente Production** (desmarque Preview e Development): `ZAPI_INSTANCE_ID` e `ZAPI_TOKEN` (na instância, no painel da Z-API), `ZAPI_CLIENT_TOKEN` (no painel da Z-API, em *Segurança > Token de segurança da conta*) e `ZAPI_WEBHOOK_TOKEN` (este último é um texto aleatório criado por você). Nenhuma é `NEXT_PUBLIC_`. Deploys de preview ficam sem as chaves e nunca enviam; o projeto de testes continua com `whatsapp_relogio.url` nula. Sem elas o estado é "Chaves da Z-API não configuradas" e nada é enviado, sem erro na tela. Faça um novo deploy depois de cadastrar.
   - **Z-API Omni (alternativa):** com um canal *WhatsApp Web* na Omni, cadastre `OMNI_SECRET_KEY` (painel Omni > *Segurança* > Secret Key; não é o "Token" do canal) e `OMNI_CHANNEL_ID` ("ID do canal"), também só em Production, mais `ZAPI_WEBHOOK_TOKEN`. Com as duas `OMNI_*` definidas o sistema usa a Omni e ignora `ZAPI_INSTANCE_ID`/`ZAPI_TOKEN`/`ZAPI_CLIENT_TOKEN`. O status da conexão vem de `GET /v1/channels/{id}/zapi/qr-code/image` (`connected`).
   - No painel da Z-API, configure o webhook **"Ao receber"** para `https://sistema-madamef.vercel.app/api/webhooks/zapi?token=<ZAPI_WEBHOOK_TOKEN>`.
   - Na Omni: abra o canal > *Webhooks* > adicionar; URL `https://sistema-madamef.vercel.app/api/webhooks/zapi?token=<ZAPI_WEBHOOK_TOKEN>`, evento **MESSAGE_RECEIVED**, formato **DEFAULT** ou **Z_API** (os dois são aceitos), autenticação **NONE** (o token já vai na URL).
   - A dona revisa os modelos em *Configurações > WhatsApp* e só então marca **Envio automático ativo**. Ao ligar, confirmações de horários que já passaram são descartadas, não enviadas.

**Teste de tela da Fase 3B:** `e2e/whatsapp.spec.ts` (dona edita um modelo e vê a prévia, liga e desliga o envio, recepção envia avulsa e vê `Pendente` na Fila, cancela e tenta de novo, resposta inserida por `registrar_recebida` aparece em `Respostas do WhatsApp` no Início e some ao marcar como lida, profissional não vê `Mensagens`, nos 3 tamanhos) exige o projeto de testes **com a 0012 aplicada** e `E2E_PERMITIR_PROJETO`. O spec **termina sempre com o envio desligado** e devolve o texto original do modelo de aniversário. Mensagens e respostas não podem ser apagadas: a avulsa fica como Cancelada e a resposta como lida no projeto de testes. Desde a 0012 a fila tem FK para agendamentos, pedidos e clientes, então os specs `agendar` e `agenda` **não apagam mais** agendamentos, pedidos nem clientes: cancelam o dia (`liberarHorario`), expiram os pedidos aguardando e usam nome e telefone únicos por execução. O atendimento do `whatsapp.spec` fica em hoje+24 (dia que nenhum outro spec usa) e o `agendar.spec` pega a mesma trava de `e2e/trava-caixa.ts` e grava `whatsapp_ativo = false` (os diálogos de pedido só mostram "Avisar no WhatsApp" com o envio desligado).

## Fase 5 — CRM e robô

A Fase 5 traz o menu **CRM** (`/crm`, só dona e recepção: abas Retorno, Sumidas, Leads e Aniversariantes), o painel novo do **Início** (cartões, gráficos e o quadro de CRM), a tela única de **Mensagens** (lista de conversas e conversa lado a lado) e o **robô de atendimento** do WhatsApp (menu de opções numeradas, sem inteligência artificial; o WhatsApp continua só com textos e emojis). As migrações são quatro: `0014_crm_tipos.sql` (novos valores `retorno` e `reativacao` de tipo de mensagem), `0015_crm.sql` (modelos Retorno e Reativação, `leads`, listas de retorno e de sumidas, indicadores, envios e o job `crm_retornos`), `0016_robo_tipos.sql` (valor `robo`) e `0017_robo.sql` (`robo_config`, `robo_opcoes`, `robo_sessoes` e as funções do robô). Os tipos novos precisam de uma migração própria (`0014` e `0016`) porque o Postgres só deixa usar um valor de enum depois que ele foi confirmado.

**Estado atual:** 0014–0017 ainda não aplicadas (nem no projeto de testes `myfpjwtmfonuvsrsvato`, nem na produção `vxvrzhskytsbreexnbun`).

0. **No projeto de testes, antes de tudo:** aplique 0014, 0015, 0016 e 0017 lá, faça as conferências do passo 2 e rode os E2E da Fase 5 (abaixo).
1. **Aplique `0014`, `0015`, `0016` e `0017`, nesta ordem, em testes e na produção ANTES do merge em main** (o merge publica na Vercel; o código depende das tabelas e das funções). SQL Editor, um arquivo por vez, ou `pnpm supabase link --project-ref <ref> && pnpm supabase db push`. Nunca aplique `shim.sql`. A 0014 e a 0016 só adicionam valores de enum: rode cada uma sozinha, antes da migração que as usa.
2. Conferências (rode nos dois projetos, logo depois de aplicar):
   - Políticas: `select tablename, count(*) from pg_policies where tablename in ('leads','robo_config','robo_opcoes','robo_sessoes') group by tablename;` deve listar as **4** tabelas (leads 3, robo_config 2, robo_opcoes 4, robo_sessoes 1); RLS ligado nelas, e nenhuma tabela pública sem RLS.
   - Job: `select jobname from cron.job;` deve incluir `crm_retornos` (09:00 de São Paulo; enfileira os retornos do dia).
   - Tipos de mensagem: `select unnest(enum_range(null::public.tipo_mensagem));` deve incluir `retorno`, `reativacao` e `robo`; `select tipo from public.modelos_mensagem where tipo in ('retorno','reativacao');` deve voltar as **2** linhas.
   - Robô nasce **desligado**: `select ativo from public.robo_config;` deve dar `false`; `select numero, rotulo from public.robo_opcoes order by numero;` mostra as 4 opções de exemplo.
3. **Passos da dona (depois do deploy):**
   - Em **Serviços**, preencha **Dias para retorno** nos serviços que pedem manutenção (por exemplo, 30 para limpeza de pele). Só esses entram na aba **Retorno**.
   - Em **Configurações → WhatsApp**, revise os modelos **Retorno** e **Reativação** (e os dias para uma cliente contar como sumida, padrão 90).
   - Em **Configurações → WhatsApp → Robô de atendimento**, escreva as respostas das opções (a opção 1 vem com um texto de exemplo para trocar), confira a prévia, escolha quando responder (sempre ou só fora do horário de funcionamento) e marque **Robô ativo**. O robô só responde com o envio automático do WhatsApp ligado.
   - Cadastre a **Jornada das profissionais** (Equipe), senão a opção "Agendar horário" do robô leva a uma página de agendamento online sem horários.
4. **Observações de uso:**
   - O robô fica pausado por 24 h numa conversa quando a equipe responde **pelo sistema** (Mensagens, ficha ou CRM) ou quando a cliente escolhe falar com a equipe (o Início mostra "pediu atendimento"). A pausa aparece no topo da conversa, com o botão **Retomar robô**.
   - **Resposta da equipe pelo celular (fora do sistema) não pausa o robô**: ele não enxerga o que sai do aparelho. Responda pelo sistema, ou use **Retomar robô** só quando quiser que ele volte.
   - A reativação só vai para quem aceitou marketing e não recebeu outra nos últimos 30 dias; as mensagens entram na fila e saem no horário de envio.

**Testes de tela da Fase 5:** `e2e/crm.spec.ts` (dona abre as 4 abas; recepção cria lead, move para Em conversa e converte; recepção seleciona uma cliente sumida, envia a reativação e vê a mensagem Pendente na conversa; profissional não vê o menu CRM; dona vê os 4 cartões no Início), `e2e/inicio-painel.spec.ts` (painel de dona, recepção e profissional sem rolagem horizontal; recepção e profissional sem dinheiro; profissional sem CRM e só com os próprios atendimentos) e `e2e/robo.spec.ts` (dona configura o robô e vê a prévia; uma resposta recebida gera o menu na conversa com o selo do robô; "falar com a equipe" pausa e **Retomar robô** volta a atender), todos nos 3 tamanhos, exigem o projeto de testes **com 0014–0017 aplicadas** e `E2E_PERMITIR_PROJETO`. Leads, mensagens da fila e respostas não podem ser apagados: o lead, a reativação (Pendente, nunca sai porque o relógio de testes não tem URL) e a conversa do robô ficam no projeto de testes, com nomes e telefones únicos por execução; a limpeza desativa as clientes criadas e libera o horário do atendimento antigo (`e2e/horario-livre.ts`). As tabelas do robô não aceitam escrita da chave de serviço: o `robo.spec` grava a configuração pela sessão da dona (`salvar_robo`), devolve a original no fim, **termina sempre com `whatsapp_ativo = false`** e se reveza com os outros specs de WhatsApp pela trava de `e2e/trava-caixa.ts`.

## 3. Configurar o login (Authentication)

Faça isto nos dois projetos. Todos os itens ficam em **Authentication** no painel.

1. **Sign In / Providers → Email**: deixe o login por e-mail e senha ligado e **desligue "Allow new users to sign up"** (cadastro público). Só a equipe convidada deve entrar.
2. **URL Configuration**:
   - **Site URL**: o endereço do sistema, por exemplo `https://sistema.madamefe.com.br` (na primeira rodada pode ser o endereço `.vercel.app`).
   - **Redirect URLs**: adicione `<endereço do sistema>/auth/confirmar` (por exemplo `https://sistema.madamefe.com.br/auth/confirmar`). Para o projeto de testes, adicione também `http://localhost:3000/auth/confirmar`.
3. **Email Templates**: edite os dois modelos abaixo, trocando o link do botão. Sem isso, o convite e a recuperação de senha **não funcionam**.
   - **Invite user** (convite de nova pessoa da equipe): o link deve ser
     `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite`
   - **Reset password** (esqueci minha senha): o link deve ser
     `{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery`

   Exemplo de corpo para o convite:
   ```html
   <h2>Você foi convidada para o sistema da Madame Fê Clinic</h2>
   <p><a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=invite">Criar minha senha</a></p>
   ```
   E para a recuperação:
   ```html
   <h2>Redefinir senha</h2>
   <p><a href="{{ .SiteURL }}/auth/confirmar?token_hash={{ .TokenHash }}&type=recovery">Escolher uma nova senha</a></p>
   ```
   O link abre uma tela com o botão **Continuar**; o token só é usado quando a pessoa toca nele. Assim, antivírus de e-mail que abrem os links sozinhos não invalidam o convite.
4. **Sessions** (plano Pro): ligue **Inactivity timeout** em **12 horas**. O sistema já derruba a sessão após 12 h sem uso por conta própria (cookie `ultima_atividade`), mas a configuração do Supabase protege também o lado do servidor.
5. **Project Settings → Database → Backups**: confirme que os backups diários estão ativos (plano Pro).

## 4. Publicar na Vercel

1. Em vercel.com, **Add New → Project**, escolha o repositório do GitHub e confirme (o Next.js é detectado sozinho).
2. Antes de publicar, em **Environment Variables**, cadastre as variáveis (use os dados do projeto **de produção**):

   | Variável | Valor |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key (secreta) |
   | `NEXT_PUBLIC_SITE_URL` | endereço público do sistema, sem barra no final (ex.: `https://sistema.madamefe.com.br`) |

   O `NEXT_PUBLIC_SITE_URL` é usado nos links de convite e de recuperação de senha; sem ele, os e-mails podem apontar para o endereço errado.
3. Clique em **Deploy**. Se alterar uma variável depois, faça um novo deploy (**Deployments → Redeploy**).
4. Para usar um domínio próprio: **Settings → Domains → Add**, siga as instruções de DNS e depois atualize `NEXT_PUBLIC_SITE_URL`, a **Site URL** e a **Redirect URL** do Supabase (passo 3) para o novo endereço.

## 5. Criar o primeiro acesso (a dona)

Quem desenvolve roda, no computador, apontando para a **produção**. Crie um arquivo `.env.local` (não vai para o GitHub) com `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` da produção e execute:

```bash
pnpm tsx --env-file=.env.local scripts/criar-dona.ts dona@clinica.com.br 'UmaSenhaForte123' "Nome da Dona"
```

O comando imprime o identificador da colaboradora criada. Em seguida, entre no sistema pelo endereço publicado. Depois do primeiro acesso, troque a senha com "Esqueci minha senha" se quiser, e apague o `.env.local` ou guarde-o com segurança.

## 6. Convidar a equipe

Entre como dona, abra **Equipe**, cadastre a pessoa com o perfil correto (recepção ou profissional) e envie o convite. Ela recebe um e-mail, clica no botão, escolhe a senha (mínimo de 8 caracteres) e já entra. Se esquecer a senha, usa **Esqueci minha senha** na tela de login. Para desligar alguém, desative-a em **Equipe**: ela perde o acesso na hora.

## 7. Instalar como aplicativo (PWA)

- **Android (Chrome)**: abra o endereço, menu ⋮ → **Instalar aplicativo** (ou **Adicionar à tela inicial**).
- **iPhone/iPad (Safari)**: botão de compartilhar → **Adicionar à Tela de Início**.
- **Computador (Chrome/Edge)**: ícone de instalar na barra de endereço.

O aplicativo abre direto na tela **Início** e usa o ícone com o monograma "mf". Os ícones são gerados por `pnpm tsx scripts/gerar-icones.ts` a partir de `public/brand/logo-madame-fe.png`.

## 8. Para quem desenvolve

### Variáveis de ambiente

Veja `.env.example`. `DATABASE_URL_TEST` serve só aos testes de banco locais. `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` (Cloudflare Turnstile da página `/agendar`) devem ser definidas juntas ou nenhuma.

### Tipos do banco

`src/lib/supabase/tipos.ts` foi escrito à mão no formato do Supabase. Assim que o projeto estiver ligado (`pnpm supabase link`), regenere:

```bash
pnpm supabase gen types typescript --linked > src/lib/supabase/tipos.ts
pnpm typecheck
```

### Rodar os testes

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm e2e && pnpm build
```

- `pnpm test:db` usa um Postgres 16 local (`DATABASE_URL_TEST`), não o Supabase. Se estiver parado: `pg_ctlcluster 16 main start`.
- `pnpm e2e` sem variáveis roda só `e2e/visual.spec.ts` (login e esqueci-senha nos 3 tamanhos, manifest do PWA); os demais são pulados com mensagem.

### E2E contra o projeto Supabase de testes

Os specs `agenda`, `caixa`, `permissoes`, `ficha`, `cobranca`, `agendar`, `financeiro`, `comissoes-estoque`, `whatsapp`, `crm`, `inicio-painel` e `robo` (e a preparação `auth.setup.ts`) rodam contra o projeto `madame-fe-testes` com as migrations e o `seed.sql` aplicados. **Nunca aponte para a produção.** A preparação (`auth.setup.ts`) redefine a senha dos usuários `e2e-*` para um valor conhecido e cria usuários, uma cliente e um agendamento de teste; o spec `caixa` ainda apaga pagamentos, contas a receber e o caixa de hoje, e o spec `agenda` cancela os agendamentos da profissional de teste no dia escolhido. Por isso há uma trava: nada disso roda sem `E2E_PERMITIR_PROJETO=<ref do projeto>` (o trecho `<ref>` de `https://<ref>.supabase.co`, ou `local` para um stack local em 127.0.0.1/localhost) igual ao projeto da `NEXT_PUBLIC_SUPABASE_URL`. Se faltar ou não conferir, os specs são pulados com a explicação.

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
export E2E_PERMITIR_PROJETO=<ref>   # obrigatório: o ref do projeto de TESTES, o mesmo da URL acima
# opcionais (padrões e2e-*@madamefe.test / E2e-Senha-123!):
# E2E_DONA_EMAIL, E2E_RECEPCAO_EMAIL, E2E_PROFISSIONAL_EMAIL, E2E_PROFISSIONAL2_EMAIL e as respectivas *_SENHA
pnpm e2e
```

O `auth.setup.ts` cria dona, recepção e duas profissionais pelo cliente admin e salva a sessão de cada perfil em `e2e/.auth/` (ignorado pelo Git). Os specs `agenda` e `caixa` leem `E2E_RECEPCAO_EMAIL`, `E2E_RECEPCAO_SENHA` e `E2E_PROFISSIONAL_EMAIL`: defina-as com os mesmos valores usados na preparação (ou deixe os padrões nas duas pontas exportando-os). O Playwright constrói e sobe o sistema (`pnpm build && pnpm start`) com essas variáveis; para testar um endereço já publicado, use `E2E_BASE_URL=https://...` **e** `E2E_BASE_URL_PERMITIDA=https://...` (mesmo valor), garantindo que o site e a chave de serviço são do mesmo ambiente de testes.

### Lista de conferência pós-deploy

- [ ] Migrations 0001 a 0017 aplicadas, na ordem, e `shim.sql` **não** aplicado.
- [ ] 0006, 0007 e 0008 aplicadas na produção ANTES do merge em main (o merge publica na Vercel).
- [ ] 0009 aplicada na produção ANTES do merge; job `pedidos_online_limpeza` presente em `cron.job`.
- [ ] `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` definidas juntas na Vercel; `/agendar` abre e um pedido de teste chega ao Início.
- [ ] 0010 aplicada na produção ANTES do merge; 5 tabelas do Financeiro com política (`pg_policies`) e bucket `financeiro` privado de 5 MB.
- [ ] 0011 aplicada na produção ANTES do merge (imediatamente antes); 4 tabelas com política (`comissoes`, `movimentos_estoque`, `colaboradores_comissao`, `servicos_comissao`); soma dos movimentos = `estoque_atual` em todos os produtos; percentuais de comissão preenchidos pela dona antes de a equipe marcar atendimentos.
- [ ] 0012 aplicada na produção ANTES do merge; 4 tabelas com política (`modelos_mensagem`, `fila_mensagens`, `mensagens_recebidas`, `whatsapp_status`); `cron.job` com `whatsapp_relogio` e `whatsapp_aniversarios`; `pg_net` instalada; `whatsapp_relogio.url` gravada; 4 variáveis `ZAPI_*` na Vercel; webhook "Ao receber" configurado na Z-API; dona revisou os modelos antes de ligar `Envio automático ativo`.
- [ ] 0014, 0015, 0016 e 0017 aplicadas na produção ANTES do merge, nesta ordem; políticas (`pg_policies`) em `leads`, `robo_config`, `robo_opcoes` e `robo_sessoes`; `cron.job` com `crm_retornos`; tipos `retorno`, `reativacao` e `robo` em `tipo_mensagem`; robô desligado; dona preencheu os dias para retorno, revisou os modelos Retorno e Reativação e configurou o robô antes de ligá-lo.
- [ ] Bucket `ficha-clinica` existe e é **privado** (Storage > Buckets: sem o rótulo "Public").
- [ ] Cadastro público desligado; Redirect URL `<site>/auth/confirmar` e modelos Invite/Reset password ajustados.
- [ ] `NEXT_PUBLIC_SITE_URL` definido na Vercel; inatividade de sessão em 12 h (se o plano permitir).
- [ ] Dona criada com `criar-dona.ts`; convite de teste chega e leva a `/definir-senha`.
- [ ] `/manifest.webmanifest` abre e o app instala no celular.
