import type { LinhaComissao } from "@/app/(app)/financeiro/dados-comissoes";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AvisoLimite } from "@/features/financeiro/aviso-limite";
import {
  FILTROS_SITUACAO_COMISSAO,
  ROTULO_FILTRO_SITUACAO_COMISSAO,
  ROTULO_STATUS_COMISSAO,
  formatarPercentual,
  type FiltroSituacaoComissao,
  type StatusComissao,
} from "@/lib/dominio/comissoes";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { dataBr, type FiltroPeriodo } from "@/lib/dominio/financeiro";
import { cn } from "@/lib/utils";

const SITUACAO: Record<StatusComissao, { icone: string; classe: string }> = {
  aberta: { icone: "🟡", classe: "text-foreground" },
  paga: { icone: "🟢", classe: "text-emerald-800" },
  cancelada: { icone: "⚫", classe: "text-muted-foreground" },
};

export function SituacaoComissao({ status }: { status: StatusComissao }) {
  const s = SITUACAO[status];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", s.classe)}>
      <span aria-hidden>{s.icone}</span>
      {ROTULO_STATUS_COMISSAO[status]}
    </span>
  );
}

/** Filtros da lista (GET, sem JS): situação e profissional. Mantém aba e período. */
export function FiltrosComissoes({
  periodo,
  de,
  ate,
  situacao,
  profissionalId,
  profissionais,
}: {
  periodo: FiltroPeriodo;
  de: string;
  ate: string;
  situacao: FiltroSituacaoComissao;
  profissionalId: string | null;
  profissionais: { id: string; nome: string }[];
}) {
  return (
    <form method="get" action="/financeiro" role="search" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="aba" value="comissoes" />
      {periodo !== "mes" && <input type="hidden" name="periodo" value={periodo} />}
      {periodo === "personalizado" && (
        <>
          <input type="hidden" name="de" value={de} />
          <input type="hidden" name="ate" value={ate} />
        </>
      )}
      <Select name="situacao" defaultValue={situacao} aria-label="Situação" className="w-40">
        {FILTROS_SITUACAO_COMISSAO.map((s) => (
          <option key={s} value={s}>
            {ROTULO_FILTRO_SITUACAO_COMISSAO[s]}
          </option>
        ))}
      </Select>
      <Select name="profissional" defaultValue={profissionalId ?? ""} aria-label="Profissional" className="w-48">
        <option value="">Todas as profissionais</option>
        {profissionais.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="outline">
        Filtrar
      </Button>
    </form>
  );
}

/** Lista detalhada das comissões do período (com os filtros da aba). */
export function ListaComissoes({ linhas }: { linhas: LinhaComissao[] }) {
  const total = linhas.reduce((s, l) => s + l.valorCentavos, 0);
  return (
    <section aria-labelledby="comissoes-lista-t" className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="comissoes-lista-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Atendimentos
        </h2>
        <p className="text-sm text-muted-foreground">
          {linhas.length === 1 ? "1 comissão" : `${linhas.length} comissões`} ·{" "}
          <span className="font-semibold text-foreground tabular-nums">{formatarBRL(total)}</span>
        </p>
      </div>
      <AvisoLimite linhas={linhas.length} />
      {linhas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma comissão com estes filtros.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Serviço</TableHead>
              <TableHead>Profissional</TableHead>
              <TableHead className="text-right">Base</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={l.id} data-testid="comissao">
                <TableCell className="tabular-nums whitespace-nowrap">{dataBr(l.data)}</TableCell>
                <TableCell className="font-medium">{l.clienteNome}</TableCell>
                <TableCell>{l.servicoNome}</TableCell>
                <TableCell>{l.profissionalNome}</TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{formatarBRL(l.baseCentavos)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatarPercentual(l.percentual)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                  {formatarBRL(l.valorCentavos)}
                </TableCell>
                <TableCell>
                  <SituacaoComissao status={l.status} />
                  {l.status === "paga" && l.pagoEm && (
                    <span className="block text-xs text-muted-foreground">em {dataBr(l.pagoEm)}</span>
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
