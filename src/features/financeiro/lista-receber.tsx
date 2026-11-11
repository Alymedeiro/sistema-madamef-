import type { ContaReceberLinha, OrigemReceber } from "@/app/(app)/financeiro/dados-receber";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { dataBr } from "@/lib/dominio/financeiro";
import { cn } from "@/lib/utils";
import { AvisoLimite } from "./aviso-limite";
import { AcoesContaReceber } from "./acoes-conta-receber";
import { BotaoNovaContaReceber } from "./dialogo-conta-receber";
import { SituacaoConta } from "./lista-pagar";

export const ROTULO_ORIGEM_RECEBER: Record<OrigemReceber, string> = {
  agendamento: "Atendimento",
  pacote: "Pacote",
  venda_produto: "Venda de produto",
  manual: "Manual",
};

/** Aba Contas a receber (dona): lista filtrada, Receber, Cancelar e Nova conta a receber. */
export function ListaReceber({
  contas,
  hoje,
  abrirNova,
  hrefSemNovo,
  destaque,
}: {
  contas: ContaReceberLinha[];
  hoje: string;
  /** `?novo=1`: abre o diálogo de nova conta ao carregar. */
  abrirNova: boolean;
  hrefSemNovo: string;
  destaque?: string;
}) {
  const total = contas.reduce((s, c) => s + c.valorCentavos, 0);
  return (
    <section aria-labelledby="receber-t" className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <h2 id="receber-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
            Contas a receber
          </h2>
          <p className="text-sm text-muted-foreground">
            {contas.length === 1 ? "1 conta" : `${contas.length} contas`} ·{" "}
            <span className="font-semibold text-foreground tabular-nums">{formatarBRL(total)}</span>
          </p>
        </div>
        <BotaoNovaContaReceber hoje={hoje} abrirAoCarregar={abrirNova} hrefSemNovo={hrefSemNovo} />
      </div>
      <AvisoLimite linhas={contas.length} />
      {contas.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma conta a receber com estes filtros.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição/origem</TableHead>
              <TableHead>Parcela</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Recebida em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contas.map((c) => (
              <TableRow
                key={c.id}
                id={`conta-${c.id}`}
                data-testid="conta-receber"
                className={cn(c.id === destaque && "bg-blush")}
              >
                <TableCell className="font-medium">{c.clienteNome}</TableCell>
                <TableCell>
                  {c.descricao ?? ROTULO_ORIGEM_RECEBER[c.origem]}
                  {c.descricao && (
                    <span className="block text-xs text-muted-foreground">{ROTULO_ORIGEM_RECEBER[c.origem]}</span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{c.parcela}</TableCell>
                <TableCell className="tabular-nums">{dataBr(c.vencimento)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                  {formatarBRL(c.valorCentavos)}
                </TableCell>
                <TableCell>
                  <SituacaoConta situacao={c.situacao} tipo="receber" />
                </TableCell>
                <TableCell className="tabular-nums whitespace-nowrap">{dataBr(c.recebidoEm)}</TableCell>
                <TableCell>
                  {c.aberta && (
                    <AcoesContaReceber
                      conta={{
                        id: c.id,
                        clienteNome: c.clienteNome,
                        parcela: c.parcela,
                        descricao: c.descricao,
                        valorCentavos: c.valorCentavos,
                      }}
                      descricao={`${c.clienteNome} — ${c.descricao ?? `parcela ${c.parcela}`}`}
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
