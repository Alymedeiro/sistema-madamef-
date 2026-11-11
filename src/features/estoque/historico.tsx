import type { ReactNode } from "react";
import type { MovimentoDoEstoque } from "@/app/(app)/produtos/dados-estoque";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarQuantidade } from "@/lib/dominio/catalogo";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { ROTULO_TIPO_MOVIMENTO } from "@/lib/dominio/estoque";
import { dataBr } from "@/lib/dominio/financeiro";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";

/** +1,5 ml (verde) / −0,5 ml (vermelho). */
export function QuantidadeComSinal({ quantidade, unidade }: { quantidade: number; unidade: string }) {
  const positiva = quantidade > 0;
  return (
    <span className={cn("tabular-nums whitespace-nowrap", positiva ? "text-emerald-800" : "text-destructive")}>
      {positiva ? "+" : "−"}
      {formatarQuantidade(Math.abs(quantidade))} {unidade}
    </span>
  );
}

/** Motivo do ajuste, atendimento da baixa/estorno ou nada. */
function detalhe(m: MovimentoDoEstoque): string {
  if (m.atendimento) return `Atendimento de ${dataBr(m.atendimento.data)} — ${m.atendimento.clienteNome}`;
  return m.motivo ?? "";
}

const custo = (m: MovimentoDoEstoque) =>
  m.custoCentavos === null ? "—" : `${formatarBRL(m.custoCentavos)}/${m.unidade}`;

const quando = (m: MovimentoDoEstoque) => formatarNoFuso(m.criadoEm, "dd/MM/yyyy HH:mm");

/** Filtro do histórico (GET, sem JS): produto e período. Mantém a aba. */
export function FiltroHistorico({
  produtos,
  produtoId,
  de,
  ate,
}: {
  produtos: { id: string; nome: string }[];
  produtoId: string | null;
  de: string;
  ate: string;
}) {
  return (
    <form method="get" action="/produtos" role="search" className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="aba" value="estoque" />
      <label className="flex flex-col gap-1 text-sm">
        Produto
        <Select name="produto" defaultValue={produtoId ?? ""} className="w-56">
          <option value="">Todos os produtos</option>
          {produtos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        De
        <input
          type="date"
          name="de"
          required
          defaultValue={de}
          className="min-h-11 rounded-md border bg-card px-3"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Até
        <input
          type="date"
          name="ate"
          required
          defaultValue={ate}
          className="min-h-11 rounded-md border bg-card px-3"
        />
      </label>
      <Button type="submit" variant="outline">
        Filtrar
      </Button>
    </form>
  );
}

/** Histórico de movimentos (mais recentes primeiro). `comProduto` mostra a coluna do produto. */
export function HistoricoEstoque({
  movimentos,
  limitado,
  comProduto = true,
  titulo = "Histórico",
  vazio = "Nenhum movimento no período.",
  children,
}: {
  movimentos: MovimentoDoEstoque[];
  limitado: boolean;
  comProduto?: boolean;
  titulo?: string;
  vazio?: string;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby="estoque-historico-t"
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="estoque-historico-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
          {titulo}
        </h2>
        <p className="text-sm text-muted-foreground">
          {movimentos.length === 1 ? "1 movimento" : `${movimentos.length} movimentos`}
        </p>
      </div>
      {children}
      {limitado && (
        <p role="status" className="text-sm text-muted-foreground">
          Mostrando os {movimentos.length} mais recentes — refine o filtro.
        </p>
      )}
      {movimentos.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{vazio}</p>
      ) : (
        <>
          {/* Celular: cartões */}
          <ul className="flex flex-col gap-2 md:hidden">
            {movimentos.map((m) => (
              <li key={m.id} data-testid="movimento" className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 font-medium break-words">
                    {comProduto ? m.produtoNome : ROTULO_TIPO_MOVIMENTO[m.tipo]}
                  </span>
                  <QuantidadeComSinal quantidade={m.quantidade} unidade={m.unidade} />
                </div>
                <p className="text-muted-foreground">
                  {quando(m)}
                  {comProduto && ` · ${ROTULO_TIPO_MOVIMENTO[m.tipo]}`}
                  {m.custoCentavos !== null && ` · ${custo(m)}`}
                </p>
                {detalhe(m) && <p className="break-words">{detalhe(m)}</p>}
                {m.responsavelNome && <p className="text-muted-foreground">Por {m.responsavelNome}</p>}
              </li>
            ))}
          </ul>

          {/* Tablet e computador: tabela */}
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  {comProduto && <TableHead>Produto</TableHead>}
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Quantidade</TableHead>
                  <TableHead className="text-right">Custo</TableHead>
                  <TableHead>Detalhe</TableHead>
                  <TableHead>Responsável</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movimentos.map((m) => (
                  <TableRow key={m.id} data-testid="movimento">
                    <TableCell className="tabular-nums whitespace-nowrap">{quando(m)}</TableCell>
                    {comProduto && <TableCell className="font-medium">{m.produtoNome}</TableCell>}
                    <TableCell className="whitespace-nowrap">{ROTULO_TIPO_MOVIMENTO[m.tipo]}</TableCell>
                    <TableCell className="text-right">
                      <QuantidadeComSinal quantidade={m.quantidade} unidade={m.unidade} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums whitespace-nowrap">{custo(m)}</TableCell>
                    <TableCell className="max-w-64 whitespace-normal break-words">{detalhe(m) || "—"}</TableCell>
                    <TableCell>{m.responsavelNome ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
