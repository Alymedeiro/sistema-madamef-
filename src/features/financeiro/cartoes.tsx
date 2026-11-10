import type { Resumo } from "@/app/(app)/financeiro/dados";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { saldos } from "@/lib/dominio/financeiro";
import { cn } from "@/lib/utils";

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function Cartao({
  titulo,
  valor,
  detalhe,
  grande = false,
  className,
  detalheClassName = "text-muted-foreground",
}: {
  titulo: string;
  valor: number;
  detalhe: string;
  grande?: boolean;
  className?: string;
  detalheClassName?: string;
}) {
  return (
    <section
      aria-label={titulo}
      className={cn("flex flex-col gap-1 rounded-xl border bg-card p-4 shadow-sm", className)}
    >
      <h2 className="text-sm font-medium">{titulo}</h2>
      <p className={cn("font-semibold tabular-nums", grande ? "text-2xl md:text-3xl" : "text-xl")}>
        {formatarBRL(valor)}
      </p>
      <p className={cn("text-sm", detalheClassName)}>{detalhe}</p>
    </section>
  );
}

/** Os 7 cartões do período (spec §3.3): 3 grandes e 4 menores. */
export function CartoesFinanceiro({ resumo }: { resumo: Resumo }) {
  const { saldoCaixa, saldoProjetado } = saldos(resumo);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Cartao
          grande
          titulo="Recebido"
          valor={resumo.recebido}
          detalhe={plural(resumo.recebidoQtd, "recebimento confirmado", "recebimentos confirmados")}
        />
        <Cartao
          grande
          titulo="Pago"
          valor={resumo.pago}
          detalhe={plural(resumo.pagoQtd, "pagamento confirmado", "pagamentos confirmados")}
        />
        <Cartao
          grande
          titulo="Saldo em caixa"
          valor={saldoCaixa}
          detalhe={saldoCaixa >= 0 ? "No azul" : "No vermelho"}
          className="border-ouro-escuro bg-ouro text-primary-foreground"
          detalheClassName="text-primary-foreground"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao
          titulo="A receber"
          valor={resumo.aReceber}
          detalhe={`já recebido: ${formatarBRL(resumo.jaRecebido)}`}
        />
        <Cartao titulo="A pagar" valor={resumo.aPagar} detalhe={`já pago: ${formatarBRL(resumo.jaPago)}`} />
        <Cartao
          titulo="Saldo projetado"
          valor={saldoProjetado}
          detalhe="Saldo em caixa + A receber − A pagar"
        />
        <Cartao
          titulo="Vencidos"
          valor={resumo.vencidosTotal}
          detalhe={plural(resumo.vencidosQtd, "conta em aberto", "contas em aberto")}
          className="border-destructive/40 bg-destructive/10 text-destructive"
          detalheClassName="text-destructive"
        />
      </div>
    </div>
  );
}
