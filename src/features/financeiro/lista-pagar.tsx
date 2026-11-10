import type { ContaFixaLinha, ContaPagarLinha } from "@/app/(app)/financeiro/dados";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROTULO_FORMA, type FormaPagamento } from "@/lib/dominio/caixa";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { ROTULO_CATEGORIA, type situacaoConta } from "@/lib/dominio/financeiro";
import { cn } from "@/lib/utils";
import { AvisoLimite } from "./aviso-limite";
import { AcoesContaPagar, BotaoAnexo, BotaoPararContaFixa } from "./acoes-conta-pagar";

type Situacao = ReturnType<typeof situacaoConta>;

const SITUACAO: Record<Situacao, { icone: string; rotulo: string; classe: string }> = {
  paga: { icone: "🟢", rotulo: "Paga", classe: "text-emerald-800" },
  em_aberto: { icone: "🟡", rotulo: "Em aberto", classe: "text-foreground" },
  vencida: { icone: "🔴", rotulo: "Vencida", classe: "text-destructive font-medium" },
  cancelada: { icone: "⚫", rotulo: "Cancelada", classe: "text-muted-foreground" },
};

const dataBr = (s: string | null) => (s ? s.split("-").reverse().join("/") : "—");

export function SituacaoConta({ situacao, tipo = "pagar" }: { situacao: Situacao; tipo?: "pagar" | "receber" }) {
  const s = SITUACAO[situacao];
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", s.classe)}>
      <span aria-hidden>{s.icone}</span>
      {situacao === "paga" && tipo === "receber" ? "Recebida" : s.rotulo}
    </span>
  );
}

/** Aba Contas a pagar: lista filtrada e contas fixas ativas (dona). */
export function ListaPagar({
  contas,
  fixas,
  hoje,
  destaque,
}: {
  contas: ContaPagarLinha[];
  fixas: ContaFixaLinha[];
  hoje: string;
  destaque?: string;
}) {
  const total = contas.reduce((s, c) => s + c.valorCentavos, 0);
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="pagar-t" className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="pagar-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
            Contas a pagar
          </h2>
          <p className="text-sm text-muted-foreground">
            {contas.length === 1 ? "1 conta" : `${contas.length} contas`} ·{" "}
            <span className="font-semibold text-foreground tabular-nums">{formatarBRL(total)}</span>
          </p>
        </div>
        <AvisoLimite linhas={contas.length} />
        {contas.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nenhuma conta a pagar com estes filtros.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Fornecedor/colaboradora</TableHead>
                <TableHead>Vencimento</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Paga em</TableHead>
                <TableHead>
                  <span aria-hidden>📎</span>
                  <span className="sr-only">Anexo</span>
                </TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contas.map((c) => (
                <TableRow
                  key={c.id}
                  id={`conta-${c.id}`}
                  data-testid="conta-pagar"
                  className={cn(c.id === destaque && "bg-blush")}
                >
                  <TableCell className="font-medium">
                    {c.descricao}
                    {c.fixa && <span className="ml-2 text-xs text-muted-foreground">(todo mês)</span>}
                  </TableCell>
                  <TableCell>{ROTULO_CATEGORIA[c.categoria]}</TableCell>
                  <TableCell>{c.quem ?? "—"}</TableCell>
                  <TableCell className="tabular-nums">{dataBr(c.vencimento)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">
                    {formatarBRL(c.valorCentavos)}
                  </TableCell>
                  <TableCell>
                    <SituacaoConta situacao={c.situacao} />
                  </TableCell>
                  <TableCell className="tabular-nums whitespace-nowrap">
                    {dataBr(c.pagoEm)}
                    {c.forma && (
                      <span className="block text-xs text-muted-foreground">
                        {ROTULO_FORMA[c.forma as FormaPagamento]}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{c.anexoPath ? <BotaoAnexo contaId={c.id} /> : null}</TableCell>
                  <TableCell>
                    {c.status === "aberta" && (
                      <AcoesContaPagar
                        hoje={hoje}
                        conta={{
                          id: c.id,
                          descricao: c.descricao,
                          categoria: c.categoria,
                          fornecedor: c.fornecedor,
                          valorCentavos: c.valorCentavos,
                          vencimento: c.vencimento,
                          anexoPath: c.anexoPath,
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

      {fixas.length > 0 && (
        <section aria-labelledby="fixas-t" className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
          <h2 id="fixas-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
            Contas fixas (todo mês)
          </h2>
          <ul className="flex flex-col divide-y">
            {fixas.map((f) => (
              <li key={f.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="font-medium">{f.descricao}</span>
                <span className="text-muted-foreground">
                  {ROTULO_CATEGORIA[f.categoria]} · dia {f.dia}
                </span>
                <span className="ml-auto flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatarBRL(f.valorCentavos)}</span>
                  <BotaoPararContaFixa id={f.id} descricao={f.descricao} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
