import type { LinhaFluxo } from "@/app/(app)/financeiro/dados-fluxo";
import { formatarBRL } from "@/lib/dominio/dinheiro";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-11-05" → "05/11" (dia) ou "nov/26" (mês). */
export function rotuloPeriodo(periodo: string, agrupar: "dia" | "mes"): string {
  const [a, m, d] = periodo.split("-");
  return agrupar === "mes" ? `${MESES[Number(m) - 1]}/${a.slice(2)}` : `${d}/${m}`;
}

const ALTURA = 160;
const LARGURA_GRUPO = 28;
const BARRA = 10;

/**
 * Barras entradas × saídas por período (SVG simples, sem biblioteca). O
 * `aria-label` traz os totais; a tabela ao lado traz os valores de cada período.
 */
export function GraficoFluxo({
  linhas,
  agrupar,
  totais,
}: {
  linhas: LinhaFluxo[];
  agrupar: "dia" | "mes";
  totais: { entradas: number; saidas: number; saldo: number };
}) {
  const maximo = Math.max(1, ...linhas.flatMap((l) => [l.entradas, l.saidas]));
  const largura = Math.max(linhas.length * LARGURA_GRUPO, 120);
  const altura = (v: number) => Math.round((v / maximo) * ALTURA);
  const rotulo = `Gráfico de entradas e saídas: entradas ${formatarBRL(totais.entradas)}, saídas ${formatarBRL(
    totais.saidas,
  )}, saldo ${formatarBRL(totais.saldo)}.`;
  // Mostra no máximo ~12 rótulos no eixo para não encavalar.
  const passo = Math.max(1, Math.ceil(linhas.length / 12));

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={rotulo}
          viewBox={`0 0 ${largura} ${ALTURA + 20}`}
          width={largura}
          height={ALTURA + 20}
          className="max-w-none"
        >
          <line x1={0} x2={largura} y1={ALTURA} y2={ALTURA} className="stroke-border" strokeWidth={1} />
          {linhas.map((l, i) => {
            const x = i * LARGURA_GRUPO + (LARGURA_GRUPO - 2 * BARRA) / 2;
            return (
              <g key={l.periodo}>
                <rect
                  x={x}
                  y={ALTURA - altura(l.entradas)}
                  width={BARRA}
                  height={altura(l.entradas)}
                  className="fill-ouro"
                />
                <rect
                  x={x + BARRA}
                  y={ALTURA - altura(l.saidas)}
                  width={BARRA}
                  height={altura(l.saidas)}
                  className="fill-destructive"
                />
                {i % passo === 0 && (
                  <text
                    x={i * LARGURA_GRUPO + LARGURA_GRUPO / 2}
                    y={ALTURA + 14}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[9px]"
                  >
                    {rotuloPeriodo(l.periodo, agrupar)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-hidden>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-ouro" /> Entradas
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block size-3 rounded-sm bg-destructive" /> Saídas
        </span>
      </p>
    </div>
  );
}
