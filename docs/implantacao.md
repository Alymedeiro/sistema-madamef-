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

As tabelas e as regras de segurança estão em `supabase/migrations/`, em quatro arquivos que **devem ser aplicados nesta ordem**: `0001_base.sql`, `0002_agenda.sql`, `0003_caixa.sql`, `0004_clientes_busca.sql`.

Escolha uma das formas, para cada projeto:

- **Pela linha de comando** (quem desenvolve): `pnpm supabase login`, depois `pnpm supabase link --project-ref <ref-do-projeto>` e `pnpm supabase db push`. O `<ref-do-projeto>` aparece na URL do painel do Supabase.
- **Pelo painel**: em **SQL Editor**, abra cada arquivo (na ordem acima), cole o conteúdo e clique em **Run**.

Depois, para ter serviços de exemplo no projeto de **testes**, rode também `supabase/seed.sql` no SQL Editor. Na produção, cadastre os serviços reais pela tela Serviços.

**Atenção:** nunca aplique `supabase/tests/shim.sql` em um projeto real. Ele existe só para os testes locais de banco e recriaria estruturas que o Supabase já tem.

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

Os specs `agenda`, `caixa` e `permissoes` (e a preparação `auth.setup.ts`) rodam contra o projeto `madame-fe-testes` com as migrations e o `seed.sql` aplicados. **Nunca aponte para a produção**: a preparação apaga o caixa de hoje e cria usuários e clientes de teste.

```bash
export NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
export NEXT_PUBLIC_SUPABASE_ANON_KEY=...
export SUPABASE_SERVICE_ROLE_KEY=...
# opcionais (padrões e2e-*@madamefe.test / E2e-Senha-123!):
# E2E_DONA_EMAIL, E2E_RECEPCAO_EMAIL, E2E_PROFISSIONAL_EMAIL, E2E_PROFISSIONAL2_EMAIL e as respectivas *_SENHA
pnpm e2e
```

O `auth.setup.ts` cria dona, recepção e duas profissionais pelo cliente admin e salva a sessão de cada perfil em `e2e/.auth/` (ignorado pelo Git). Os specs `agenda` e `caixa` leem `E2E_RECEPCAO_EMAIL`, `E2E_RECEPCAO_SENHA` e `E2E_PROFISSIONAL_EMAIL`: defina-as com os mesmos valores usados na preparação (ou deixe os padrões nas duas pontas exportando-os). O Playwright constrói e sobe o sistema (`pnpm build && pnpm start`) com essas variáveis; para testar um endereço já publicado, use `E2E_BASE_URL=https://...`.

### Lista de conferência pós-deploy

- [ ] Migrations 0001 a 0004 aplicadas, na ordem, e `shim.sql` **não** aplicado.
- [ ] Cadastro público desligado; Redirect URL `<site>/auth/confirmar` e modelos Invite/Reset password ajustados.
- [ ] `NEXT_PUBLIC_SITE_URL` definido na Vercel; inatividade de sessão em 12 h (se o plano permitir).
- [ ] Dona criada com `criar-dona.ts`; convite de teste chega e leva a `/definir-senha`.
- [ ] `/manifest.webmanifest` abre e o app instala no celular.
