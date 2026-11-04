# Fase 2 — Ficha clínica, pacotes e pagamento dividido: Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a Fase 2 do Madame Fê Clinic — anamnese e termos assinados no tablet (com PDF e hash), fotos antes/depois com comparação, evoluções, pacotes de sessões, pagamento dividido em até 4 formas, registro de acesso aos dados de saúde e exportação dos dados da cliente.

**Architecture:** Mesmo desenho da Fase 1: Server Components leem, Server Actions escrevem, e toda permissão mora no Postgres (RLS + funções `security definer`). Uma função única `acesso_clinico(cliente, área)` decide quem vê cada parte da ficha e é reutilizada pelas políticas das tabelas, do Storage e por `registrar_acesso`. Arquivos clínicos ficam no bucket privado `ficha-clinica`; assinaturas e PDFs são gravados só pelo servidor (cliente admin), fotos são enviadas direto do navegador com o JWT da usuária (o RLS do Storage decide), e toda leitura passa por URL assinada de 5 min gerada no servidor depois de `registrar_acesso`.

**Tech Stack:** o da Fase 1 (Next.js 15.5, React 19, TypeScript strict, Tailwind 4, componentes shadcn escritos à mão, `@supabase/ssr` + `@supabase/supabase-js`, zod 4, `@date-fns/tz`, Vitest 5, Playwright, `pg` para testes de banco) + `pdf-lib@1.17.1` (PDF no servidor), `signature_pad@5.1.4` (assinatura no canvas), `fflate@0.8.3` (ZIP da exportação), `heic2any@0.0.4` (só como recurso de conversão de HEIC, carregado sob demanda).

**Spec:** `docs/superpowers/specs/2026-11-04-fase-2-ficha-clinica-design.md` (autoridade), com `docs/superpowers/specs/2026-11-02-sistema-madame-fe-design.md` §3, §5.3, §5.4, §6.3, §6.8, §7.

## Global Constraints

- Tudo da seção Global Constraints do plano da Fase 1 continua valendo (pt-BR, fuso `America/Sao_Paulo`, centavos inteiros, perfis `dona | recepcao | profissional`, RLS em toda tabela, colaborador inativo não acessa nada, toque ≥ 44 px, viewports 1440/1024/390).
- **Sem Supabase local no container.** Testes de banco = Vitest + `pg` contra Postgres 16 em `127.0.0.1:5432` (`DATABASE_URL_TEST`, banco `madame_test`), via `supabase/tests/helpers.ts` e `supabase/tests/shim.sql`. Se o Postgres estiver parado: `pg_ctlcluster 16 main start`. Comando: `pnpm test:db`.
- **O shim é só de teste.** `shim.sql` ganha um modelo mínimo de `storage.buckets` / `storage.objects` (com RLS ligado no shim) para testar as políticas do bucket. Nada disso vai para `supabase/migrations/`. As migrações **não** fazem `alter table storage.objects enable row level security` (no Supabase real a tabela é de `supabase_storage_admin` e o RLS já está ligado); só `insert into storage.buckets ... on conflict do nothing` e `create policy ... on storage.objects`.
- `src/lib/supabase/tipos.ts` é escrito à mão no formato do `supabase gen types` e atualizado **na mesma tarefa** de cada migração (cabeçalho passa a citar 0001–0007).
- Migrações novas: `supabase/migrations/0006_ficha_clinica.sql` e `0007_pacotes_cobranca.sql`. Toda função nova: `set search_path = ''`, nomes qualificados com `public.`/`extensions.`/`storage.`, `revoke execute ... from public, anon` e `grant execute ... to authenticated` só para as que a API chama.
- **Nenhum dado clínico é apagado:** sem política nem privilégio de `delete` para `anon`/`authenticated` em `anamneses`, `termos_assinados`, `fotos`, `evolucoes`, `auditoria`, `modelos_*`, `pacotes_vendidos`, `cobrancas` e em `storage.objects` do bucket. Correção = nova versão ou arquivamento.
- Bucket privado **`ficha-clinica`** (`public = false`, `file_size_limit = 5242880`, `allowed_mime_types = {image/jpeg,image/png,application/pdf}`); caminhos exatamente `clientes/<cliente_id>/{anamneses|termos|fotos}/<uuid>.<png|pdf|jpg>`.
- URL assinada: **300 s** (`URL_ASSINADA_SEGUNDOS`), gerada no servidor com o cliente da usuária (RLS do Storage aplicado), **depois** de `registrar_acesso` ter dado certo. Falha ao registrar = dado não entregue.
- Toda leitura de anamnese, termos, fotos ou evoluções registra o acesso no servidor antes de devolver os dados.
- Fotos nunca passam por Server Action (limite de corpo da Vercel: 4,5 MB): o navegador converte para JPEG (máx. **2560 px** no maior lado e **5 MB**) e envia direto ao Storage com o JWT da usuária. Assinaturas (PNG ≤ **200 KB**) vão por Server Action como data URL; o servidor grava PNG e PDF com `createAdminClient()`.
- Pagamento dividido: **1 a 4 partes**, cada parte > 0, soma das partes = bruto − desconto. Formas e regras de parcelas da Fase 1 (`MAX_PARCELAS = 12`; só `credito_parcelado` e `a_receber` com 2–12 parcelas).
- Pacotes: `total_sessoes` 1–50; validade opcional (vale até o fim do dia da validade, em São Paulo); falta não consome sessão.
- Libs novas só do npm (registro shadcn e releases do GitHub estão bloqueados): `pnpm add pdf-lib@1.17.1 signature_pad@5.1.4 fflate@0.8.3 heic2any@0.0.4`. Componentes de UI novos são escritos à mão em `src/components/ui/` no padrão dos existentes.
- E2E que escrevem no backend só rodam com `E2E_PERMITIR_PROJETO` igual ao ref da `NEXT_PUBLIC_SUPABASE_URL` (`e2e/guarda.ts`); sem isso são pulados. Eles rodam contra o projeto de **testes** `myfpjwtmfonuvsrsvato`. Produção é `vxvrzhskytsbreexnbun`. Os dois já têm 0001–0005 aplicadas. **Este plano aplica 0006/0007 só no projeto de testes**; produção fica como passo manual documentado.

## Review Focus

1. **Duplo toque em "Confirmar" (ou duas recepcionistas cobrando o mesmo atendimento)**: a segunda cobrança deve falhar com "Este atendimento já foi pago." (unicidade em `cobrancas`, não só a checagem da tela) → testes em Task 2 (`23505` com `cobrancas_agendamento_unico`) e Task 8 (`mensagemErroBanco`).
2. **Última sessão do pacote marcada "Atendido" em dois atendimentos ao mesmo tempo, ou pacote vencido/esgotado**: só um consome; o outro recebe "Todas as sessões do pacote já foram usadas." / "Este pacote venceu em dd/mm/aaaa." → teste com duas conexões em Task 2.
3. **Caminho de arquivo adulterado** (`clientes/<outra cliente>/fotos/...`, `clientes/../x`, id que não é uuid, pasta `termos/` enviada pelo navegador): deve ser negado com `42501`, nunca estourar com `22P02` nem gravar → testes de Storage em Task 1 e `caminhoPertence` em Task 3.
4. **Foto grande ou em formato inesperado** (6000×4000 px, HEIC do iPhone, PDF escolhido por engano): vira JPEG ≤ 2560 px e ≤ 5 MB, ou é recusada com "Escolha uma foto (JPEG, PNG ou HEIC)." → testes em Task 6.
5. **Centavos no pagamento dividido** (R$ 100,00 em 3 formas; parte "a receber" de R$ 30,00 em 3x): "Falta R$ 0,01" até fechar exato, parcelas somam a parte → testes em Task 8.

---

## Estrutura de arquivos

```
supabase/
  migrations/0006_ficha_clinica.sql, 0007_pacotes_cobranca.sql
  tests/shim.sql (+ storage mínimo), tests/helpers.ts (+ resetarBanco({ ate }), aplicarMigracoes, abrirConexao, inserirPagamentoDireto, criarPacote)
  tests/06_ficha_clinica.db.test.ts, tests/07_pacotes_cobranca.db.test.ts
  tests/02_agenda, 03_caixa, 05_ajustes .db.test.ts (fixtures ajustados à 0007)
src/
  lib/dominio/{anamnese,termos,fotos,evolucoes,cobranca,pacotes}.ts (+ .test.ts)
  lib/dominio/permissoes.ts (+ abas e ações da ficha)
  lib/ficha/{assinatura,caminhos,acesso,pdf-termo}.ts (+ .test.ts)
  app/(tablet)/layout.tsx, app/(tablet)/tablet/{anamnese,termo}/[clienteId]/page.tsx
  app/(app)/clientes/[id]/page.tsx (abas por ?aba=), app/(app)/clientes/[id]/exportar/route.ts
  app/(app)/clientes/ficha/{dados.ts, anamnese.ts, termos.ts, fotos.ts, evolucoes.ts, pacotes.ts, schemas.ts, exportacao.ts} (+ .test.ts)
  app/(app)/configuracoes/{anamnese,termos,acessos}/page.tsx (+ actions.ts nas duas primeiras)
  features/ficha/{abas-ficha,campo-assinatura,moldura-tablet}.tsx
  features/ficha/{anamnese,termos,fotos,evolucoes,pacotes}/*.tsx
  features/fotos/converter.ts
  features/caixa/{editor-partes.tsx, dialogo-pagamento.tsx, painel-caixa.tsx}
  test/supabase-falso.ts (+ storage)
e2e/{ficha.spec.ts, cobranca.spec.ts, fixtures/foto-{1,2}.jpg}
docs/implantacao.md
```

**Ordem das tarefas:** a do spec §9, com (8) e (9) trocados — o pagamento dividido (Task 8) vem antes dos pacotes (Task 9) porque a venda do pacote reutiliza o editor de partes e o domínio de cobrança. Nos blocos de teste, nomes como `q`, `cobrar`, `insertAnamnese`, `marcar` são atalhos locais do próprio arquivo de teste sobre `comoUsuario`/`comoSuperusuario`.

---

### Task 1: Banco — ficha clínica, auditoria e armazenamento (0006)

**Files:**
- Create: `supabase/migrations/0006_ficha_clinica.sql`, `supabase/tests/06_ficha_clinica.db.test.ts`
- Modify: `supabase/tests/shim.sql`, `src/lib/supabase/tipos.ts`

**Interfaces:**
- Consumes: `perfil_atual()`, `colaborador_atual_id()`, `cliente_vinculada(uuid)`, `set_atualizado_em()` (0001/0002); `normalizar_busca` (0004).
- Produces (SQL):
  - Enums `tipo_foto` (`antes` | `depois` | `evolucao`), `acao_auditoria` (`visualizou` | `criou` | `alterou` | `arquivou`).
  - Tabelas (todas com `id`, `criado_em`, `atualizado_em` + trigger):
    - `modelos_anamnese (titulo text, versao int ≥ 1 unique, perguntas jsonb check array não vazio, ativo bool, criado_por uuid → colaboradores default colaborador_atual_id())`; índice único parcial `modelos_anamnese_um_ativo on ((true)) where ativo`.
    - `anamneses (cliente_id, modelo_id → modelos_anamnese, modelo_versao int, respostas jsonb check object, assinatura_path text, preenchida_por default colaborador_atual_id(), preenchida_em timestamptz default now())`.
    - `modelos_termo (grupo_id uuid default gen_random_uuid(), titulo, texto, versao int, ativo, criado_por)`; `unique (grupo_id, versao)`; único parcial `(grupo_id) where ativo`. FK nova `servicos_modelo_termo_id_fkey` em `servicos.modelo_termo_id`.
    - `termos_assinados (cliente_id, modelo_termo_id → modelos_termo, modelo_versao, agendamento_id null → agendamentos, assinatura_path, pdf_path, hash_sha256 text check '^[0-9a-f]{64}$', assinado_em default now(), colhido_por default colaborador_atual_id(), dispositivo text ≤ 200)`.
    - `fotos (cliente_id, agendamento_id null, servico_id null, tipo tipo_foto, path text unique, tirada_em timestamptz default now(), enviada_por default colaborador_atual_id(), arquivada bool default false)`.
    - `evolucoes (cliente_id, agendamento_id not null, profissional_id default colaborador_atual_id(), texto text check 1–5000 chars)`.
    - `auditoria (colaborador_id null → colaboradores, acao acao_auditoria, entidade text, entidade_id uuid null, cliente_id null → clientes, ocorrido_em default now())`.
    - Cada coluna de caminho tem `check` amarrando-a à própria cliente, ex.: `check (assinatura_path ~ ('^clientes/' || cliente_id || '/anamneses/[0-9a-f-]{36}\.png$'))`; termos: `.png` e `.pdf` em `/termos/`; fotos: `.jpg` em `/fotos/`.
    - Índice para toda FK nova; `anamneses (cliente_id, preenchida_em desc)`, `auditoria (ocorrido_em desc)`, `auditoria (cliente_id, ocorrido_em desc)`.
  - `acesso_clinico(p_cliente uuid, p_area text) returns boolean` — `security definer stable`. Áreas `anamneses`, `termos`, `evolucoes`, `pacotes`: dona/recepção sempre; profissional se `cliente_vinculada`. Área `fotos`: dona sempre; profissional se vinculada; recepção nunca. Outra área ou cliente nulo: `false`.
  - `cliente_do_caminho(p_nome text) returns uuid` e `area_do_caminho(p_nome text) returns text` — `immutable`; casam `^clientes/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/(anamneses|termos|fotos)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|pdf)$` e devolvem `null` quando não casa (nunca fazem cast de texto inválido).
  - `registrar_acesso(p_entidade text, p_entidade_id uuid, p_cliente uuid) returns void` — `security definer`; `p_entidade ∈ ('anamneses','termos_assinados','fotos','evolucoes','exportacao')` senão `'Entidade inválida'`; exige `acesso_clinico(p_cliente, área)` (`termos_assinados → termos`; `exportacao` só dona) senão `raise 'Acesso não autorizado' (P0001)`; grava `acao = 'visualizou'`.
  - Trigger `auditar_ficha()` (`security definer`, after insert/update em `anamneses`, `termos_assinados`, `fotos`, `evolucoes`): insert → `criou`; update de `fotos.arquivada` para true → `arquivou`; outro update → `alterou`. `entidade = TG_TABLE_NAME`.
  - Guardas (before update): `fotos_guarda()` — só `arquivada` muda e só de false para true, senão `'Fotos só podem ser arquivadas'`; `evolucoes_guarda()` — só `texto` muda, só a autora (`old.profissional_id = colaborador_atual_id()`) e só até `old.criado_em + interval '24 hours'`, senão `'A evolução só pode ser editada pela autora em até 24 horas'`.
  - `salvar_modelo_anamnese(p_titulo text, p_perguntas jsonb) returns uuid` — só dona (`'Apenas a dona pode editar modelos'`); `jsonb_array_length ≥ 1` e cada item com `id`, `tipo`, `texto` (`'O modelo precisa de ao menos uma pergunta'` / `'Pergunta inválida no modelo'`); trava o ativo `for update`, desativa-o e insere `versao = max + 1`.
  - `salvar_modelo_termo(p_anterior uuid, p_titulo text, p_texto text) returns uuid` — só dona; `p_anterior` nulo cria grupo novo v1; senão exige o anterior ativo, cria `versao + 1` no mesmo `grupo_id`, desativa o anterior e faz `update servicos set modelo_termo_id = <novo> where modelo_termo_id = p_anterior`.
  - `situacao_ficha(p_clientes uuid[]) returns table (cliente_id uuid, ultima_anamnese_em timestamptz, tem_alerta boolean)` — `security invoker`; `tem_alerta` = na última anamnese, alguma pergunta do modelo daquela versão com `alerta = true` respondida sim (`sim_nao`: valor `true`; `sim_nao_detalhe`: `{ "sim": true, ... }`).
  - `agendamentos_com_termo_pendente(p_ids uuid[]) returns setof uuid` — `security invoker`; agendamento cujo serviço tem `modelo_termo_id` e não existe `termos_assinados` da cliente com esse mesmo `modelo_termo_id` (versão atual).
  - `atendimentos_sem_termo(p_de date, p_ate date) returns setof uuid` — `security definer`; só dona (demais: vazio); período ≤ 62 dias senão `'Período inválido'`; atendidos no período (dias de São Paulo) com termo pendente.
  - RLS: `modelos_*` select para todo perfil ativo, escrita só pelas funções (revogar insert/update/delete). `anamneses` select `acesso_clinico(cliente_id,'anamneses')`, insert `perfil_atual() in ('dona','recepcao') and preenchida_por = colaborador_atual_id()`. `termos_assinados` select/insert `acesso_clinico(cliente_id,'termos')` (+ `colhido_por = colaborador_atual_id()` no insert). `fotos` select `acesso_clinico(cliente_id,'fotos') and (not arquivada or perfil_atual() = 'dona')`, insert `acesso_clinico(...) and enviada_por = colaborador_atual_id()`, update só dona. `evolucoes` select `acesso_clinico(cliente_id,'evolucoes')`; insert `perfil_atual() = 'profissional' and profissional_id = colaborador_atual_id()` e o agendamento é dela e da mesma cliente; update `profissional_id = colaborador_atual_id()`. `auditoria` select só dona; sem escrita direta.
  - Storage: bucket `ficha-clinica` (Global Constraints); políticas `ficha_clinica_select` (`bucket_id = 'ficha-clinica' and acesso_clinico(cliente_do_caminho(name), area_do_caminho(name))`) e `ficha_clinica_insert` (bucket e `area_do_caminho(name) = 'fotos'` e `acesso_clinico(..., 'fotos')`). Sem update/delete.
  - Dados iniciais na própria migração: `modelos_anamnese` v1 "Anamnese de estética" com as perguntas `queixa` (texto, obrigatória) "Qual é a sua principal queixa ou objetivo?", `alergias` (sim_nao_detalhe, obrigatória, alerta) "Tem alguma alergia (medicamentos, cosméticos, alimentos)?", `gestante` (sim_nao, obrigatória, alerta) "Está grávida ou amamentando?", `medicamentos` (sim_nao_detalhe, obrigatória) "Usa algum medicamento contínuo?", `anticoagulante` (sim_nao, obrigatória, alerta) "Usa anticoagulante?", `condicoes` (multipla; Diabetes, Hipertensão, Problemas cardíacos, Problemas de tireoide, Epilepsia, Doença autoimune, Nenhuma) "Tem ou já teve alguma destas condições?", `marcapasso` (sim_nao, alerta) "Usa marcapasso ou tem implante metálico?", `queloide` (sim_nao, alerta) "Tem tendência a queloide ou cicatrização difícil?", `herpes` (sim_nao, alerta) "Tem histórico de herpes?", `isotretinoina` (sim_nao, alerta) "Usou isotretinoína (Roacutan) nos últimos 6 meses?", `procedimentos` (sim_nao_detalhe) "Fez algum procedimento estético nos últimos 6 meses?", `sol` (sim_nao) "Tem exposição frequente ao sol?", `rotina` (texto) "Quais produtos usa na pele diariamente?"; `modelos_termo` v1 "Termo de consentimento — modelo genérico" (seções `# Procedimento`, `# Riscos e cuidados`, `# Declaração`, texto de exemplo para a clínica adaptar).
  - Ajustes herdados (spec §7): `alter function public.normalizar_busca(text) set search_path = ''`; índices `agendamentos (criado_por)`, `agendamentos (servico_id)`, `caixas (aberto_por)`, `caixas (fechado_por)`, `pagamentos (lancado_por)`.
- Produces (shim, só teste): `storage.buckets (id text pk, name text, public bool, file_size_limit bigint, allowed_mime_types text[], created_at)`, `storage.objects (id uuid default gen_random_uuid(), bucket_id text → buckets, name text, owner uuid, metadata jsonb, created_at, unique (bucket_id, name))`, `alter table storage.objects enable row level security`, `grant usage on schema storage` e `grant select, insert, update, delete on storage.objects` a `authenticated`/`anon`/`service_role` (como no Supabase).

- [ ] **Step 1: Estender `shim.sql`** com o storage mínimo acima, num bloco comentado "SOMENTE PARA TESTES — no Supabase real o schema storage já existe". Run `pnpm test:db` — Expected: 5 arquivos atuais PASS (shim não quebra nada).
- [ ] **Step 2: Testes que falham** em `06_ficha_clinica.db.test.ts` (fixtures: dona, recepção, profissional A vinculada a `cli` por um agendamento, profissional B sem vínculo, `cli2` sem vínculo; caminhos com `randomUUID()`):

```ts
const foto = (cliente: string) => `clientes/${cliente}/fotos/${randomUUID()}.jpg`
const SQL_OBJ = "insert into storage.objects (bucket_id, name) values ('ficha-clinica', $1)"
// bucket
expect((await q("select public, file_size_limit from storage.buckets where id = 'ficha-clinica'")).rows)
  .toEqual([{ public: false, file_size_limit: '5242880' }])
// upload de foto (Review Focus 3)
await comoUsuario(profA, c => c.query(SQL_OBJ, [foto(cli)]))                                  // ok
await comoUsuario(profA, c => esperarErroSql(c.query(SQL_OBJ, [foto(cli2)]), '42501'))        // sem vínculo
await comoUsuario(recepcao, c => esperarErroSql(c.query(SQL_OBJ, [foto(cli)]), '42501'))      // recepção não envia foto
await comoUsuario(profA, c => esperarErroSql(c.query(SQL_OBJ, [`clientes/${cli}/termos/${randomUUID()}.pdf`]), '42501')) // termo só pelo servidor
await comoUsuario(profA, c => esperarErroSql(c.query(SQL_OBJ, ['clientes/nao-e-uuid/fotos/x.jpg']), '42501'))
await comoUsuario(profA, c => esperarErroSql(c.query(SQL_OBJ, [`clientes/${cli}/fotos/../../${cli2}/fotos/${randomUUID()}.jpg`]), '42501'))
// leitura (superusuário criou 1 foto, 1 termo e 1 anamnese de `cli`)
expect(await comoUsuario(dona, c => contar(c, 'storage.objects'))).toBe(3)
expect(await comoUsuario(recepcao, c => contar(c, 'storage.objects'))).toBe(2)   // sem fotos
expect(await comoUsuario(profA, c => contar(c, 'storage.objects'))).toBe(3)
expect(await comoUsuario(profB, c => contar(c, 'storage.objects'))).toBe(0)
expect(await comoUsuario(null, c => contar(c, 'storage.objects'))).toBe(0)
expect((await comoUsuario(dona, c => c.query('delete from storage.objects'))).rowCount).toBe(0)
// tabelas clínicas
expect(await comoUsuario(recepcao, c => contar(c, 'fotos'))).toBe(0)
expect(await comoUsuario(profB, c => contar(c, 'anamneses'))).toBe(0)
await comoUsuario(profA, c => esperarErroSql(c.query(insertAnamnese(cli)), '42501'))           // profissional não aplica anamnese
await comoUsuario(recepcao, c => esperarErroSql(c.query(insertAnamnese(cli, { pathDe: cli2 })), '23514')) // caminho de outra cliente
expect((await comoUsuario(dona, c => c.query('delete from anamneses'))).rowCount).toBe(0)
// evoluções
await comoUsuario(profA, c => c.query(insertEvolucao(agDeA)))                                  // ok
await comoUsuario(profA, c => esperarErroSql(c.query(insertEvolucao(agDeB)), '42501'))
await comoUsuario(recepcao, c => esperarErroSql(c.query(insertEvolucao(agDeA)), '42501'))
// com criado_em = now() - 25h (superusuário):
expect((await comoUsuario(profA, c => esperarErroSql(c.query(updateTexto(ev)), 'P0001'))).message)
  .toBe('A evolução só pode ser editada pela autora em até 24 horas')
// fotos
expect((await comoUsuario(profA, c => c.query('update fotos set arquivada = true'))).rowCount).toBe(0)
expect((await comoUsuario(dona, c => esperarErroSql(c.query(`update fotos set path = $1`, [foto(cli)]), 'P0001'))).message)
  .toBe('Fotos só podem ser arquivadas')
// auditoria
// recepção insere anamnese → 1 linha { acao: 'criou', entidade: 'anamneses', colaborador_id: recepcaoId, cliente_id: cli }
// dona arquiva foto → linha { acao: 'arquivou', entidade: 'fotos' }
expect((await comoUsuario(profB, c => esperarErroSql(c.query("select registrar_acesso('anamneses', null, $1)", [cli]), 'P0001'))).message).toBe('Acesso não autorizado')
expect((await comoUsuario(recepcao, c => esperarErroSql(c.query("select registrar_acesso('fotos', null, $1)", [cli]), 'P0001'))).message).toBe('Acesso não autorizado')
expect((await comoUsuario(recepcao, c => esperarErroSql(c.query("select registrar_acesso('exportacao', null, $1)", [cli]), 'P0001'))).message).toBe('Acesso não autorizado')
expect(await comoUsuario(recepcao, c => contar(c, 'auditoria'))).toBe(0)
await comoUsuario(dona, c => esperarErroSql(c.query(insertAuditoria()), '42501'))
// modelos e versões
// dona: salvar_modelo_anamnese 2× → versões [1, 2, 3], `select count(*) from modelos_anamnese where ativo` = 1, ativo é a v3
expect((await comoUsuario(recepcao, c => esperarErroSql(c.query("select salvar_modelo_anamnese('X', '[{\"id\":\"a\",\"tipo\":\"texto\",\"texto\":\"A\"}]')"), 'P0001'))).message).toBe('Apenas a dona pode editar modelos')
expect((await comoUsuario(dona, c => esperarErroSql(c.query("select salvar_modelo_anamnese('X', '[]')"), 'P0001'))).message).toBe('O modelo precisa de ao menos uma pergunta')
// salvar_modelo_termo(v1) → serviço que apontava para v1 passa a apontar para v2; v1 inativo
// pendência de termo: agendamento de serviço com termo → em agendamentos_com_termo_pendente;
//   após termos_assinados na versão atual → fora; após salvar_modelo_termo (v2) → dentro de novo
// situacao_ficha([cli]) com 'gestante' = true → { tem_alerta: true }; com tudo false → false
// atendimentos_sem_termo: dona recebe o atendido sem termo; recepção recebe []
// ajustes
expect(proconfig('normalizar_busca')).toEqual(['search_path=""'])
for (const [t, col] of [['agendamentos','criado_por'],['agendamentos','servico_id'],['caixas','aberto_por'],['caixas','fechado_por'],['pagamentos','lancado_por']])
  expect(await existeIndiceSobre(t, col)).toBe(true)
// funções novas: security definer onde especificado, proconfig search_path="", sem execute para anon
```

- [ ] **Step 3:** Run `pnpm test:db` — Expected: FAIL em `06_ficha_clinica` (tabelas inexistentes); 01–05 PASS.
- [ ] **Step 4:** Escrever `0006_ficha_clinica.sql` conforme Interfaces, no estilo das migrações anteriores (cabeçalho com objetivo e dependências; políticas `to authenticated` com `(select public.perfil_atual())`).
- [ ] **Step 5:** Run `pnpm test:db` — Expected: 6 arquivos PASS.
- [ ] **Step 6:** Atualizar `tipos.ts` (novas tabelas, enums, funções com `Args`/`Returns`, `servicos` com relacionamento `servicos_modelo_termo_id_fkey`). Run `pnpm typecheck` — Expected: sem erros.
- [ ] **Step 7:** Commit: `feat(db): ficha clínica, auditoria e bucket privado (0006)`

---

### Task 2: Banco — pacotes e cobranças (0007)

**Files:**
- Create: `supabase/migrations/0007_pacotes_cobranca.sql`, `supabase/tests/07_pacotes_cobranca.db.test.ts`
- Modify: `supabase/tests/helpers.ts`, `supabase/tests/02_agenda.db.test.ts`, `supabase/tests/03_caixa.db.test.ts`, `supabase/tests/05_ajustes.db.test.ts`, `src/lib/supabase/tipos.ts`

**Interfaces:**
- Consumes: 0003/0005 (`caixas`, `pagamentos`, `contas_receber`, `registrar_pagamento`, `agendamentos_sem_pagamento*`, `caixa_aberto_hoje_id()`), `acesso_clinico` (Task 1).
- Produces (helpers de teste):
  - `resetarBanco(opcoes?: { ate?: string })` — aplica só migrações com nome `<= ate` (ex.: `'0006'`); `aplicarMigracoes(desde: string): Promise<void>` aplica as de nome `>= desde`; `abrirConexao(uid: string | null): Promise<PoolClient>` (conexão própria, já com papel/claims, sem transação, para testes de concorrência; quem chama faz `release`).
  - `inserirPagamentoDireto(c, p: { caixaId; clienteId; origem; agendamentoId?; forma; valor; desconto?; lancadoPor }): Promise<string>` — superusuário: cria a cobrança e o pagamento ligado a ela.
  - `criarPacote(c, p: { clienteId; servicoId; total?: number; validade?: string | null; status?: string }): Promise<string>` — superusuário.
- Produces (SQL):
  - Enum `status_pacote` (`ativo` | `concluido` | `expirado` | `cancelado`).
  - `pacotes_vendidos (cliente_id, servico_id, total_sessoes int check 1–50, sessoes_usadas int default 0 check between 0 and total_sessoes, valor_total_centavos int > 0, validade date null, status default 'ativo', vendido_por default colaborador_atual_id(), vendido_em default now(), cancelado_por null, cancelado_em null)`; FK `agendamentos_pacote_vendido_id_fkey`; índices nas FKs.
  - `cobrancas (origem origem_pagamento, agendamento_id null → agendamentos, pacote_vendido_id null → pacotes_vendidos, cliente_id, valor_bruto_centavos int > 0, desconto_centavos int ≥ 0 e ≤ bruto, caixa_id → caixas, lancada_por → colaboradores, lancada_em default now())`; `constraint cobrancas_agendamento_unico unique (agendamento_id)`, `constraint cobrancas_pacote_unico unique (pacote_vendido_id)`; `check ((origem = 'agendamento') = (agendamento_id is not null))`, `check ((origem = 'pacote') = (pacote_vendido_id is not null))`; índices `caixa_id`, `cliente_id`, `lancada_por`.
  - `pagamentos.cobranca_id uuid not null → cobrancas` (índice). Migração dos dados antigos: `insert into cobrancas (id, ...) select p.id, p.origem, p.agendamento_id, null, p.cliente_id, p.valor_centavos, p.desconto_centavos, p.caixa_id, p.lancado_por, p.criado_em from pagamentos p`, depois `update pagamentos set cobranca_id = id`, depois `set not null`. `drop index pagamentos_agendamento_unico`; `create index pagamentos_agendamento_idx on pagamentos (agendamento_id) where agendamento_id is not null`.
  - Cada parte de cobrança nova = uma linha de `pagamentos` com `origem`/`agendamento_id` da cobrança, `valor_centavos` = valor da parte e `desconto_centavos = 0` (o desconto fica na cobrança), de modo que `fechar_caixa` (soma `valor − desconto` por forma) não muda.
  - Triggers em `agendamentos` (os nomes garantem a ordem depois de `agendamentos_guarda_profissional`):
    - `agendamentos_pacote_sessao` — `before insert or update of status`, `security definer`. Entrando em `atendido` com pacote: `select ... for update` do pacote; status ≠ `ativo` → `'Este pacote não está ativo.'`; `validade < hoje SP` → `'Este pacote venceu em ' || to_char(validade, 'DD/MM/YYYY') || '.'`; `sessoes_usadas >= total_sessoes` → `'Todas as sessões do pacote já foram usadas.'`; senão `+1` e `concluido` ao atingir o total. Saindo de `atendido`: `−1`; `concluido` volta a `ativo` (ou `expirado` se a validade passou); `cancelado` fica `cancelado`.
    - `agendamentos_pacote_valida` — `before insert or update of pacote_vendido_id, cliente_id, servico_id`: pacote de outra cliente/serviço → `'O pacote não é desta cliente ou deste serviço.'`; vincular pacote não ativo → `'Este pacote não está ativo.'`; trocar o pacote de atendimento já `atendido` → `'Não é possível trocar o pacote de um atendimento concluído.'`.
  - `expirar_pacotes() returns int` — `security definer`, qualquer colaborador ativo; `ativo → expirado` quando `validade < hoje SP and sessoes_usadas < total_sessoes`; devolve quantos mudaram.
  - `cancelar_pacote(p_pacote uuid) returns void` — só dona (`'Apenas a dona pode cancelar pacotes'`); só `ativo` (`'Só pacotes ativos podem ser cancelados.'`); grava `cancelado_por/em`.
  - `validar_parte_pagamento(p_forma, p_valor int, p_parcelas int, p_vencimentos date[], p_valores_parcelas int[]) returns void` — interna (sem grant), com as mensagens de parcelas/vencimentos de 0005; usada por `registrar_pagamento` e `registrar_cobranca`.
  - `registrar_cobranca(p_origem origem_pagamento, p_agendamento uuid, p_pacote uuid, p_desconto_centavos int, p_partes jsonb) returns uuid` — `security definer`; dona/recepção (`'Apenas a dona ou a recepção podem lançar pagamentos'`); caixa de hoje aberto `for share` (`'Abra o caixa do dia antes de lançar pagamentos'`); `p_origem = 'agendamento'`: agendamento existe, `status = 'atendido'` (`'Só é possível lançar pagamento de atendimento concluído.'`), sem pacote (`'Sessão de pacote: já paga na venda do pacote.'`), bruto = `valor_previsto_centavos`; `p_origem = 'pacote'`: pacote `ativo`, bruto = `valor_total_centavos`; outra origem → `'Origem de cobrança inválida'`; desconto 0..bruto; `p_partes` array de 1 a 4 (`'Informe de 1 a 4 formas de pagamento.'`), cada `{ forma, valor_centavos, parcelas, vencimentos?, valores_parcelas? }` com `valor_centavos > 0` (`'Cada forma de pagamento deve ter valor maior que zero.'`) e `validar_parte_pagamento`; soma = bruto − desconto (`'A soma das formas de pagamento deve ser igual ao total com desconto.'`). Insere a cobrança (o `23505` de `cobrancas_*_unico` sobe sem tratamento), uma linha de `pagamentos` por parte e as `contas_receber` das partes `a_receber`. Devolve o id da cobrança.
  - `vender_pacote(p_cliente uuid, p_servico uuid, p_total_sessoes int, p_valor_total_centavos int, p_validade date, p_desconto_centavos int, p_partes jsonb) returns uuid` — `security definer`; dona/recepção; `'O pacote deve ter de 1 a 50 sessões.'`, `'A validade não pode ser anterior a hoje.'`, serviço ativo; insere o pacote e chama `registrar_cobranca('pacote', null, <id>, ...)` na mesma transação. Devolve o id do pacote.
  - `registrar_pagamento` (mesma assinatura e retorno de 0005: id do pagamento): continua aceitando `venda_produto` e cortesia (desconto = valor); agora cria antes a cobrança de uma parte (`bruto = p_valor_centavos`, `desconto = p_desconto_centavos`) e grava a linha de pagamento como em 0005 (`valor`/`desconto` originais) com `cobranca_id`. Agendamento com pacote: mesma mensagem de `registrar_cobranca`.
  - `agendamentos_sem_pagamento(date)` e `agendamentos_sem_pagamento_periodo(date, date)`: `not exists (select 1 from public.cobrancas c where c.agendamento_id = a.id)` no lugar de `pagamentos`.
  - RLS: `pacotes_vendidos` select `acesso_clinico(cliente_id,'pacotes')`; `cobrancas` select dona, ou recepção com `caixa_id = caixa_aberto_hoje_id()`; nenhuma escrita direta (revogar insert/update/delete de `authenticated`, tudo de `anon`).

- [ ] **Step 1: Ajustar os testes da Fase 1 ao novo modelo** (antes da migração, para falharem pelo motivo certo): `02_agenda` — o teste "sem FK nesta fase" passa a esperar `fks = 1` (`pacote_vendido_id` com FK, `google_event_id` sem); `03_caixa` linhas com `insert into pagamentos` como superusuário passam a usar `inserirPagamentoDireto`; os fixtures de agendamento "de pacote" (`gen_random_uuid()` em `pacote_vendido_id`) em `03_caixa` e `05_ajustes` passam a usar `criarPacote`; `05_ajustes` "índice único parcial pagamentos_agendamento_unico existe" vira "cobrancas_agendamento_unico existe e pagamentos_agendamento_unico não"; o `23505` do segundo pagamento passa a conter `cobrancas_agendamento_unico`; o teste de insert direto do superusuário passa a inserir duas cobranças do mesmo agendamento.
- [ ] **Step 2: Testes que falham** em `07_pacotes_cobranca.db.test.ts`:

```ts
const COBRAR = "select registrar_cobranca($1, $2, $3, $4, $5::jsonb) as id"
const partes = (...p: object[]) => JSON.stringify(p)
// cobrança dividida (caixa aberto com 5000 de troco; atendimento atendido com valor_previsto 10000)
const id = await cobrar('agendamento', ag, null, 1000, partes({ forma: 'pix', valor_centavos: 6000, parcelas: 1 }, { forma: 'dinheiro', valor_centavos: 3000, parcelas: 1 }))
expect(linhas('select forma, valor_centavos, desconto_centavos from pagamentos where cobranca_id = $1 order by forma', [id]))
  .toEqual([{ forma: 'pix', valor_centavos: 6000, desconto_centavos: 0 }, { forma: 'dinheiro', valor_centavos: 3000, desconto_centavos: 0 }])
const f = await fecharCaixa(caixa, 8000)
expect(f.total_geral).toBe(9000); expect(f.dinheiro_esperado).toBe(8000); expect(f.diferenca).toBe(0)
// erros (P0001, mensagem exata)
erro(partes({ forma: 'pix', valor_centavos: 6000, parcelas: 1 }, { forma: 'dinheiro', valor_centavos: 3000, parcelas: 1 }), 0) // → 'A soma das formas de pagamento deve ser igual ao total com desconto.'
erro(partes(...Array(5).fill({ forma: 'pix', valor_centavos: 2000, parcelas: 1 })), 0)              // → 'Informe de 1 a 4 formas de pagamento.'
erro('[]', 0)                                                                                        // → idem
erro(partes({ forma: 'pix', valor_centavos: 10000, parcelas: 1 }, { forma: 'dinheiro', valor_centavos: 0, parcelas: 1 }), 0) // → 'Cada forma de pagamento deve ter valor maior que zero.'
erro(partes({ forma: 'pix', valor_centavos: 10000, parcelas: 2 }), 0) // → 'Só crédito parcelado ou a receber podem ter mais de uma parcela'
// a receber dentro da cobrança
await cobrar('agendamento', ag2, null, 0, partes({ forma: 'pix', valor_centavos: 7000, parcelas: 1 },
  { forma: 'a_receber', valor_centavos: 3000, parcelas: 3, vencimentos: ['2030-12-03','2031-01-03','2031-02-03'], valores_parcelas: [1000,1000,1000] }))
// → 3 contas_receber, todas com pagamento_id = id da parte 'a_receber'
// duplicidade (Review Focus 1)
expect((await esperarErroSql(cobrar('agendamento', ag, null, 0, partes({ forma: 'pix', valor_centavos: 10000, parcelas: 1 })), '23505')).message).toContain('cobrancas_agendamento_unico')
// atendimento confirmado → 'Só é possível lançar pagamento de atendimento concluído.'
// atendimento com pacote → 'Sessão de pacote: já paga na venda do pacote.'
// caixa fechado → 'Abra o caixa do dia antes de lançar pagamentos'; profissional → 'Apenas a dona ou a recepção podem lançar pagamentos'
// leitura: recepção vê as cobranças do caixa aberto de hoje; depois do fechamento, 0; profissional sempre 0
// registrar_pagamento (atalho) ainda devolve o id do pagamento e cria cobrança { valor_bruto_centavos: 12000, desconto_centavos: 1500 }
// agendamentos_sem_pagamento(hoje) não traz atendimento que já tem cobrança
// pacotes
const p = await venderPacote(cli, servico, 2, 50000, null, 0, partes({ forma: 'pix', valor_centavos: 50000, parcelas: 1 }))
// → pacote ativo, cobrança origem 'pacote'; soma errada → P0001 e `select count(*) from pacotes_vendidos` inalterado (tudo desfeito)
// 51 sessões → 'O pacote deve ter de 1 a 50 sessões.'; validade ontem → 'A validade não pode ser anterior a hoje.'
// consumo (profissional marcando os próprios atendimentos; agendamentos A1, A2, A3 com o pacote)
await marcar(A1, 'atendido'); expect(await pacote(p)).toMatchObject({ sessoes_usadas: 1, status: 'ativo' })
await marcar(A2, 'faltou');   expect(await pacote(p)).toMatchObject({ sessoes_usadas: 1 })
await marcar(A3, 'atendido'); expect(await pacote(p)).toMatchObject({ sessoes_usadas: 2, status: 'concluido' })
// quarto atendimento → 'Todas as sessões do pacote já foram usadas.'
// dona volta A3 para 'confirmado' → { sessoes_usadas: 1, status: 'ativo' }
// pacote com validade ontem → 'Este pacote venceu em <DD/MM/AAAA>.'; pacote de outra cliente → 'O pacote não é desta cliente ou deste serviço.'
// cancelar_pacote: recepção → 'Apenas a dona pode cancelar pacotes'; dona ok; depois atendido → 'Este pacote não está ativo.'
// expirar_pacotes(): ativo vencido com sessões → 'expirado'; concluído vencido continua 'concluido'
// RLS: profB sem vínculo vê 0 pacotes; recepção vê todos; insert direto em pacotes_vendidos/cobrancas → 42501
// concorrência (Review Focus 2): pacote com 1 sessão restante, duas conexões (abrirConexao) em transação
//   c1: update A1 status 'atendido' (sem commit); c2: update A2 status 'atendido' (fica esperando o lock)
//   c1: commit → c2 termina com P0001 'Todas as sessões do pacote já foram usadas.'
// migração dos pagamentos antigos
await resetarBanco({ ate: '0006' }) // + caixa, 1 pagamento de agendamento (12000, desconto 1500) e 1 'venda_produto' (3000)
await aplicarMigracoes('0007')
// → cobrancas = 2, cada pagamento com cobranca_id = próprio id, origem/bruto/desconto/caixa/lancada_por copiados,
//   e fechar_caixa devolve total_geral 13500 (mesmo resultado de antes)
```

- [ ] **Step 3:** Run `pnpm test:db` — Expected: FAIL em `07` e nos testes ajustados no Step 1.
- [ ] **Step 4:** Implementar os helpers de `helpers.ts` e escrever `0007_pacotes_cobranca.sql`.
- [ ] **Step 5:** Run `pnpm test:db` — Expected: 7 arquivos PASS.
- [ ] **Step 6:** Atualizar `tipos.ts` (`pacotes_vendidos`, `cobrancas`, `pagamentos.cobranca_id`, enum `status_pacote`, RPCs `registrar_cobranca`, `vender_pacote`, `cancelar_pacote`, `expirar_pacotes`). Run `pnpm typecheck && pnpm test` — Expected: PASS.
- [ ] **Step 7:** Commit: `feat(db): pacotes de sessões e cobrança com pagamento dividido (0007)`

---

### Task 3: Assinatura, modo tablet e base da ficha

**Files:**
- Create: `src/lib/ficha/{assinatura,caminhos,acesso}.ts` (+ `.test.ts`), `src/features/ficha/{campo-assinatura,moldura-tablet,abas-ficha}.tsx`, `src/app/(tablet)/layout.tsx`
- Modify: `package.json` (deps da Global Constraints), `src/lib/dominio/permissoes.ts` (+ teste), `src/test/supabase-falso.ts`, `src/app/(app)/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: `registrar_acesso` (Task 1); `exigirPerfil`, `createClient`.
- Produces:
  - `MAX_BYTES_ASSINATURA = 200 * 1024`; `decodificarAssinaturaPng(dataUrl: string): Uint8Array | null` — aceita só `data:image/png;base64,`, base64 válido, assinatura PNG (`89 50 4E 47 0D 0A 1A 0A`) e tamanho ≤ limite.
  - `BUCKET_FICHA = 'ficha-clinica'`; `URL_ASSINADA_SEGUNDOS = 300`; `type AreaArquivo = 'anamneses' | 'termos' | 'fotos'`; `caminhoArquivo(clienteId: string, area: AreaArquivo, id: string, ext: 'png' | 'pdf' | 'jpg'): string`; `caminhoPertence(caminho: string, clienteId: string, area: AreaArquivo): boolean` (mesma regex de `cliente_do_caminho`, comparando cliente e área).
  - `type Supabase = Awaited<ReturnType<typeof createClient>>` (exportado de `acesso.ts`, mesmo padrão de `agenda/regras.ts`).
  - `type EntidadeAuditada = 'anamneses' | 'termos_assinados' | 'fotos' | 'evolucoes' | 'exportacao'`; `registrarAcesso(supabase: Supabase, a: { entidade: EntidadeAuditada; entidadeId?: string | null; clienteId: string }): Promise<void>` — chama a RPC `registrar_acesso` e **lança** `Error` se ela falhar.
  - `type AbaFicha = 'dados' | 'anamnese' | 'termos' | 'fotos' | 'evolucoes' | 'pacotes' | 'historico'`; `ROTULO_ABA: Record<AbaFicha, string>` ("Dados", "Anamnese", "Termos", "Fotos", "Evoluções", "Pacotes", "Histórico"); `abasDaFicha(perfil: Perfil): AbaFicha[]` (na ordem acima; recepção sem `fotos`).
  - `type AcaoFicha = 'aplicar_anamnese' | 'colher_termo' | 'adicionar_foto' | 'arquivar_foto' | 'adicionar_evolucao' | 'vender_pacote' | 'cancelar_pacote' | 'exportar' | 'ver_acessos'`; `podeNaFicha(perfil: Perfil, acao: AcaoFicha): boolean` (spec §3: anamnese dona/recepção; termo todos; foto dona/profissional; arquivar, cancelar, exportar, ver acessos só dona; evolução só profissional; vender dona/recepção).
  - `criarSupabaseFalso()` ganha `cliente.storage.from(bucket)` com `upload(path, corpo, opcoes)`, `remove(paths)`, `createSignedUrl(path, segundos)`, `createSignedUrls(paths, segundos)`, `download(path)`: cada chamada é registrada em `chamadas` com `tabela: 'storage:<bucket>'` e `metodo` = nome do método; respostas pela fila `'storage:<bucket>:<metodo>'` (padrão `{ data: { path }, error: null }` / `{ signedUrl: 'https://assinada/<path>' }`). Testes de ações que usam o admin fazem `vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => admin.cliente }))` com um segundo `criarSupabaseFalso()`.
  - `<CampoAssinatura onMudar={(dataUrl: string | null) => void} />` — `signature_pad` num canvas que ocupa a largura (altura 220 px; redimensiona com `devicePixelRatio` sem perder o traço), botão "Limpar"; `onMudar(null)` quando vazio, senão `toDataURL('image/png')`; `touch-action: none`.
  - `<MolduraTablet titulo voltarPara children />` — tela cheia sem menu, texto base 20 px, tenta `requestFullscreen()` ao montar (falha silenciosa); botão discreto "Cancelar" pede confirmação ("Cancelar o preenchimento? O que foi respondido será perdido.") antes de voltar para `voltarPara`.
  - `src/app/(tablet)/layout.tsx` — `exigirPerfil()` (só colaborador ativo), fundo `bg-blush`, sem o shell de `(app)`.
  - `<AbasFicha clienteId abas atual />` — links `?aba=<aba>` com `aria-current="page"` (as abas viram navegação por URL para que cada aba clínica seja carregada, e auditada, no servidor só quando aberta). `clientes/[id]/page.tsx` lê `searchParams.aba`, valida contra `abasDaFicha(perfil)` (aba inválida → `dados`) e renderiza Dados/Histórico como hoje; as demais abas chegam nas Tasks 4–9.

- [ ] **Step 1: Testes que falham**

```ts
// assinatura.test.ts
const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, 0,0,0,0])
expect(decodificarAssinaturaPng(`data:image/png;base64,${png.toString('base64')}`)).toEqual(new Uint8Array(png))
expect(decodificarAssinaturaPng(`data:image/jpeg;base64,${png.toString('base64')}`)).toBeNull()
expect(decodificarAssinaturaPng('data:image/png;base64,bm90LXBuZw==')).toBeNull()              // "not-png"
expect(decodificarAssinaturaPng(`data:image/png;base64,${Buffer.concat([png, Buffer.alloc(200 * 1024)]).toString('base64')}`)).toBeNull()
// caminhos.test.ts
const C = 'c1111111-1111-4111-8111-111111111111', U = 'a2222222-2222-4222-8222-222222222222'
expect(caminhoArquivo(C, 'fotos', U, 'jpg')).toBe(`clientes/${C}/fotos/${U}.jpg`)
expect(caminhoPertence(`clientes/${C}/fotos/${U}.jpg`, C, 'fotos')).toBe(true)
expect(caminhoPertence(`clientes/${C}/termos/${U}.pdf`, C, 'fotos')).toBe(false)
expect(caminhoPertence(`clientes/${C}/fotos/../${U}.jpg`, C, 'fotos')).toBe(false)
expect(caminhoPertence(`clientes/OUTRA/fotos/${U}.jpg`, C, 'fotos')).toBe(false)
// acesso.test.ts (supabase-falso)
await registrarAcesso(falso.cliente, { entidade: 'fotos', clienteId: C })
expect(falso.chamadasRpc('registrar_acesso')[0].args[0]).toEqual({ p_entidade: 'fotos', p_entidade_id: null, p_cliente: C })
falso.responder('rpc:registrar_acesso', { data: null, error: { code: 'P0001', message: 'Acesso não autorizado' } })
await expect(registrarAcesso(falso.cliente, { entidade: 'fotos', clienteId: C })).rejects.toThrow('Acesso não autorizado')
// permissoes.test.ts
expect(abasDaFicha('dona')).toEqual(['dados','anamnese','termos','fotos','evolucoes','pacotes','historico'])
expect(abasDaFicha('recepcao')).not.toContain('fotos')
expect(podeNaFicha('profissional', 'aplicar_anamnese')).toBe(false)
expect(podeNaFicha('profissional', 'colher_termo')).toBe(true)
expect(podeNaFicha('recepcao', 'adicionar_foto')).toBe(false)
expect(podeNaFicha('dona', 'adicionar_evolucao')).toBe(false)
expect(podeNaFicha('recepcao', 'cancelar_pacote')).toBe(false)
expect(podeNaFicha('recepcao', 'exportar')).toBe(false)
```

- [ ] **Step 2:** Run `pnpm test` — Expected: FAIL (módulos inexistentes).
- [ ] **Step 3:** `pnpm add pdf-lib@1.17.1 signature_pad@5.1.4 fflate@0.8.3 heic2any@0.0.4`; implementar os módulos, o supabase falso com storage, os componentes, o layout `(tablet)` e a navegação de abas da ficha.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm lint` — Expected: PASS.
- [ ] **Step 5:** Verificar com `pnpm dev` numa página de rascunho local (não commitada) que `<CampoAssinatura>` desenha com mouse e toque (DevTools, 1024 px) e "Limpar" zera; a ficha troca de aba pela URL.
- [ ] **Step 6:** Commit: `feat(ficha): assinatura no canvas, modo tablet e abas da ficha por URL`

---

### Task 4: Anamnese

**Files:**
- Create: `src/lib/dominio/anamnese.ts` (+ teste), `src/app/(app)/clientes/ficha/{anamnese.ts,anamnese.test.ts,dados.ts}`, `src/app/(app)/configuracoes/anamnese/{page.tsx,actions.ts,actions.test.ts}`, `src/app/(tablet)/tablet/anamnese/[clienteId]/page.tsx`, `src/features/ficha/anamnese/{aba-anamnese,formulario-anamnese,editor-modelo-anamnese}.tsx`
- Modify: `src/app/(app)/clientes/[id]/page.tsx`, `src/app/(app)/configuracoes/page.tsx` (link "Modelo de anamnese"), `src/app/(app)/agenda/dados.ts`, `src/features/agenda/{dados-agenda.ts,dados-agenda.test.ts,cartao-agendamento.tsx}`

**Interfaces:**
- Consumes: `salvar_modelo_anamnese`, `situacao_ficha`, RLS de `anamneses` (Task 1); `registrarAcesso`, `caminhoArquivo`, `decodificarAssinaturaPng`, `BUCKET_FICHA`, `URL_ASSINADA_SEGUNDOS`, `podeNaFicha`, `CampoAssinatura`, `MolduraTablet` (Task 3); `createAdminClient`, `mensagemErroBanco`.
- Produces:
  - `type TipoPergunta = 'texto' | 'sim_nao' | 'sim_nao_detalhe' | 'multipla' | 'data'`; `type Pergunta = { id: string; tipo: TipoPergunta; texto: string; obrigatoria: boolean; alerta?: boolean; opcoes?: string[] }`; `type ValorResposta = string | boolean | { sim: boolean; detalhe: string } | string[]` (texto: string; sim_nao: boolean; sim_nao_detalhe: objeto; multipla: string[]; data: `yyyy-MM-dd`); `type Respostas = Record<string, ValorResposta>`.
  - `erroDasPerguntas(perguntas: Pergunta[]): string | null` — "Adicione ao menos uma pergunta.", "Toda pergunta precisa de texto.", "Há perguntas repetidas." (ids iguais), "Perguntas de múltipla escolha precisam de ao menos 2 opções.", "Só perguntas de sim/não podem ser de alerta.".
  - `gerarIdPergunta(texto: string, existentes: string[]): string` — slug `^[a-z0-9_]{1,40}$` sem acento, sufixo `_2`, `_3`… se repetido.
  - `precisaNovaVersao(anteriores: Pergunta[], novas: Pergunta[], tituloAnterior: string, tituloNovo: string): boolean` — falso quando nada mudou (ordem importa).
  - `errosDasRespostas(perguntas: Pergunta[], respostas: Respostas): Record<string, string>` — obrigatória sem resposta → `"Responda: <texto>"`; `sim_nao_detalhe` com sim e detalhe vazio → `"Conte mais sobre: <texto>"`.
  - `alertasDaAnamnese(perguntas: Pergunta[], respostas: Respostas): string[]` — textos das perguntas de alerta respondidas sim, com o detalhe entre parênteses quando houver.
  - `respostasLegiveis(perguntas: Pergunta[], respostas: Respostas): { pergunta: string; resposta: string; alerta: boolean }[]` — "Sim"/"Não", "Sim — <detalhe>", lista separada por vírgula, data `dd/MM/yyyy`, "—" sem resposta; usa as perguntas **da versão da própria anamnese**.
  - `anamnesePendente(ultimaEm: string | null, agora: Date): boolean` — sem anamnese ou última anterior a `agora − 12 meses` (no fuso de São Paulo).
  - `salvarModeloAnamnese(dados: { titulo: string; perguntas: Pergunta[] }): Promise<Resultado>` — `exigirPerfil('dona')`; `erroDasPerguntas`; sem mudança → `{ ok: true }` sem RPC; senão RPC `salvar_modelo_anamnese`.
  - `registrarAnamnese(dados: { clienteId: string; modeloId: string; respostas: Respostas; assinatura: string }): Promise<{ ok: true; id: string } | { ok: false; erro: string }>` — `exigirPerfil('dona','recepcao')`; modelo lido e ativo (senão "O modelo de anamnese mudou. Recomece o preenchimento."); `errosDasRespostas` (primeira mensagem); assinatura inválida → "Assine no quadro antes de confirmar."; `id = randomUUID()`; upload do PNG em `caminhoArquivo(cliente,'anamneses',id,'png')` com o **admin** (`contentType: 'image/png', upsert: false`); insert em `anamneses` com o cliente da **usuária**; se o insert falhar, `remove([path])` pelo admin e devolve `mensagemErroBanco`.
  - `urlAssinaturaAnamnese(anamneseId: string): Promise<{ ok: true; url: string } | { ok: false; erro: string }>` — lê a linha (RLS; nula → "Anamnese não encontrada."), `registrarAcesso({ entidade: 'anamneses', entidadeId, clienteId })`, depois `createSignedUrl(path, URL_ASSINADA_SEGUNDOS)` com o cliente da usuária.
  - `dados.ts` (`import 'server-only'`): `carregarAnamneses(supabase, clienteId): Promise<AnamneseFicha[]>` — `registrarAcesso({ entidade: 'anamneses', clienteId })` **antes** do select; `type AnamneseFicha = { id: string; preenchidaEm: string; versao: number; preenchidaPor: string; itens: ReturnType<typeof respostasLegiveis>; alertas: string[] }`. `carregarAlertasCabecalho(supabase, clienteId): Promise<{ pendente: boolean; alertas: string[] }>` — usa `situacao_ficha`; só quando `tem_alerta` lê a última anamnese e registra o acesso (entidade `anamneses`, id da anamnese) para montar os textos.
  - `AgendamentoAgenda` ganha `alertaAnamnese: boolean` e `anamnesePendente: boolean`; `LinhasAgenda` ganha `situacaoFicha?: { cliente_id: string; ultima_anamnese_em: string | null; tem_alerta: boolean }[]`; `montarDadosAgenda(linhas, sessao, agora: Date)`.
  - Telas: aba **Anamnese** (última em destaque com alertas no topo; versões anteriores recolhidas; "Ver assinatura"; botão "Preencher anamnese" para quem `podeNaFicha(perfil,'aplicar_anamnese')`); `/tablet/anamnese/[clienteId]` (uma pergunta por cartão, letras grandes, botões Sim/Não de 56 px; ao final resumo `respostasLegiveis` + `CampoAssinatura` + "Confirmar"; sucesso volta para `/clientes/<id>?aba=anamnese`); topo da ficha mostra "⚠ Atenção: <alertas>" e "Anamnese pendente"; cartão da agenda mostra "⚠ Atenção" e "Anamnese pendente" (só indicadores, sem respostas); `/configuracoes/anamnese` com editor (adicionar, reordenar com ↑/↓, tipo, obrigatória, alerta, opções; "Salvar nova versão").

- [ ] **Step 1: Testes que falham**

```ts
// anamnese.test.ts (perguntas do modelo padrão de Task 1)
expect(errosDasRespostas(P, { queixa: 'Manchas' })).toMatchObject({ gestante: 'Responda: Está grávida ou amamentando?' })
expect(errosDasRespostas(P, { ...completas, alergias: { sim: true, detalhe: ' ' } }).alergias).toBe('Conte mais sobre: Tem alguma alergia (medicamentos, cosméticos, alimentos)?')
expect(alertasDaAnamnese(P, { ...completas, gestante: true, alergias: { sim: true, detalhe: 'dipirona' } }))
  .toEqual(['Tem alguma alergia (medicamentos, cosméticos, alimentos)? (dipirona)', 'Está grávida ou amamentando?'])
expect(alertasDaAnamnese(P, { ...completas, sol: true })).toEqual([])               // sol não é alerta
expect(respostasLegiveis(V1, { antiga: true })).toEqual([{ pergunta: 'Pergunta só da v1', resposta: 'Sim', alerta: false }]) // versão antiga com as próprias perguntas
expect(anamnesePendente(null, agora)).toBe(true)
expect(anamnesePendente('2025-11-05T12:00:00Z', new Date('2026-11-04T12:00:00Z'))).toBe(false)
expect(anamnesePendente('2025-11-03T12:00:00Z', new Date('2026-11-04T12:00:00Z'))).toBe(true)
expect(erroDasPerguntas([{ id: 'a', tipo: 'texto', texto: 'A', obrigatoria: false, alerta: true }])).toBe('Só perguntas de sim/não podem ser de alerta.')
expect(gerarIdPergunta('Usa ácido?', ['usa_acido'])).toBe('usa_acido_2')
expect(precisaNovaVersao(P, P, 'T', 'T')).toBe(false)
// anamnese.test.ts (ações, supabase-falso; admin mockado com outra instância)
// recepção: upload em admin 'storage:ficha-clinica' com path /^clientes\/<C>\/anamneses\/[0-9a-f-]{36}\.png$/ e depois insert em 'anamneses' (cliente da usuária) com o mesmo path
// faltando obrigatória → { ok: false, erro: 'Responda: Está grávida ou amamentando?' } e nenhuma chamada de storage
// insert com erro 42501 → admin.remove([path]) chamado e { ok: false, erro: 'Você não tem permissão para esta ação.' }
// profissional → rejects 'REDIRECT:/inicio'
// urlAssinaturaAnamnese: ordem das chamadas = select anamneses → rpc registrar_acesso → createSignedUrl(path, 300);
//   registrar_acesso com erro → { ok: false } e nenhum createSignedUrl
// carregarAnamneses: rpc registrar_acesso vem antes do select de 'anamneses'
// configuracoes/anamnese/actions.test.ts: recepção → REDIRECT; sem mudança → nenhuma RPC; com mudança → rpc salvar_modelo_anamnese { p_titulo, p_perguntas }
// dados-agenda.test.ts
expect(montar({ situacaoFicha: [{ cliente_id: C, ultima_anamnese_em: '2026-10-01T12:00:00Z', tem_alerta: true }] }, agora).agendamentos[0])
  .toMatchObject({ alertaAnamnese: true, anamnesePendente: false })
expect(montar({ situacaoFicha: [] }, agora).agendamentos[0]).toMatchObject({ alertaAnamnese: false, anamnesePendente: true })
```

- [ ] **Step 2:** Run `pnpm test` — Expected: FAIL.
- [ ] **Step 3:** Implementar domínio, ações, `dados.ts`, telas e a carga de `situacao_ficha` em `agenda/dados.ts` (ids distintos das clientes do período).
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ficha): anamnese configurável, preenchida e assinada no tablet`

---

### Task 5: Termos de consentimento e PDF

**Files:**
- Create: `src/lib/dominio/termos.ts` (+ teste), `src/lib/ficha/pdf-termo.ts` (+ teste), `src/app/(app)/clientes/ficha/{termos.ts,termos.test.ts}`, `src/app/(app)/configuracoes/termos/{page.tsx,actions.ts,actions.test.ts}`, `src/app/(tablet)/tablet/termo/[clienteId]/page.tsx`, `src/features/ficha/termos/{aba-termos,tela-termo,editor-modelo-termo}.tsx`
- Modify: `src/app/(app)/clientes/ficha/dados.ts`, `src/app/(app)/clientes/[id]/page.tsx`, `src/app/(app)/configuracoes/page.tsx` (link "Termos"), `src/app/(app)/servicos/{schemas.ts,schemas.test.ts,actions.ts,[id]/page.tsx}`, `src/features/servicos/formulario-servico.tsx`, `src/app/(app)/agenda/{actions.ts,actions.test.ts,dados.ts,resultado.ts}`, `src/features/agenda/{dados-agenda.ts,cartao-agendamento.tsx}`, `src/app/(app)/inicio/page.tsx`, `src/features/inicio/{dados.ts,cartoes.tsx}`

**Interfaces:**
- Consumes: `salvar_modelo_termo`, `agendamentos_com_termo_pendente`, `atendimentos_sem_termo`, RLS de `termos_assinados` (Task 1); tudo da Task 3; `formatarCPF`, `formatarNoFuso`.
- Produces:
  - `type BlocoTexto = { tipo: 'titulo' | 'paragrafo' | 'item'; texto: string }`; `blocosMarkdown(texto: string): BlocoTexto[]` — markdown simples: linha `# ` = título, `- ` = item, linhas seguidas = um parágrafo, linha vazia separa; demais marcações ficam como texto.
  - `resumirUserAgent(ua: string): string` — "iPad · Safari", "iPhone · Safari", "Android · Chrome", "Windows · Edge", "Mac · Chrome"…; desconhecido → primeiros 60 caracteres; sempre ≤ 200.
  - `type DadosTermoPdf = { identificador: string; titulo: string; versao: number; texto: string; clienteNome: string; clienteCpf: string | null; assinadoEm: Date; dispositivo: string; assinaturaPng: Uint8Array }`.
  - `rodapeDoTermo(d: Omit<DadosTermoPdf, 'assinaturaPng'>): string[]` — exatamente: `Cliente: <nome>` + ` — CPF <999.999.999-99>` quando houver; `Assinado em <dd/MM/yyyy> às <HH:mm> (horário de Brasília)`; `Dispositivo: <dispositivo>`; `Identificador: <uuid>`; `Termo: <titulo> — versão <n>`.
  - `textoSeguroWinAnsi(t: string): string` — troca caracteres fora do WinAnsi por `?` (fontes padrão do pdf-lib).
  - `gerarPdfTermo(d: DadosTermoPdf): Promise<{ pdf: Uint8Array; hashSha256: string }>` — `import 'server-only'`; A4, Helvetica/Helvetica-Bold, margens 50 pt, quebra de linha por `widthOfTextAtSize`, novas páginas quando preciso; título, blocos do texto, "Li e concordo com os termos acima.", imagem da assinatura (largura máx. 240 pt) e rodapé; metadados `setTitle(\`${titulo} — v${versao}\`)`, `setSubject(identificador)`, `setCreationDate/ModDate(assinadoEm)`, `setProducer('Madame Fê Clinic')`; `hashSha256` = SHA-256 hex dos bytes salvos.
  - `salvarModeloTermo(dados: { anteriorId?: string | null; titulo: string; texto: string }): Promise<Resultado>` — `exigirPerfil('dona')`; título e texto obrigatórios (texto ≤ 20 000); RPC `salvar_modelo_termo`.
  - `colherAssinaturaTermo(dados: { clienteId: string; modeloTermoId: string; agendamentoId?: string | null; assinatura: string; dispositivo: string; aceite: boolean }): Promise<{ ok: true; id: string } | { ok: false; erro: string }>` — `exigirPerfil()` (os três perfis; o RLS limita a profissional às vinculadas); `aceite` falso → "Marque \"Li e concordo\" para assinar."; assinatura inválida → "Assine no quadro antes de confirmar."; cliente lida pelo cliente da usuária (nula → "Cliente não encontrada."); modelo ativo (senão "Este termo foi atualizado. Abra novamente para assinar a versão atual."); `id = randomUUID()`; `gerarPdfTermo`; upload PNG e PDF pelo admin em `caminhoArquivo(cliente,'termos',id,'png'|'pdf')` (o PNG da assinatura usa outro uuid); insert em `termos_assinados` com o cliente da usuária (`id`, caminhos, `hash_sha256`, `modelo_versao`, `dispositivo: resumirUserAgent(...)`); falha → `remove` dos dois arquivos e `mensagemErroBanco`.
  - `urlArquivoTermo(termoId: string, arquivo: 'pdf' | 'assinatura'): Promise<{ ok: true; url: string } | { ok: false; erro: string }>` — mesma ordem de `urlAssinaturaAnamnese` (linha via RLS → `registrarAcesso({ entidade: 'termos_assinados', entidadeId, clienteId })` → URL assinada de 300 s); nula → "Termo não encontrado.".
  - `carregarTermos(supabase, clienteId)` em `dados.ts` (registra acesso antes): `Promise<{ assinados: { id: string; titulo: string; versao: number; assinadoEm: string; colhidoPor: string; atual: boolean }[]; pendentes: { modeloTermoId: string; titulo: string }[] }>` — pendentes = termos dos serviços já agendados para a cliente ainda não assinados na versão atual.
  - `servicoSchema` ganha `modeloTermoId: z.uuid().nullable()` (`''` → `null`); `salvarServico` grava `modelo_termo_id`; formulário do serviço com select "Termo de consentimento" (opção "Nenhum" + modelos ativos).
  - `ResultadoStatus` passa a `{ ok: true; abrirPagamento: boolean; termoPendente: boolean } | { ok: false; erro: string }`; `alterarStatus` consulta `agendamentos_com_termo_pendente([id])` quando `para === 'atendido'` (falha na consulta não desfaz o status: `termoPendente: false`).
  - `AgendamentoAgenda.termoPendente: boolean` (via `agendamentos_com_termo_pendente` com os ids do período); `DetalhesAgendamento` mostra "Termo pendente" com o botão "Colher assinatura" → `/tablet/termo/<clienteId>?modelo=<id>&agendamento=<id>&voltar=<url da agenda>`; ao marcar "Atendido" com termo pendente aparece o mesmo aviso (o pagamento continua abrindo).
  - Início, só dona: cartão "Atendidos sem termo" (últimos 30 dias, `atendimentos_sem_termo`), cada item com link para a ficha.
  - `/tablet/termo/[clienteId]`: texto do termo (`blocosMarkdown`), nome e CPF da cliente, data de hoje, `CampoAssinatura`, checkbox "Li e concordo", "Confirmar"; `dispositivo = navigator.userAgent`; sucesso volta para `voltar` (padrão `/clientes/<id>?aba=termos`). Aba **Termos**: lista com "Abrir PDF" (`urlArquivoTermo` em nova aba), pendentes com "Colher assinatura". `/configuracoes/termos`: lista de termos ativos, criar e editar (salvar = nova versão).

- [ ] **Step 1: Testes que falham**

```ts
// termos.test.ts
expect(blocosMarkdown('# Riscos\nPode haver\nvermelhidão.\n\n- Evitar sol\n- Usar protetor')).toEqual([
  { tipo: 'titulo', texto: 'Riscos' }, { tipo: 'paragrafo', texto: 'Pode haver vermelhidão.' },
  { tipo: 'item', texto: 'Evitar sol' }, { tipo: 'item', texto: 'Usar protetor' }])
expect(resumirUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('iPad · Safari')
expect(resumirUserAgent('x'.repeat(500)).length).toBeLessThanOrEqual(200)
// pdf-termo.test.ts
const d = { identificador: U, titulo: 'Termo Peeling', versao: 2, texto: '# Riscos\nVermelhidão.', clienteNome: 'Ana Souza',
  clienteCpf: '52998224725', assinadoEm: new Date('2026-11-04T13:30:00Z'), dispositivo: 'iPad · Safari', assinaturaPng: PNG_1x1 }
expect(rodapeDoTermo(d)).toEqual(['Cliente: Ana Souza — CPF 529.982.247-25', 'Assinado em 04/11/2026 às 10:30 (horário de Brasília)',
  'Dispositivo: iPad · Safari', `Identificador: ${U}`, 'Termo: Termo Peeling — versão 2'])
const { pdf, hashSha256 } = await gerarPdfTermo(d)
const doc = await PDFDocument.load(pdf)
expect(doc.getTitle()).toBe('Termo Peeling — v2'); expect(doc.getSubject()).toBe(U)
expect(hashSha256).toBe(createHash('sha256').update(pdf).digest('hex'))
expect((await PDFDocument.load((await gerarPdfTermo({ ...d, texto: 'Parágrafo longo.\n\n'.repeat(300) })).pdf)).getPageCount()).toBeGreaterThan(1)
expect(textoSeguroWinAnsi('Olá, ção 😀')).toBe('Olá, ção ?')
// termos.test.ts (ações)
// colherAssinaturaTermo (profissional): 2 uploads admin (.png e .pdf em clientes/<C>/termos/), insert termos_assinados com
//   hash_sha256 /^[0-9a-f]{64}$/, pdf_path terminado em `${id}.pdf`, dispositivo 'iPad · Safari'
// aceite false → { ok: false, erro: 'Marque "Li e concordo" para assinar.' } sem upload
// cliente nula (RLS) → 'Cliente não encontrada.' sem upload; modelo inativo → 'Este termo foi atualizado. Abra novamente para assinar a versão atual.'
// insert com erro → admin.remove com os dois caminhos
// urlArquivoTermo: select → rpc registrar_acesso { p_entidade: 'termos_assinados', p_entidade_id: T, p_cliente: C } → createSignedUrl(pdf_path, 300)
// configuracoes/termos/actions.test.ts: recepção → REDIRECT; título vazio → erro sem RPC; ok → rpc salvar_modelo_termo { p_anterior, p_titulo, p_texto }
// servicos/schemas.test.ts: modeloTermoId '' → null; 'abc' → erro
// agenda/actions.test.ts: alterarStatus(id,'atendido') com rpc agendamentos_com_termo_pendente → [id]
//   resolve { ok: true, abrirPagamento: true, termoPendente: true }; para 'faltou' a RPC não é chamada e termoPendente é false
```

- [ ] **Step 2:** Run `pnpm test` — Expected: FAIL.
- [ ] **Step 3:** Implementar domínio, PDF, ações, telas, campo no serviço, aviso na agenda e cartão do Início.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ficha): termos de consentimento assinados no tablet com PDF e hash`

---

### Task 6: Fotos antes/depois/evolução

**Files:**
- Create: `src/lib/dominio/fotos.ts` (+ teste), `src/features/fotos/converter.ts`, `src/app/(app)/clientes/ficha/{fotos.ts,fotos.test.ts}`, `src/features/ficha/fotos/{aba-fotos,adicionar-fotos,galeria-fotos,comparar-fotos}.tsx`
- Modify: `src/app/(app)/clientes/ficha/dados.ts`, `src/app/(app)/clientes/[id]/page.tsx`

**Interfaces:**
- Consumes: RLS de `fotos` e `ficha_clinica_insert` (Task 1); `caminhoArquivo`, `caminhoPertence`, `registrarAcesso`, `BUCKET_FICHA`, `URL_ASSINADA_SEGUNDOS`, `podeNaFicha` (Task 3); `createBrowserClient`.
- Produces:
  - `type TipoFoto = 'antes' | 'depois' | 'evolucao'`; `ROTULO_TIPO_FOTO` ("Antes", "Depois", "Evolução"); `MAX_LADO_FOTO = 2560`; `MAX_BYTES_FOTO = 5 * 1024 * 1024`.
  - `dimensoesAlvo(largura: number, altura: number, maxLado = MAX_LADO_FOTO): { largura: number; altura: number }` — mantém proporção, arredonda, nunca amplia.
  - `arquivoDeImagemAceito(a: { type: string; name: string }): boolean` — `image/jpeg`, `image/png`, `image/heic`, `image/heif`, ou extensão `.jpg/.jpeg/.png/.heic/.heif` com `type` vazio.
  - `QUALIDADES_JPEG = [0.85, 0.75, 0.65, 0.5]`.
  - `agruparFotos<T extends { tiradaEm: string; servicoNome: string | null }>(fotos: T[]): { data: string; servicoNome: string | null; fotos: T[] }[]` — por dia de São Paulo (mais recente primeiro) e serviço.
  - `converterParaJpeg(arquivo: File): Promise<Blob>` (navegador) — decodifica com `createImageBitmap`; se falhar e for HEIC/HEIF, `await import('heic2any')` para JPEG e decodifica de novo; desenha no canvas em `dimensoesAlvo`; `toBlob('image/jpeg', q)` percorrendo `QUALIDADES_JPEG` até ≤ `MAX_BYTES_FOTO`; não coube ou não decodificou → `Error('Não foi possível ler esta foto. Tente outra ou tire pela câmera.')`.
  - `registrarFotos(clienteId: string, itens: { path: string; tipo: TipoFoto; servicoId?: string | null; agendamentoId?: string | null; tiradaEm?: string }[]): Promise<Resultado>` — `exigirPerfil('dona','profissional')`; 1–20 itens; todo `path` com `caminhoPertence(path, clienteId, 'fotos')` e extensão `.jpg` (senão "Foto inválida." sem gravar nada); insert em lote em `fotos` pelo cliente da usuária; falha → `remove(paths)` pelo admin (órfãos) e `mensagemErroBanco`.
  - `urlsFotos(ids: string[]): Promise<{ ok: true; urls: Record<string, string> } | { ok: false; erro: string }>` — 1–60 ids; linhas via RLS; `registrarAcesso` por foto (entidade `fotos`, id); `createSignedUrls(paths, 300)`.
  - `arquivarFoto(id: string): Promise<Resultado>` — `exigirPerfil('dona')`; `update fotos set arquivada = true`; 0 linhas → "Foto não encontrada.".
  - `carregarFotos(supabase, clienteId)` em `dados.ts`: registra acesso (entidade `fotos`, sem id) antes do select; devolve `{ id; tipo; tiradaEm; servicoNome; url }[]` (não arquivadas) com URLs de `createSignedUrls` (300 s).
  - Telas: aba **Fotos** (dona e profissional): "Adicionar fotos" com "Tirar foto" (`<input type="file" accept="image/*" capture="environment">`) e "Galeria" (`accept="image/*,.heic,.heif" multiple`); escolher tipo e serviço/atendimento (atendimentos da cliente); cada arquivo: `arquivoDeImagemAceito` (senão "Escolha uma foto (JPEG, PNG ou HEIC).") → `converterParaJpeg` → `createBrowserClient().storage.from(BUCKET_FICHA).upload(caminhoArquivo(...,'jpg'), blob, { contentType: 'image/jpeg', upsert: false })` com progresso → `registrarFotos`. Galeria por `agruparFotos`; tocar abre em tela cheia (Dialog); "Comparar": escolher duas → lado a lado em ≥ 640 px e uma sobre a outra abaixo disso; URL vencida (erro de imagem) pede `urlsFotos` de novo; dona vê "Arquivar" com confirmação.

- [ ] **Step 1: Testes que falham**

```ts
// fotos.test.ts (Review Focus 4)
expect(dimensoesAlvo(6000, 4000)).toEqual({ largura: 2560, altura: 1707 })
expect(dimensoesAlvo(3000, 4000)).toEqual({ largura: 1920, altura: 2560 })
expect(dimensoesAlvo(800, 600)).toEqual({ largura: 800, altura: 600 })
expect(arquivoDeImagemAceito({ type: 'image/heic', name: 'IMG_0001.HEIC' })).toBe(true)
expect(arquivoDeImagemAceito({ type: '', name: 'IMG_0001.heic' })).toBe(true)
expect(arquivoDeImagemAceito({ type: 'application/pdf', name: 'exame.pdf' })).toBe(false)
expect(agruparFotos([{ tiradaEm: '2026-11-04T02:00:00Z', servicoNome: 'Peeling' }, { tiradaEm: '2026-11-04T15:00:00Z', servicoNome: 'Peeling' }])
  .map(g => g.data)).toEqual(['2026-11-04', '2026-11-03'])
// fotos.test.ts (ações)
// registrarFotos(C, [{ path: `clientes/${OUTRA}/fotos/${U}.jpg`, tipo: 'antes' }]) → { ok: false, erro: 'Foto inválida.' } e nenhum insert
// registrarFotos(C, [{ path: `clientes/${C}/fotos/${U}.jpg`, tipo: 'antes', servicoId: S }]) → insert em 'fotos' com { cliente_id: C, path, tipo: 'antes', servico_id: S }
// insert com erro → admin storage remove([path])
// recepção → rejects 'REDIRECT:/inicio'; 21 itens → erro sem insert
// urlsFotos: rpc registrar_acesso chamada uma vez por foto antes de createSignedUrls(paths, 300)
// arquivarFoto: profissional → REDIRECT; dona → update { arquivada: true }; 0 linhas → 'Foto não encontrada.'
```

- [ ] **Step 2:** Run `pnpm test` — Expected: FAIL.
- [ ] **Step 3:** Implementar domínio, conversor, ações, carga da aba e telas.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5:** Verificar com `pnpm dev` (1024 px e 390 px): um JPEG de 6000×4000 vira arquivo ≤ 5 MB com 2560 px (Network → tamanho do upload); comparar duas fotos lado a lado.
- [ ] **Step 6:** Commit: `feat(ficha): fotos antes/depois com envio direto, galeria e comparação`

---

### Task 7: Evoluções

**Files:**
- Create: `src/lib/dominio/evolucoes.ts` (+ teste), `src/app/(app)/clientes/ficha/{evolucoes.ts,evolucoes.test.ts}`, `src/features/ficha/evolucoes/{aba-evolucoes,campo-evolucao}.tsx`
- Modify: `src/app/(app)/clientes/ficha/dados.ts`, `src/app/(app)/clientes/[id]/page.tsx`, `src/features/agenda/cartao-agendamento.tsx` (`DetalhesAgendamento`)

**Interfaces:**
- Consumes: RLS e `evolucoes_guarda` (Task 1); `registrarAcesso`, `podeNaFicha` (Task 3).
- Produces:
  - `JANELA_EDICAO_HORAS = 24`; `podeEditarEvolucao(ev: { profissionalId: string; criadoEm: string }, colaboradorId: string, agora: Date): boolean`.
  - `adicionarEvolucao(agendamentoId: string, texto: string): Promise<{ ok: true; id: string } | { ok: false; erro: string }>` — `exigirPerfil('profissional')`; texto aparado 1–5000 ("Escreva a evolução." / "A evolução pode ter no máximo 5000 caracteres."); lê o agendamento (RLS; nulo → "Atendimento não encontrado.") para obter `cliente_id`; insert.
  - `editarEvolucao(id: string, texto: string): Promise<Resultado>` — `exigirPerfil('profissional')`; mesmas regras de texto; 0 linhas → "Evolução não encontrada."; `P0001` do banco repassado por `mensagemErroBanco`.
  - `evolucoesDoAtendimento(agendamentoId: string): Promise<{ ok: true; evolucoes: EvolucaoVista[] } | { ok: false; erro: string }>` — `exigirPerfil()`; lê o agendamento (cliente), `registrarAcesso({ entidade: 'evolucoes', clienteId })`, depois as evoluções do atendimento; `type EvolucaoVista = { id: string; texto: string; criadoEm: string; profissionalNome: string; editavel: boolean }`.
  - `carregarEvolucoes(supabase, clienteId, colaboradorId)` em `dados.ts` (registra antes): lista cronológica (mais recente primeiro) com serviço e data do atendimento.
  - Telas: aba **Evoluções** (lista; para a profissional, campo "Evolução / observações" com seletor dos atendimentos dela com a cliente, padrão o mais recente; "Editar" só quando `editavel`); no `DetalhesAgendamento` da agenda, seção "Evolução / observações" que carrega `evolucoesDoAtendimento` ao abrir e mostra o campo para a profissional do atendimento.

- [ ] **Step 1: Testes que falham**

```ts
const ev = { profissionalId: 'p1', criadoEm: '2026-11-03T13:00:00Z' }
expect(podeEditarEvolucao(ev, 'p1', new Date('2026-11-04T12:59:00Z'))).toBe(true)
expect(podeEditarEvolucao(ev, 'p1', new Date('2026-11-04T13:01:00Z'))).toBe(false)
expect(podeEditarEvolucao(ev, 'p2', new Date('2026-11-03T14:00:00Z'))).toBe(false)
// ações
// adicionarEvolucao como recepção/dona → REDIRECT '/inicio'; texto '  ' → 'Escreva a evolução.' sem insert
// ok → insert { agendamento_id: AG, cliente_id: <do agendamento>, texto } e { ok: true, id }
// editarEvolucao com P0001 'A evolução só pode ser editada pela autora em até 24 horas' → mesma mensagem
// evolucoesDoAtendimento: rpc registrar_acesso { p_entidade: 'evolucoes', p_cliente } antes do select de 'evolucoes'
```

- [ ] **Step 2:** Run `pnpm test` — Expected: FAIL.
- [ ] **Step 3:** Implementar. **Step 4:** Run `pnpm test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ficha): evoluções da profissional na ficha e no atendimento`

---

### Task 8: Pagamento dividido

**Files:**
- Create: `src/lib/dominio/cobranca.ts` (+ teste), `src/features/caixa/editor-partes.tsx`
- Modify: `src/app/(app)/caixa/{schemas.ts,actions.ts,actions.test.ts,page.tsx}`, `src/features/caixa/{dialogo-pagamento.tsx,painel-caixa.tsx}`, `src/lib/erros-db.ts` (+ teste), `src/features/agenda/cartao-agendamento.tsx`, `e2e/caixa.spec.ts`

**Interfaces:**
- Consumes: `registrar_cobranca`, `cobrancas`, `pagamentos.cobranca_id` (Task 2); `FormaPagamento`, `formaParcelada`, `gerarParcelas`, `MAX_PARCELAS`, `resumoCaixa`, `formatarBRL`, `parseBRL`.
- Produces:
  - `MAX_PARTES = 4`; `type ParteCobranca = { forma: FormaPagamento; valorCentavos: number; parcelas: number; primeiroVencimento?: string }`.
  - `saldoCobranca(liquidoCentavos: number, valoresCentavos: (number | null)[]): { pagoCentavos: number; faltaCentavos: number; sobraCentavos: number; fecha: boolean }` — `null` (campo inválido) conta 0 e impede `fecha`.
  - `erroDasPartes(liquidoCentavos: number, partes: ParteCobranca[]): string | null` — mesmas mensagens do banco ("Informe de 1 a 4 formas de pagamento.", "Cada forma de pagamento deve ter valor maior que zero.", "A soma das formas de pagamento deve ser igual ao total com desconto.") + "Informe de 2 a 12 parcelas." e "Informe o primeiro vencimento.".
  - `valorSugeridoNovaParte(liquidoCentavos: number, valoresCentavos: (number | null)[]): number` — o que falta (≥ 0).
  - `type PartePagamentoRpc = { forma: FormaPagamento; valor_centavos: number; parcelas: number; vencimentos: string[] | null; valores_parcelas: number[] | null }`; `partesParaRpc(partes: ParteCobranca[]): PartePagamentoRpc[]` — `a_receber` com `gerarParcelas`; formas não parceladas com `parcelas: 1`.
  - `cobrancaSchema` (zod) → `{ agendamentoId: string; desconto: number; partes: ParteCobranca[] }` a partir de `{ agendamentoId; desconto: string; partes: { forma; valor: string; parcelas: number; primeiroVencimento?: string }[] }` (textos com `parseBRL`, mesmas mensagens da Fase 1); `type CobrancaInput = z.input<typeof cobrancaSchema>`; também exporta `partesSchema` (reutilizado pela venda de pacote na Task 9).
  - `registrarCobranca(dados: CobrancaInput): Promise<Resultado>` — **substitui** `registrarPagamento` (removida, com seus testes reescritos): `exigirPerfil('dona','recepcao')`; lê o agendamento (`status`, `valor_previsto_centavos`, `pacote_vendido_id`); não atendido → "Só é possível lançar pagamento de atendimento concluído."; com pacote → "Sessão de pacote: já paga na venda do pacote."; `erroDasPartes(valor_previsto − desconto, partes)`; RPC `registrar_cobranca` com `p_origem: 'agendamento'`, `p_pacote: null`, `p_partes: partesParaRpc(...)`; erros por `mensagemErroBanco`; `revalidatePath('/caixa' | '/agenda' | '/inicio')`.
  - `mensagemErroBanco`: `23505` com `cobrancas_agendamento_unico` → "Este atendimento já foi pago."; com `cobrancas_pacote_unico` → "Este pacote já foi pago." (sai a regra de `pagamentos_agendamento_unico`).
  - `type ParteEditavel = { forma: FormaPagamento; valor: string; parcelas: number; primeiroVencimento: string }`; `<EditorPartes liquidoCentavos partes onMudar={(p: ParteEditavel[]) => void} />` — uma linha por parte (forma, valor, parcelas quando `formaParcelada`, 1º vencimento e prévia das parcelas para `a_receber`, botão remover a partir da 2ª); "+ Adicionar outra forma" (some com 4 partes; nova linha vem com `valorSugeridoNovaParte`); rodapé "Falta R$ X" / "Sobra R$ X" / "Valor fechado" a partir de `saldoCobranca`.
  - `DialogoPagamento` (mesmo nome e `AtendimentoParaPagar`): total do atendimento **fixo** = `valorPrevistoCentavos` (o bruto vem do banco), campo "Desconto", `EditorPartes` com uma parte Pix pelo líquido; "Confirmar" só quando `saldoCobranca(...).fecha` e `erroDasPartes(...) === null`; mantém "Abrir caixa agora" e "Pagar depois".
  - Caixa: `type CobrancaPainel = { id: string; hora: string; clienteNome: string; origem: 'agendamento' | 'pacote' | 'venda_produto'; brutoCentavos: number; descontoCentavos: number; partes: { forma: FormaPagamento; parcelas: number; valorCentavos: number; descontoCentavos: number }[] }` substitui `LancamentoPainel`; `/caixa` lê `cobrancas` com `pagamentos(...)` do caixa aberto e lista cada cobrança com suas partes; `resumoCaixa` recebe as partes achatadas (resultado igual ao da Fase 1).
  - `e2e/caixa.spec.ts`: a limpeza apaga `contas_receber`, `pagamentos` e depois `cobrancas` do caixa de hoje, nessa ordem.

- [ ] **Step 1: Testes que falham**

```ts
// cobranca.test.ts (Review Focus 5)
expect(saldoCobranca(10000, [3334, 3333, 3333])).toEqual({ pagoCentavos: 10000, faltaCentavos: 0, sobraCentavos: 0, fecha: true })
expect(saldoCobranca(10000, [5000, 4999])).toMatchObject({ faltaCentavos: 1, fecha: false })
expect(saldoCobranca(10000, [6000, 5000])).toMatchObject({ sobraCentavos: 1000, fecha: false })
expect(saldoCobranca(10000, [10000, null]).fecha).toBe(false)
expect(valorSugeridoNovaParte(10000, [6000])).toBe(4000)
expect(erroDasPartes(10000, Array(5).fill({ forma: 'pix', valorCentavos: 2000, parcelas: 1 }))).toBe('Informe de 1 a 4 formas de pagamento.')
expect(erroDasPartes(10000, [{ forma: 'pix', valorCentavos: 10000, parcelas: 1 }, { forma: 'dinheiro', valorCentavos: 0, parcelas: 1 }])).toBe('Cada forma de pagamento deve ter valor maior que zero.')
expect(erroDasPartes(10000, [{ forma: 'pix', valorCentavos: 9999, parcelas: 1 }])).toBe('A soma das formas de pagamento deve ser igual ao total com desconto.')
expect(partesParaRpc([{ forma: 'a_receber', valorCentavos: 3000, parcelas: 3, primeiroVencimento: '2026-12-03' }])).toEqual([{
  forma: 'a_receber', valor_centavos: 3000, parcelas: 3, vencimentos: ['2026-12-03', '2027-01-03', '2027-02-03'], valores_parcelas: [1000, 1000, 1000] }])
expect(partesParaRpc([{ forma: 'pix', valorCentavos: 100, parcelas: 1 }])[0]).toMatchObject({ vencimentos: null, valores_parcelas: null })
// erros-db.test.ts (Review Focus 1)
expect(mensagemErroBanco({ code: '23505', message: 'duplicate key value violates unique constraint "cobrancas_agendamento_unico"' })).toBe('Este atendimento já foi pago.')
expect(mensagemErroBanco({ code: '23505', message: '... "cobrancas_pacote_unico"' })).toBe('Este pacote já foi pago.')
// caixa/actions.test.ts (registrarCobranca)
// Pix "60,00" + Dinheiro "30,00", desconto "10,00", valor previsto 10000 → rpc registrar_cobranca com
//   { p_origem: 'agendamento', p_agendamento: AG, p_pacote: null, p_desconto_centavos: 1000,
//     p_partes: [{ forma: 'pix', valor_centavos: 6000, parcelas: 1, vencimentos: null, valores_parcelas: null }, { forma: 'dinheiro', valor_centavos: 3000, ... }] }
// soma errada → erro 'A soma das formas de pagamento deve ser igual ao total com desconto.' e nenhuma RPC
// agendamento com pacote_vendido_id → 'Sessão de pacote: já paga na venda do pacote.'; status confirmado → 'Só é possível lançar pagamento de atendimento concluído.'
// rpc com 23505 cobrancas_agendamento_unico → { ok: false, erro: 'Este atendimento já foi pago.' }
// profissional → REDIRECT '/inicio'
```

- [ ] **Step 2:** Run `pnpm test` — Expected: FAIL.
- [ ] **Step 3:** Implementar domínio, schema, ação, `EditorPartes`, diálogo, painel do caixa e a limpeza do E2E.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm lint` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(caixa): cobrança com pagamento dividido em até 4 formas`

---

### Task 9: Pacotes na ficha e na agenda

**Files:**
- Create: `src/lib/dominio/pacotes.ts` (+ teste), `src/app/(app)/clientes/ficha/{pacotes.ts,pacotes.test.ts,schemas.ts}`, `src/features/ficha/pacotes/{aba-pacotes,dialogo-venda-pacote}.tsx`
- Modify: `src/app/(app)/clientes/ficha/dados.ts`, `src/app/(app)/clientes/[id]/page.tsx`, `src/app/(app)/agenda/{schemas.ts,actions.ts,actions.test.ts,dados.ts}`, `src/features/agenda/{dados-agenda.ts,dados-agenda.test.ts,dialogo-agendamento.tsx,cartao-agendamento.tsx}`

**Interfaces:**
- Consumes: `vender_pacote`, `cancelar_pacote`, `expirar_pacotes`, triggers de pacote (Task 2); `partesSchema`, `partesParaRpc`, `erroDasPartes`, `saldoCobranca`, `EditorPartes` (Task 8); `podeNaFicha`.
- Produces:
  - `type StatusPacote = 'ativo' | 'concluido' | 'expirado' | 'cancelado'`; `ROTULO_STATUS_PACOTE` ("Ativo", "Concluído", "Expirado", "Cancelado"); `MAX_SESSOES = 50`.
  - `sugestaoValorPacote(precoCentavos: number, sessoes: number): number`; `progressoPacote(usadas: number, total: number): { restantes: number; percentual: number }` (inteiro arredondado).
  - `type PacoteResumo = { id: string; servicoId: string; status: StatusPacote; validade: string | null; sessoesUsadas: number; totalSessoes: number }`; `statusEfetivoPacote(p: PacoteResumo, hoje: string): StatusPacote` — `ativo` com `validade < hoje` e sessões restantes → `expirado` (validade = hoje ainda vale); `pacoteUtilizavel(p: PacoteResumo, servicoId: string, hoje: string): boolean`.
  - `vendaPacoteSchema` → `{ clienteId; servicoId; sessoes: 1..50 ("Informe de 1 a 50 sessões."); valorTotal: centavos > 0; validade: string | null (≥ hoje: "A validade não pode ser anterior a hoje."); desconto; partes }`; `type VendaPacoteInput = z.input<typeof vendaPacoteSchema>`.
  - `venderPacote(dados: VendaPacoteInput): Promise<{ ok: true; id: string } | { ok: false; erro: string }>` — `exigirPerfil('dona','recepcao')`; `erroDasPartes(valorTotal − desconto, partes)`; RPC `vender_pacote`.
  - `cancelarPacote(id: string): Promise<Resultado>` — `exigirPerfil('dona')`; RPC `cancelar_pacote`.
  - `pacotesDisponiveis(clienteId: string, servicoId: string): Promise<{ id: string; restantes: number; validade: string | null }[]>` — `exigirPerfil('dona','recepcao')`; chama `expirar_pacotes` e devolve os `pacoteUtilizavel`.
  - `carregarPacotes(supabase, clienteId)` em `dados.ts`: `expirar_pacotes` (falha ignorada) e lista com serviço, progresso, validade e `statusEfetivoPacote`.
  - `agendamentoSchema` ganha `pacoteVendidoId: z.uuid().nullable().optional()`; `salvarAgendamento` grava `pacote_vendido_id` (o banco valida cliente/serviço/ativo; `P0001` repassado).
  - `alterarStatus`: `abrirPagamento = para === 'atendido' && perfil !== 'profissional' && !pacote_vendido_id` (lido junto com o status).
  - `AgendamentoAgenda.pacote: { usadas: number; total: number } | null`; cartão mostra "Pacote 3/10".
  - Telas: aba **Pacotes** (todos os perfis da aba): lista com barra de progresso (usadas/total), validade e status efetivo; "Vender pacote" (`podeNaFicha(perfil,'vender_pacote')`) → diálogo com serviço, nº de sessões, valor total (sugestão `sugestaoValorPacote`, editável), validade opcional, depois desconto + `EditorPartes` (exige caixa aberto, mesma oferta "Abrir caixa agora" do diálogo de pagamento) → `venderPacote`; "Cancelar pacote" só dona, com confirmação. Diálogo de agendamento: escolhida cliente + serviço com pacote disponível, aparece "Usar sessão do pacote (restam N)" marcada por padrão.

- [ ] **Step 1: Testes que falham**

```ts
// pacotes.test.ts
const p = { id: 'p', servicoId: 's', status: 'ativo', validade: '2026-11-03', sessoesUsadas: 2, totalSessoes: 10 } as const
expect(statusEfetivoPacote(p, '2026-11-04')).toBe('expirado')
expect(statusEfetivoPacote({ ...p, validade: '2026-11-04' }, '2026-11-04')).toBe('ativo')
expect(statusEfetivoPacote({ ...p, validade: null }, '2030-01-01')).toBe('ativo')
expect(statusEfetivoPacote({ ...p, status: 'concluido', sessoesUsadas: 10 }, '2026-11-04')).toBe('concluido')
expect(pacoteUtilizavel({ ...p, validade: null }, 'outro', '2026-11-04')).toBe(false)
expect(progressoPacote(3, 10)).toEqual({ restantes: 7, percentual: 30 })
expect(sugestaoValorPacote(25000, 4)).toBe(100000)
// pacotes.test.ts (ações)
// venderPacote (recepção, 4 sessões, '1.000,00', partes Pix '600,00' + Crédito parcelado '400,00' 2x) → rpc vender_pacote
//   { p_cliente, p_servico, p_total_sessoes: 4, p_valor_total_centavos: 100000, p_validade: null, p_desconto_centavos: 0, p_partes: [...] }
// sessoes 51 → 'Informe de 1 a 50 sessões.' sem RPC; profissional → REDIRECT; cancelarPacote como recepção → REDIRECT
// agenda/actions.test.ts
// salvarAgendamento({ ..., pacoteVendidoId: P }) → insert com pacote_vendido_id: P
// alterarStatus(id, 'atendido') com pacote_vendido_id preenchido → { ok: true, abrirPagamento: false, termoPendente: false }
// dados-agenda.test.ts: agendamento com pacote (usadas 3, total 10) → pacote: { usadas: 3, total: 10 }
```

- [ ] **Step 2:** Run `pnpm test` — Expected: FAIL.
- [ ] **Step 3:** Implementar. **Step 4:** Run `pnpm test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ficha): pacotes de sessões com venda dividida e uso na agenda`

---

### Task 10: Registro de acessos e exportação dos dados da cliente

**Files:**
- Create: `src/app/(app)/configuracoes/acessos/page.tsx`, `src/app/(app)/clientes/ficha/{exportacao.ts,exportacao.test.ts}`, `src/app/(app)/clientes/[id]/exportar/route.ts` (+ `route.test.ts`)
- Modify: `src/app/(app)/configuracoes/page.tsx` (link "Registro de acessos"), `src/app/(app)/clientes/[id]/page.tsx` (botões da dona)

**Interfaces:**
- Consumes: `auditoria` e `registrar_acesso('exportacao', ...)` (Task 1); todas as tabelas da ficha (Tasks 1–2); `BUCKET_FICHA`; `fflate` (`Zip`, `ZipDeflate`, `ZipPassThrough`).
- Produces:
  - `ROTULO_ACAO: Record<'visualizou' | 'criou' | 'alterou' | 'arquivou', string>` ("Visualizou", "Criou", "Alterou", "Arquivou") e `ROTULO_ENTIDADE` ("Anamnese", "Termo assinado", "Foto", "Evolução", "Exportação") no próprio `page.tsx`.
  - `/configuracoes/acessos?cliente=<id>&pagina=<n>` — `exigirPerfil('dona')`; 100 por página, mais recentes primeiro: data/hora (São Paulo), colaboradora, ação, o quê, cliente (link). Na ficha, a dona vê "Registro de acessos" (link já filtrado) e "Exportar dados da cliente".
  - `nomeArquivoExportacao(nome: string, hoje: string): string` — `madame-fe-<slug sem acento>-<yyyy-mm-dd>.zip`.
  - `type ArquivoExportado = { noZip: string; noStorage: string }`; `arquivosDaExportacao(l: { anamneses: { id; assinatura_path }[]; termos: { id; pdf_path; assinatura_path }[]; fotos: { id; path }[] }): ArquivoExportado[]` — `anamneses/<id>-assinatura.png`, `termos/<id>.pdf`, `termos/<id>-assinatura.png`, `fotos/<id>.jpg`.
  - `gerarZipExportacao(supabase: Supabase, clienteId: string): Promise<{ nome: string; corpo: ReadableStream<Uint8Array> }>` — `registrarAcesso({ entidade: 'exportacao', clienteId })` antes de tudo; `dados.json` (cliente, agendamentos, anamneses com as perguntas da própria versão, termos, fotos com arquivadas, evoluções, pacotes, cobranças com partes; chaves em português, datas ISO) comprimido com `ZipDeflate`; arquivos baixados um a um (`storage.download`) e escritos com `ZipPassThrough`; arquivo que falhar ao baixar entra em `dados.json` → `arquivos_indisponiveis` em vez de abortar.
  - `GET /clientes/[id]/exportar` — `exigirPerfil('dona')`; id inválido → 404; cliente não encontrada → 404; responde `200` com `Content-Type: application/zip` e `Content-Disposition: attachment; filename="<nome>"`, corpo em streaming (sem montar o ZIP inteiro na memória nem bater no limite de resposta da Vercel).

- [ ] **Step 1: Testes que falham**

```ts
expect(nomeArquivoExportacao('Ana Lúcia de Souza', '2026-11-04')).toBe('madame-fe-ana-lucia-de-souza-2026-11-04.zip')
expect(arquivosDaExportacao({ anamneses: [{ id: 'A1', assinatura_path: 'p1' }], termos: [{ id: 'T1', pdf_path: 'p2', assinatura_path: 'p3' }], fotos: [{ id: 'F1', path: 'p4' }] }))
  .toEqual([{ noZip: 'anamneses/A1-assinatura.png', noStorage: 'p1' }, { noZip: 'termos/T1.pdf', noStorage: 'p2' },
            { noZip: 'termos/T1-assinatura.png', noStorage: 'p3' }, { noZip: 'fotos/F1.jpg', noStorage: 'p4' }])
// route.test.ts (supabase-falso: tabelas da ficha enfileiradas, storage download devolve Blob)
const res = await GET(new Request('http://x/clientes/C/exportar'), { params: Promise.resolve({ id: C }) })
expect(res.headers.get('content-type')).toBe('application/zip')
expect(res.headers.get('content-disposition')).toBe('attachment; filename="madame-fe-ana-souza-<hoje>.zip"')
const zip = unzipSync(new Uint8Array(await res.arrayBuffer()))
expect(Object.keys(zip).sort()).toEqual(['anamneses/A1-assinatura.png', 'dados.json', 'fotos/F1.jpg', 'termos/T1-assinatura.png', 'termos/T1.pdf'])
expect(JSON.parse(strFromU8(zip['dados.json'])).cliente.nome).toBe('Ana Souza')
// rpc registrar_acesso { p_entidade: 'exportacao', p_entidade_id: null, p_cliente: C } é a primeira chamada depois do select da cliente
// download de F1 com erro → zip sem fotos/F1.jpg e dados.json.arquivos_indisponiveis = ['fotos/F1.jpg']
// recepção → rejects 'REDIRECT:/inicio'; id 'abc' → status 404
```

- [ ] **Step 2:** Run `pnpm test` — Expected: FAIL.
- [ ] **Step 3:** Implementar página, exportação e rota. **Step 4:** Run `pnpm test && pnpm typecheck` — Expected: PASS.
- [ ] **Step 5:** Commit: `feat(ficha): registro de acessos e exportação dos dados da cliente`

---

### Task 11: Testes de tela e implantação das migrações no projeto de testes

**Files:**
- Create: `e2e/ficha.spec.ts`, `e2e/cobranca.spec.ts`, `e2e/fixtures/foto-1.jpg`, `e2e/fixtures/foto-2.jpg` (geradas com `sharp`, 1200×900, < 200 KB)
- Modify: `e2e/auth.setup.ts` (fixtures novos: serviço com termo, cliente vinculada à profissional), `docs/implantacao.md`, `README.md` (comandos), `src/lib/supabase/tipos.ts` (só se o diff do Step 5 apontar diferença)

**Interfaces:**
- Consumes: todas as telas das Tasks 3–10; `pularSemBackend`, `USUARIOS`, `AMBIENTE` (`e2e/suporte.ts`); ferramenta MCP `apply_migration` do Supabase.
- Produces: specs que pulam sem `E2E_PERMITIR_PROJETO` e, com ele, rodam contra `myfpjwtmfonuvsrsvato`; migrações 0006/0007 aplicadas **só** no projeto de testes; guia atualizado.

- [ ] **Step 1: Escrever `e2e/ficha.spec.ts`** (projetos `computador` e `tablet`; `celular` só a comparação): recepção abre a ficha → "Preencher anamnese" → modo tablet sem menu → responde as obrigatórias (gestante "Sim") → desenha a assinatura com `page.mouse` (down/move/up em 3 pontos do canvas) → "Confirmar" → volta à aba Anamnese com "⚠ Atenção" e "Está grávida ou amamentando?"; colher termo pelo botão "Termo pendente" de um atendimento → assinatura + "Li e concordo" → aba Termos lista o termo e "Abrir PDF" abre URL com `token=` que responde `application/pdf`; profissional adiciona `foto-1.jpg` (antes) e `foto-2.jpg` (depois) pela "Galeria" (`setInputFiles`) → "Comparar" mostra as duas imagens visíveis lado a lado (1024) / empilhadas (390); recepção não vê a aba "Fotos"; dona vê "Registro de acessos" com linhas "Visualizou · Anamnese".
- [ ] **Step 2: Escrever `e2e/cobranca.spec.ts`** (só `computador`, serial, mesma limpeza de caixa da Task 8): recepção marca "Atendido" → diálogo mostra o total → troca a forma para Pix com valor menor → "Falta R$ 30,00" e "Confirmar" desabilitado → "+ Adicionar outra forma" (Dinheiro, valor sugerido R$ 30,00) → "Valor fechado" → Confirmar → `/caixa` lista a cobrança com as duas partes e o resumo por forma; nova tentativa de pagar o mesmo atendimento não aparece mais ("sem pagamento" some).
- [ ] **Step 3:** Run `pnpm e2e` sem variáveis — Expected: specs novos **pulados** com a mensagem da guarda; `visual.spec.ts` PASS.
- [ ] **Step 4: Aplicar as migrações no projeto de testes** com a ferramenta MCP `apply_migration` (`project_id: "myfpjwtmfonuvsrsvato"`; `name: "0006_ficha_clinica"`, `query` = conteúdo exato do arquivo; depois `name: "0007_pacotes_cobranca"`). **Nunca** use `vxvrzhskytsbreexnbun` nem `shim.sql`. Conferir com `list_migrations` (0006 e 0007 presentes) e `execute_sql`:
  - `select id, public, file_size_limit from storage.buckets where id = 'ficha-clinica'` → `public = false`, `5242880`;
  - `select (select count(*) from pagamentos) = (select count(*) from pagamentos where cobranca_id is not null)` → `true`;
  - `select count(*) from pg_policies where schemaname = 'storage' and policyname like 'ficha_clinica_%'` → `2`;
  - `select versao, ativo from modelos_anamnese` → `1, true`.
- [ ] **Step 5:** `get_advisors` (`type: "security"` e `"performance"`) no projeto de testes — Expected: nenhum aviso novo de nível ERROR para as tabelas/funções da Fase 2 (corrigir em migração `0008_*` se houver). `generate_typescript_types` do projeto de testes e comparar o schema `public` com `tipos.ts`; ajustar diferenças.
- [ ] **Step 6:** Run `pnpm e2e` com `NEXT_PUBLIC_SUPABASE_URL=https://myfpjwtmfonuvsrsvato.supabase.co`, as chaves do projeto de testes e `E2E_PERMITIR_PROJETO=myfpjwtmfonuvsrsvato` — Expected: `agenda`, `caixa`, `permissoes`, `ficha`, `cobranca` PASS. (Sem a `service_role key` do projeto de testes no ambiente, registrar no relatório que este passo ficou para quem tiver a chave.)
- [ ] **Step 7: Atualizar `docs/implantacao.md`**: parte 2 lista as migrações 0001–0007 na ordem; nova seção "Fase 2 — ficha clínica, pacotes e pagamento dividido" com: o que 0006/0007 criam (inclusive o bucket privado `ficha-clinica`, criado pela própria migração — não criar à mão nem torná-lo público), que 0007 converte cada pagamento antigo em uma cobrança (resultado do caixa não muda), estado atual ("aplicadas no projeto de testes em 2026-11-04; produção ainda não"), e o passo manual da produção: backup/ponto de restauração, aplicar 0006 e depois 0007 (SQL Editor ou `pnpm supabase link --project-ref vxvrzhskytsbreexnbun && pnpm supabase db push`), rodar as 4 consultas de conferência do Step 4, revisar os textos do modelo de anamnese e do termo genérico com a clínica; lista de conferência pós-deploy com "0006 e 0007 aplicadas na produção" e "bucket `ficha-clinica` privado". Atualizar `README.md` se os comandos mudaram.
- [ ] **Step 8:** Run final: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:db && pnpm build` — Expected: tudo PASS.
- [ ] **Step 9:** Commit: `test(e2e): ficha clínica e pagamento dividido; migrações da Fase 2 no projeto de testes`
