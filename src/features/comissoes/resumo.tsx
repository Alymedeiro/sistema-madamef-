import type { LinhaResumo } from "@/app/(app)/financeiro/dados-comissoes";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { formatarCompetencia } from "@/lib/dominio/estoque";
import { BotaoPagarComissoes } from "./dialogo-pagar-comissoes";

/** Resumo por profissional e mês: atendimentos, base, a pagar e pago (sem as canceladas). */
export function ResumoComissoes({
  resumo,
  totais,
  hoje,
}: {
  resumo: LinhaResumo[];
  totais: { abertoCentavos: number; pagoCentavos: number };
  hoje: string;
}) {
  return (
    <section aria-labelledby="comissoes-resumo-t" className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="comissoes-resumo-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Comissões por profissional
        </h2>
        <p className="text-sm text-muted-foreground">
          A pagar{" "}
          <span className="font-semibold text-foreground tabular-nums">{formatarBRL(totais.abertoCentavos)}</span> ·
          Pago <span className="font-semibold text-foreground tabular-nums">{formatarBRL(totais.pagoCentavos)}</span>
        </p>
      </div>
      {resumo.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma comissão neste período.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Profissional</TableHead>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right">Atendimentos</TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead className="text-right">A pagar</TableHead>
              <TableHead className="text-right">Pago</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {resumo.map((r) => (
              <TableRow key={`${r.profissionalId}-${r.competencia}`} data-testid="comissao-resumo">
                <TableCell className="font-medium">{r.nome}</TableCell>
                <TableCell className="tabular-nums">{formatarCompetencia(r.competencia)}</TableCell>
                <TableCell className="text-right tabular-nums">{r.qtd}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{formatarBRL(r.baseCentavos)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                  {formatarBRL(r.abertoCentavos)}
                </TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{formatarBRL(r.pagoCentavos)}</TableCell>
                <TableCell className="text-right">
                  {r.abertas > 0 && (
                    <BotaoPagarComissoes
                      hoje={hoje}
                      item={{
                        profissionalId: r.profissionalId,
                        nome: r.nome,
                        competencia: r.competencia,
                        totalCentavos: r.abertoCentavos,
                      }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
