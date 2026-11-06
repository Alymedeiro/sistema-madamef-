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

As tabelas e as regras de segurança estão em `supabase/migrations/`, em oito arquivos que **devem ser aplicados nesta ordem**: `0001_base.sql`, `0002_agenda.sql`, `0003_caixa.sql`, `0004_clientes_busca.sql`, `0005_pagamento_unico.sql`, `0006_ficha_clinica.sql`, `0007_pacotes_cobranca.sql`, `0008_ajustes_fase2.sql`. (Se o projeto já está em uso, veja a seção "Fase 2" abaixo antes de aplicar 0006, 0007 e 0008.)

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

**Estado atual:** 0006 (2026-11-04) e 0007 (2026-11-05) aplicadas no projeto de testes (`myfpjwtmfonuvsrsvato`), com as conferências e os avisos do Supabase verificados (só os avisos esperados de funções chamáveis por usuário logado). A 0008 foi aplicada no projeto de testes em 2026-11-06 (conferências prévias em `0`, `rolbypassrls = t`, avisos só os esperados). A produção ainda não recebeu nenhuma das três.

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

- `cobranca.spec.ts` **apaga** o caixa de hoje do projeto de testes (com cobranças, pagamentos e contas a receber dele) e os agendamentos não cancelados da profissional de teste hoje às 13:00 e em 6 dias às 10:00, para poder rodar de novo no mesmo dia.
- Os E2E com backend deixam linhas permanentes no projeto de testes (clientes, serviços, termos, pacotes, fotos e auditoria "E2E"); nada disso vai para a produção, mas o projeto de testes cresce a cada execução.
- `pnpm e2e` faz o build com `NEXT_PUBLIC_E2E_HARNESS=1` e deixa esse build (com a página `/e2e-harness`) em `.next`. Antes de `pnpm start` para outro uso, rode `pnpm build` de novo.

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

Veja `.env.example`. `DATABASE_URL_TEST` serve só aos testes de banco locais.

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

Os specs `agenda`, `caixa`, `permissoes`, `ficha` e `cobranca` (e a preparação `auth.setup.ts`) rodam contra o projeto `madame-fe-testes` com as migrations e o `seed.sql` aplicados. **Nunca aponte para a produção.** A preparação (`auth.setup.ts`) redefine a senha dos usuários `e2e-*` para um valor conhecido e cria usuários, uma cliente e um agendamento de teste; o spec `caixa` ainda apaga pagamentos, contas a receber e o caixa de hoje, e o spec `agenda` apaga os agendamentos da profissional de teste no dia escolhido. Por isso há uma trava: nada disso roda sem `E2E_PERMITIR_PROJETO=<ref do projeto>` (o trecho `<ref>` de `https://<ref>.supabase.co`, ou `local` para um stack local em 127.0.0.1/localhost) igual ao projeto da `NEXT_PUBLIC_SUPABASE_URL`. Se faltar ou não conferir, os specs são pulados com a explicação.

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

- [ ] Migrations 0001 a 0008 aplicadas, na ordem, e `shim.sql` **não** aplicado.
- [ ] 0006, 0007 e 0008 aplicadas na produção ANTES do merge em main (o merge publica na Vercel).
- [ ] Bucket `ficha-clinica` existe e é **privado** (Storage > Buckets: sem o rótulo "Public").
- [ ] Cadastro público desligado; Redirect URL `<site>/auth/confirmar` e modelos Invite/Reset password ajustados.
- [ ] `NEXT_PUBLIC_SITE_URL` definido na Vercel; inatividade de sessão em 12 h (se o plano permitir).
- [ ] Dona criada com `criar-dona.ts`; convite de teste chega e leva a `/definir-senha`.
- [ ] `/manifest.webmanifest` abre e o app instala no celular.
