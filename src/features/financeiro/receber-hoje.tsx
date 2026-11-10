import type { ContaReceberLinha } from "@/app/(app)/financeiro/dados-receber";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { BotaoReceber } from "./dialogo-receber";
import { SituacaoConta } from "./lista-pagar";

const dataBr = (s: string) => s.split("-").reverse().join("/");

/** Situação do caixa de hoje: aberto, já fechado ou ainda não aberto. */
export type EstadoCaixaHoje = "aberto" | "fechado" | "sem";

const DICA: Record<Exclude<EstadoCaixaHoje, "aberto">, string> = {
  fechado: "O caixa de hoje já foi fechado.",
  sem: "Abra o caixa do dia antes de receber.",
};

/**
 * Bloco do Caixa do dia (dona e recepção): parcelas em aberto que vencem hoje
 * ou já venceram, com "Receber" (só com o caixa de hoje aberto).
 */
export function ReceberHoje({ parcelas, caixa }: { parcelas: ContaReceberLinha[]; caixa: EstadoCaixaHoje }) {
  const caixaAberto = caixa === "aberto";
  return (
    <section aria-labelledby="receber-hoje-t" className="flex flex-col gap-3">
      <h2 id="receber-hoje-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
        Parcelas a receber hoje e vencidas
      </h2>
      {parcelas.length === 0 ? (
        <p className="text-muted-foreground">Nenhuma parcela para receber hoje.</p>
      ) : (
        <>
          {caixa !== "aberto" && <p className="text-sm text-muted-foreground">{DICA[caixa]}</p>}
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {parcelas.map((p) => (
              <li
                key={p.id}
                data-testid="parcela-receber"
                className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              >
                <span className="font-medium">{p.clienteNome}</span>
                <span className="text-muted-foreground">
                  {p.descricao ?? `parcela ${p.parcela}`} · vence {dataBr(p.vencimento)}
                </span>
                <SituacaoConta situacao={p.situacao} tipo="receber" />
                <span className="ml-auto flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{formatarBRL(p.valorCentavos)}</span>
                  <BotaoReceber
                    disabled={!caixaAberto}
                    conta={{
                      id: p.id,
                      clienteNome: p.clienteNome,
                      parcela: p.parcela,
                      descricao: p.descricao,
                      valorCentavos: p.valorCentavos,
                    }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
