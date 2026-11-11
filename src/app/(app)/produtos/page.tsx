import Link from "next/link";
import { Pencil, Plus, TriangleAlert } from "lucide-react";
import { BotaoAtivoItem } from "@/features/catalogo/botao-ativo-item";
import { AbaEstoque, AbasProdutos } from "@/features/estoque/aba-estoque";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { estoqueBaixo, formatarQuantidade } from "@/lib/dominio/catalogo";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { abaDeProdutos, abasDeProdutos, perfisComAcesso } from "@/lib/dominio/permissoes";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { idSchema } from "@/lib/validacao";
import { carregarEstoque, periodoDoEstoque } from "./dados-estoque";

export const metadata = { title: "Produtos | Madame Fê Clinic" };

type Produto = {
  id: string;
  nome: string;
  unidade: string;
  preco_venda_centavos: number | null;
  estoque_atual: number;
  estoque_minimo: number;
  ativo: boolean;
};

function Estoque({ p }: { p: Produto }) {
  const baixo = p.ativo && estoqueBaixo(p.estoque_atual, p.estoque_minimo);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className={cn(baixo && "font-semibold text-destructive")}>
        {formatarQuantidade(p.estoque_atual)} {p.unidade}
      </span>
      {baixo ? (
        <Badge variant="destructive">
          <TriangleAlert aria-hidden />
          Estoque baixo
        </Badge>
      ) : null}
    </span>
  );
}

function Cabecalho({ ehDona }: { ehDona: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">Produtos</h1>
      {ehDona ? (
        <Button asChild>
          <Link href="/produtos/novo">
            <Plus aria-hidden />
            Novo produto
          </Link>
        </Button>
      ) : null}
    </div>
  );
}

function Acoes({ p }: { p: Produto }) {
  return (
    <>
      <Button asChild variant="outline" size="sm">
        <Link href={`/produtos/${p.id}`}>
          <Pencil aria-hidden />
          Editar<span className="sr-only"> {p.nome}</span>
        </Link>
      </Button>
      <BotaoAtivoItem tipo="produto" id={p.id} nome={p.nome} ativo={p.ativo} />
    </>
  );
}

type Parametro = string | string[] | undefined;
const primeiro = (v: Parametro) => (Array.isArray(v) ? v[0] : v);

export default async function ProdutosPage({
  searchParams,
}: {
  searchParams: Promise<Record<"aba" | "produto" | "de" | "ate", Parametro>>;
}) {
  // Todos consultam; só a dona edita e só ela vê o custo (R10) e o estoque.
  const { colaborador } = await exigirPerfil(...perfisComAcesso("produtos"));
  const ehDona = colaborador.perfil === "dona";
  const sp = await searchParams;
  // Recepção/profissional: sempre a lista, sem abas.
  const aba = abaDeProdutos(colaborador.perfil, primeiro(sp.aba));
  const abas = abasDeProdutos(colaborador.perfil);

  const supabase = await createClient();

  if (aba === "estoque") {
    const agora = new Date();
    const pedido = primeiro(sp.produto);
    const produtoId = pedido && idSchema.safeParse(pedido).success ? pedido : null;
    const periodo = periodoDoEstoque({ de: primeiro(sp.de), ate: primeiro(sp.ate) }, agora);
    const dados = await carregarEstoque(supabase, { produtoId, ...periodo });
    return (
      <div className="flex flex-col gap-6">
        <Cabecalho ehDona />
        <AbasProdutos abas={abas} atual={aba} />
        <AbaEstoque dados={dados} produtoId={produtoId} {...periodo} hoje={dataNoFuso(agora)} />
      </div>
    );
  }

  let consultaProdutos = supabase
    .from("produtos")
    .select("id, nome, unidade, preco_venda_centavos, estoque_atual, estoque_minimo, ativo")
    .order("nome", { ascending: true });
  if (!ehDona) consultaProdutos = consultaProdutos.eq("ativo", true);

  // O custo só é consultado para a dona: para os outros perfis o RLS devolveria vazio.
  const [produtosRes, custosRes] = await Promise.all([
    consultaProdutos,
    ehDona
      ? supabase.from("produtos_custos").select("produto_id, custo_unitario_centavos")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (produtosRes.error) {
    throw new Error(`Falha ao carregar os produtos: ${produtosRes.error.message}`);
  }
  if (custosRes.error) throw new Error(`Falha ao carregar os custos: ${custosRes.error.message}`);

  const produtos: Produto[] = (produtosRes.data ?? []).sort(
    (a, b) => Number(b.ativo) - Number(a.ativo),
  );
  const custos = new Map((custosRes.data ?? []).map((c) => [c.produto_id, c.custo_unitario_centavos]));
  const custoDe = (id: string) => formatarBRL(custos.get(id) ?? 0);
  const precoDe = (p: Produto) =>
    p.preco_venda_centavos === null ? "—" : formatarBRL(p.preco_venda_centavos);

  return (
    <div className="flex flex-col gap-6">
      <Cabecalho ehDona={ehDona} />
      {abas.length > 1 ? <AbasProdutos abas={abas} atual={aba} /> : null}

      {produtos.length === 0 ? (
        <p className="text-muted-foreground">Nenhum produto cadastrado.</p>
      ) : (
        <>
          {/* Celular: cartões */}
          <ul className="flex flex-col gap-3 md:hidden">
            {produtos.map((p) => {
              const baixo = p.ativo && estoqueBaixo(p.estoque_atual, p.estoque_minimo);
              return (
                <li
                  key={p.id}
                  className={cn(
                    "flex flex-col gap-3 rounded-xl border bg-card p-4",
                    baixo && "border-destructive bg-destructive/5",
                    !p.ativo && "opacity-70",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium break-words">{p.nome}</p>
                    {!p.ativo ? <Badge variant="destructive">Inativo</Badge> : null}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Estoque atual</dt>
                      <dd>
                        <Estoque p={p} />
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Estoque mínimo</dt>
                      <dd>
                        {formatarQuantidade(p.estoque_minimo)} {p.unidade}
                      </dd>
                    </div>
                    {ehDona ? (
                      <div>
                        <dt className="text-muted-foreground">Custo por {p.unidade}</dt>
                        <dd>{custoDe(p.id)}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="text-muted-foreground">Preço de venda</dt>
                      <dd>{precoDe(p)}</dd>
                    </div>
                  </dl>
                  {ehDona ? (
                    <div className="flex flex-wrap gap-2">
                      <Acoes p={p} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {/* Tablet e computador: tabela */}
          <div className="hidden rounded-xl border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Produto</TableHead>
                  <TableHead>Unidade</TableHead>
                  {ehDona ? <TableHead>Custo</TableHead> : null}
                  <TableHead>Preço de venda</TableHead>
                  <TableHead>Estoque atual</TableHead>
                  <TableHead>Mínimo</TableHead>
                  {ehDona ? (
                    <TableHead>
                      <span className="sr-only">Ações</span>
                    </TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {produtos.map((p) => {
                  const baixo = p.ativo && estoqueBaixo(p.estoque_atual, p.estoque_minimo);
                  return (
                    <TableRow
                      key={p.id}
                      className={cn(baixo && "bg-destructive/5", !p.ativo && "opacity-70")}
                    >
                      <TableCell className="font-medium">
                        {p.nome}
                        {!p.ativo ? (
                          <Badge variant="destructive" className="ml-2">
                            Inativo
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>{p.unidade}</TableCell>
                      {ehDona ? <TableCell>{custoDe(p.id)}</TableCell> : null}
                      <TableCell>{precoDe(p)}</TableCell>
                      <TableCell>
                        <Estoque p={p} />
                      </TableCell>
                      <TableCell>{formatarQuantidade(p.estoque_minimo)}</TableCell>
                      {ehDona ? (
                        <TableCell>
                          <div className="flex justify-end gap-2">
                            <Acoes p={p} />
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
