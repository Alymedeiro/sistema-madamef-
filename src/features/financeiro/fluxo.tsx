import type { Fluxo } from "@/app/(app)/financeiro/dados-fluxo";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTULO_FORMA } from "@/lib/dominio/caixa";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { ROTULO_CATEGORIA } from "@/lib/dominio/financeiro";
import { cn } from "@/lib/utils";
import { GraficoFluxo, rotuloPeriodo } from "./grafico-fluxo";

const CLASSE_SECAO = "flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm";
const CLASSE_TITULO = "font-titulo text-lg font-semibold text-ouro-escuro";

function Valor({ centavos, sinal = false }: { centavos: number; sinal?: boolean }) {
  return (
    <span className={cn("tabular-nums whitespace-nowrap", sinal && centavos < 0 && "text-destructive")}>
      {centavos < 0 ? `-${formatarBRL(-centavos)}` : formatarBRL(centavos)}
    </span>
  );
}

function Totais({ titulo, itens }: { titulo: string; itens: { rotulo: string; total: number }[] }) {
  const id = `fluxo-${titulo.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className={CLASSE_SECAO}>
      <h2 id={id} className={CLASSE_TITULO}>
        {titulo}
      </h2>
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nada no período.</p>
      ) : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {itens.map((i) => (
            <div key={i.rotulo} className="contents">
              <dt className="text-muted-foreground">{i.rotulo}</dt>
              <dd className="text-right font-medium">
                <Valor centavos={i.total} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

/** Aba Fluxo de caixa (dona): gráfico, tabela por dia/mês e totais por forma e categoria. */
export function FluxoDeCaixa({ fluxo }: { fluxo: Fluxo }) {
  const { linhas, agrupar, totais } = fluxo;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="fluxo-t" className={CLASSE_SECAO}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="fluxo-t" className={CLASSE_TITULO}>
            Fluxo de caixa {agrupar === "mes" ? "por mês" : "por dia"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Entradas <Valor centavos={totais.entradas} /> · Saídas <Valor centavos={totais.saidas} /> · Saldo{" "}
            <strong className="text-foreground">
              <Valor centavos={totais.saldo} sinal />
            </strong>
          </p>
        </div>
        {linhas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nenhuma movimentação para mostrar neste período.
          </p>
        ) : (
          <>
            <GraficoFluxo linhas={linhas} agrupar={agrupar} totais={totais} />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{agrupar === "mes" ? "Mês" : "Dia"}</TableHead>
                  <TableHead className="text-right">Entradas</TableHead>
                  <TableHead className="text-right">Saídas</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Acumulado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {linhas.map((l) => (
                  <TableRow key={l.periodo} data-testid="linha-fluxo">
                    <TableCell className="tabular-nums">{rotuloPeriodo(l.periodo, agrupar)}</TableCell>
                    <TableCell className="text-right">
                      <Valor centavos={l.entradas} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Valor centavos={l.saidas} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Valor centavos={l.saldo} sinal />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Valor centavos={l.acumulado} sinal />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </section>
      <div className="grid gap-6 md:grid-cols-2">
        <Totais
          titulo="Entradas por forma de pagamento"
          itens={fluxo.porForma.map((f) => ({ rotulo: ROTULO_FORMA[f.forma], total: f.total }))}
        />
        <Totais
          titulo="Despesas por categoria"
          itens={fluxo.porCategoria.map((c) => ({ rotulo: ROTULO_CATEGORIA[c.categoria], total: c.total }))}
        />
      </div>
    </div>
  );
}
