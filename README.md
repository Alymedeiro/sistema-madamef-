# Madame Fê Clinic

Sistema de gestão da Madame Fê Clinic (Fase 1: base): agenda, clientes, serviços, produtos, caixa do dia, equipe e configurações. Instalável como aplicativo (PWA) no celular e no tablet. Toda a interface é em português do Brasil, com fuso fixo `America/Sao_Paulo` e valores em centavos.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS 4 + componentes no estilo shadcn/ui (Radix)
- Supabase (Postgres, Auth, RLS) via `@supabase/ssr`
- Vitest (unidade e banco) e Playwright (telas)
- Hospedagem prevista: Vercel (plano Pro para uso comercial)

## Comandos

| Comando | O que faz |
| --- | --- |
| `pnpm install` | instala as dependências |
| `pnpm dev` | servidor de desenvolvimento em http://localhost:3000 |
| `pnpm build` / `pnpm start` | build de produção e servidor de produção |
| `pnpm lint` / `pnpm typecheck` | ESLint e TypeScript |
| `pnpm test` | testes de unidade (Vitest) |
| `pnpm test:db` | testes de migrations e RLS contra um Postgres local |
| `pnpm e2e` | testes de tela (Playwright) em 1440, 1024 e 390 px |
| `pnpm tsx scripts/gerar-icones.ts` | regenera os ícones do PWA a partir do logo |
| `pnpm tsx --env-file=.env.local scripts/criar-dona.ts <e-mail> <senha> <nome>` | cria o primeiro usuário (dona) |

Copie `.env.example` para `.env.local` e preencha as variáveis do Supabase. Para a página pública `/agendar`, defina também `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` (Cloudflare Turnstile): as duas juntas ou nenhuma (só a secreta bloqueia todos os pedidos).

## Testes de banco (`pnpm test:db`)

Precisam de um Postgres 16 acessível. Por padrão usam `postgres://postgres:postgres@127.0.0.1:5432/madame_test`; para outro endereço defina `DATABASE_URL_TEST`. A cada execução o banco `madame_test` é recriado: aplica `supabase/tests/shim.sql` (imita roles, `auth` e um `storage` mínimo do Supabase, **só para testes**) e depois as migrations em ordem (`0001` a `0009`).

```bash
pg_ctlcluster 16 main start   # se o Postgres local estiver parado
pnpm test:db
```

## Testes de tela (`pnpm e2e`)

- `e2e/visual.spec.ts` não precisa de backend: confere login e esqueci-senha nos 3 tamanhos e o manifest do PWA.
- `e2e/componentes.spec.ts` também roda sem backend (assinatura e conversor de foto, pela página de apoio `/e2e-harness`, ligada só no build do Playwright).
- `agenda`, `caixa`, `permissoes`, `ficha`, `cobranca`, `agendar` e `auth.setup` precisam de um projeto Supabase de teste (`ficha` e `cobranca`: com as migrations 0006, 0007 e 0008 aplicadas; `agendar`: com a 0009, e acesso a `challenges.cloudflare.com`); sem as variáveis de ambiente eles são pulados com uma mensagem. `cobranca` apaga o caixa de hoje do projeto de testes. Veja a seção de e2e em [docs/implantacao.md](docs/implantacao.md).
- `pnpm e2e` deixa em `.next` um build com a página de apoio `/e2e-harness`: rode `pnpm build` de novo antes de `pnpm start`.

## Documentação

- [Guia de implantação](docs/implantacao.md): Supabase, Vercel, e-mails de convite e recuperação, primeiro acesso e instalação como aplicativo.
