import type { Resumo } from "@/app/(app)/financeiro/dados";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { saldos } from "@/lib/dominio/financeiro";
import { cn } from "@/lib/utils";

const VAZIO: Resumo = {
  recebido: 0,
  recebidoQtd: 0,
  pago: 0,
  pagoQtd: 0,
  aReceber: 0,
  jaRecebido: 0,
  aPagar: 0,
  jaPago: 0,
  aReceberVencido: 0,
  aPagarVencido: 0,
  vencidosQtd: 0,
  vencidosTotal: 0,
};

const INDISPONIVEL = "Indisponível no momento";

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
  /** null: resumo indisponível (o cartão aparece sem valor). */
  valor: number | null;
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
      {valor === null ? (
        <p className={cn("text-sm", detalheClassName)}>{INDISPONIVEL}</p>
      ) : (
        <>
          <p className={cn("font-semibold tabular-nums", grande ? "text-2xl md:text-3xl" : "text-xl")}>
            {formatarBRL(valor)}
          </p>
          <p className={cn("text-sm", detalheClassName)}>{detalhe}</p>
        </>
      )}
    </section>
  );
}

/**
 * Os 7 cartões do período (spec §3.3): 3 grandes e 4 menores. Sem resumo (falha
 * ao carregar, só na aba Caixa do dia) os cartões aparecem "Indisponível no momento".
 */
export function CartoesFinanceiro({ resumo: r }: { resumo: Resumo | null }) {
  const resumo = r ?? VAZIO;
  const v = (n: number) => (r ? n : null);
  const { saldoCaixa, saldoProjetado } = saldos(resumo);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Cartao
          grande
          titulo="Recebido"
          valor={v(resumo.recebido)}
          detalhe={plural(resumo.recebidoQtd, "recebimento confirmado", "recebimentos confirmados")}
        />
        <Cartao
          grande
          titulo="Pago"
          valor={v(resumo.pago)}
          detalhe={plural(resumo.pagoQtd, "pagamento confirmado", "pagamentos confirmados")}
        />
        <Cartao
          grande
          titulo="Saldo em caixa"
          valor={v(saldoCaixa)}
          detalhe={saldoCaixa >= 0 ? "No azul" : "No vermelho"}
          className="border-ouro-escuro bg-ouro text-primary-foreground"
          detalheClassName="text-primary-foreground"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao
          titulo="A receber"
          valor={v(resumo.aReceber)}
          detalhe={`já recebido: ${formatarBRL(resumo.jaRecebido)}`}
        />
        <Cartao titulo="A pagar" valor={v(resumo.aPagar)} detalhe={`já pago: ${formatarBRL(resumo.jaPago)}`} />
        <Cartao
          titulo="Saldo projetado"
          valor={v(saldoProjetado)}
          detalhe="Saldo em caixa + A receber − A pagar"
        />
        <Cartao
          titulo="Vencidos"
          valor={v(resumo.vencidosTotal)}
          detalhe={plural(resumo.vencidosQtd, "conta em aberto", "contas em aberto")}
          className="border-destructive/40 bg-destructive/10 text-destructive"
          detalheClassName="text-destructive"
        />
      </div>
    </div>
  );
}
