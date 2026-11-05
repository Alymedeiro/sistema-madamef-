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

Copie `.env.example` para `.env.local` e preencha as variáveis do Supabase.

## Testes de banco (`pnpm test:db`)

Precisam de um Postgres 16 acessível. Por padrão usam `postgres://postgres:postgres@127.0.0.1:5432/madame_test`; para outro endereço defina `DATABASE_URL_TEST`. A cada execução o banco `madame_test` é recriado: aplica `supabase/tests/shim.sql` (imita roles e `auth` do Supabase, **só para testes**) e depois as migrations em ordem.

```bash
pg_ctlcluster 16 main start   # se o Postgres local estiver parado
pnpm test:db
```

## Testes de tela (`pnpm e2e`)

- `e2e/visual.spec.ts` não precisa de backend: confere login e esqueci-senha nos 3 tamanhos e o manifest do PWA.
- `e2e/componentes.spec.ts` também roda sem backend (assinatura e conversor de foto, pela página de apoio `/e2e-harness`, ligada só no build do Playwright).
- `agenda`, `caixa`, `permissoes`, `ficha`, `cobranca` e `auth.setup` precisam de um projeto Supabase de teste; sem as variáveis de ambiente eles são pulados com uma mensagem. Veja a seção de e2e em [docs/implantacao.md](docs/implantacao.md).

## Documentação

- [Guia de implantação](docs/implantacao.md): Supabase, Vercel, e-mails de convite e recuperação, primeiro acesso e instalação como aplicativo.
