"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { abrirCaixa, fecharCaixa } from "@/app/(app)/caixa/actions";
import {
  FORMAS_PAGAMENTO,
  resumoCaixa,
  ROTULO_FORMA,
  type FormaPagamento,
  type ResumoCaixa,
} from "@/lib/dominio/caixa";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { cn } from "@/lib/utils";
import { CLASSE_TOM, dataCurta, descreverDiferenca, type CaixaNaoFechado } from "./formato";

/** Uma cobrança do caixa aberto com suas partes (formas). */
export type CobrancaPainel = {
  id: string;
  hora: string;
  clienteNome: string;
  origem: "agendamento" | "pacote" | "venda_produto";
  brutoCentavos: number;
  descontoCentavos: number;
  partes: { forma: FormaPagamento; parcelas: number; valorCentavos: number; descontoCentavos: number }[];
};

const ROTULO_ORIGEM: Record<CobrancaPainel["origem"], string> = {
  agendamento: "Atendimento",
  pacote: "Pacote",
  venda_produto: "Venda de produto",
};

const liquidoParte = (p: CobrancaPainel["partes"][number]) => p.valorCentavos - p.descontoCentavos;

/** Parcela (conta a receber) recebida no caixa aberto. */
export type RecebimentoPainel = {
  id: string;
  hora: string;
  clienteNome: string;
  parcela: string;
  forma: FormaPagamento;
  valorCentavos: number;
};

type Props = {
  /** Caixa de hoje aberto, ou null. */
  caixa: { id: string; valorInicialCentavos: number } | null;
  /** Dona viu o caixa de hoje já fechado. */
  fechadoHoje: boolean;
  cobrancas: CobrancaPainel[];
  recebimentos?: RecebimentoPainel[];
};

/** "A receber" não entra no caixa (só quando a parcela é recebida). */
const FORMAS_DO_CAIXA = FORMAS_PAGAMENTO.filter((f) => f !== "a_receber");

const CLASSE_ERRO =
  "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive";

function AbrirCaixa() {
  const id = useId();
  const router = useRouter();
  const [valor, setValor] = useState("0,00");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function abrir(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    iniciar(async () => {
      const r = await abrirCaixa(valor);
      if (r.ok) {
        toast.success("Caixa aberto.");
        router.refresh();
      } else setErro(r.erro);
    });
  }

  return (
    <form onSubmit={abrir} className="flex max-w-md flex-col gap-4 rounded-xl border bg-card p-4" noValidate>
      <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">Abrir caixa</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-inicial`}>Valor inicial (troco em dinheiro)</Label>
        <Input
          id={`${id}-inicial`}
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
      </div>
      {erro && (
        <p role="alert" className={CLASSE_ERRO}>
          {erro}
        </p>
      )}
      <Button type="submit" disabled={pendente}>
        Abrir caixa
      </Button>
    </form>
  );
}

function FecharCaixa({
  caixaId,
  pergunta = "Fechar o caixa de hoje?",
  semTitulo = false,
  onFechado,
}: {
  caixaId: string;
  pergunta?: string;
  semTitulo?: boolean;
  onFechado: (r: { diferenca: number }) => void;
}) {
  const id = useId();
  const [contado, setContado] = useState("");
  const [confirmando, setConfirmando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function fechar() {
    setErro(null);
    iniciar(async () => {
      const r = await fecharCaixa(caixaId, contado);
      if (r.ok) {
        toast.success("Caixa fechado.");
        onFechado({ diferenca: r.diferencaCentavos });
      } else {
        setConfirmando(false);
        setErro(r.erro);
      }
    });
  }

  return (
    <section
      className={cn("flex max-w-md flex-col gap-3", !semTitulo && "rounded-xl border bg-card p-4")}
      aria-labelledby={semTitulo ? undefined : `${id}-t`}
      aria-label={semTitulo ? "Fechar caixa" : undefined}
    >
      {!semTitulo && (
        <h2 id={`${id}-t`} className="font-titulo text-lg font-semibold text-ouro-escuro">
          Fechar caixa
        </h2>
      )}
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-contado`}>Dinheiro contado na gaveta</Label>
        <Input
          id={`${id}-contado`}
          inputMode="decimal"
          placeholder="0,00"
          value={contado}
          onChange={(e) => {
            setContado(e.target.value);
            setConfirmando(false);
          }}
        />
      </div>
      {erro && (
        <p role="alert" className={CLASSE_ERRO}>
          {erro}
        </p>
      )}
      {confirmando ? (
        <div className="flex flex-col gap-2 rounded-md border bg-blush p-3">
          <p className="text-sm font-medium">
            {pergunta} Depois de fechado, não é possível lançar novos pagamentos nele.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={fechar} disabled={pendente}>
              Sim, fechar caixa
            </Button>
            <Button type="button" variant="outline" onClick={() => setConfirmando(false)} disabled={pendente}>
              Voltar
            </Button>
          </div>
        </div>
      ) : (
        <Button
          type="button"
          onClick={() => {
            setErro(null);
            setConfirmando(true);
          }}
          disabled={contado.trim() === ""}
        >
          Fechar caixa
        </Button>
      )}
    </section>
  );
}

/** Resultado do fechamento; "Atualizar" descarta o resultado e recarrega a tela. */
function CaixaFechado({
  titulo,
  diferenca,
  onAtualizar,
}: {
  titulo: string;
  diferenca: number;
  onAtualizar: () => void;
}) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  const d = descreverDiferenca(diferenca);
  return (
    <section className="flex max-w-md flex-col gap-2 rounded-xl border bg-card p-4" aria-live="polite">
      <h2 className="font-titulo text-lg font-semibold text-ouro-escuro">{titulo}</h2>
      <p>
        Diferença:{" "}
        <strong data-testid="diferenca-caixa" className={cn(CLASSE_TOM[d.tom])}>
          {d.texto}
        </strong>
      </p>
      <Button
        type="button"
        variant="outline"
        disabled={pendente}
        onClick={() =>
          // Na mesma transição: o resultado some quando a tela nova chega.
          iniciar(() => {
            router.refresh();
            onAtualizar();
          })
        }
      >
        Atualizar
      </Button>
    </section>
  );
}

function TabelaResumo({ valorInicialCentavos, resumo }: { valorInicialCentavos: number; resumo: ResumoCaixa }) {
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted-foreground">Troco inicial</dt>
      <dd className="text-right">{formatarBRL(valorInicialCentavos)}</dd>
      {FORMAS_DO_CAIXA.map((f) => (
        <div key={f} className="contents">
          <dt className="text-muted-foreground">{ROTULO_FORMA[f]}</dt>
          <dd className="text-right">{formatarBRL(resumo.totalPorForma[f])}</dd>
        </div>
      ))}
      <dt className="border-t pt-1 font-medium">Total lançado</dt>
      <dd className="border-t pt-1 text-right font-medium">{formatarBRL(resumo.totalGeral)}</dd>
      <dt className="font-medium">Dinheiro esperado na gaveta</dt>
      <dd className="text-right font-medium">{formatarBRL(resumo.dinheiroEsperado)}</dd>
      {resumo.recebidoParcelas > 0 && (
        <>
          <dt className="pt-1 text-muted-foreground">Parcelas recebidas (já no total)</dt>
          <dd className="pt-1 text-right text-muted-foreground">{formatarBRL(resumo.recebidoParcelas)}</dd>
        </>
      )}
      {resumo.vendidoAReceber > 0 && (
        <>
          <dt className="text-muted-foreground">Vendido a receber (fora do total)</dt>
          <dd className="text-right text-muted-foreground">{formatarBRL(resumo.vendidoAReceber)}</dd>
        </>
      )}
    </dl>
  );
}

/** Caixa de um dia anterior que ficou aberto: a dona confere e fecha. */
function CartaoCaixaNaoFechado({
  caixa,
  onFechado,
}: {
  caixa: CaixaNaoFechado;
  onFechado: (r: { diferenca: number }) => void;
}) {
  const data = dataCurta(caixa.data);
  return (
    <li className="flex max-w-md flex-col gap-3 rounded-xl border bg-card p-4">
      <h3 className="font-titulo font-semibold text-ouro-escuro">Caixa de {data}</h3>
      <TabelaResumo valorInicialCentavos={caixa.valorInicialCentavos} resumo={caixa.resumo} />
      <FecharCaixa caixaId={caixa.id} pergunta={`Fechar o caixa de ${data}?`} semTitulo onFechado={onFechado} />
    </li>
  );
}

/**
 * Lista (só da dona) dos caixas de dias anteriores que ninguém fechou. Os
 * resultados dos fechamentos ficam aqui, porque o caixa fechado sai da lista
 * assim que a tela é revalidada.
 */
export function CaixasNaoFechados({ caixas }: { caixas: CaixaNaoFechado[] }) {
  const [fechados, setFechados] = useState<{ id: string; data: string; diferenca: number }[]>([]);
  const idsFechados = new Set(fechados.map((f) => f.id));
  const pendentes = caixas.filter((c) => !idsFechados.has(c.id));

  if (pendentes.length === 0 && fechados.length === 0) return null;
  return (
    <section aria-labelledby="nao-fechados-t" className="flex flex-col gap-3">
      <h2 id="nao-fechados-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
        Caixas não fechados
      </h2>
      {pendentes.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Estes caixas ficaram abertos em dias anteriores. Conte o dinheiro e feche cada um.
        </p>
      )}
      <ul className="flex flex-col gap-4">
        {fechados.map((f) => (
          <li key={f.id}>
            <CaixaFechado
              titulo={`Caixa de ${dataCurta(f.data)} fechado`}
              diferenca={f.diferenca}
              onAtualizar={() => setFechados((lista) => lista.filter((x) => x.id !== f.id))}
            />
          </li>
        ))}
        {pendentes.map((c) => (
          <CartaoCaixaNaoFechado
            key={c.id}
            caixa={c}
            onFechado={({ diferenca }) =>
              setFechados((lista) => [...lista, { id: c.id, data: c.data, diferenca }])
            }
          />
        ))}
      </ul>
    </section>
  );
}

export function PainelCaixa({ caixa, fechadoHoje, cobrancas, recebimentos = [] }: Props) {
  const [fechamento, setFechamento] = useState<{ diferenca: number } | null>(null);

  if (fechamento) {
    return (
      <CaixaFechado
        titulo="Caixa fechado"
        diferenca={fechamento.diferenca}
        onAtualizar={() => setFechamento(null)}
      />
    );
  }

  if (!caixa) {
    return fechadoHoje ? (
      <p className="rounded-xl border bg-card p-4">O caixa de hoje já foi fechado.</p>
    ) : (
      <AbrirCaixa />
    );
  }

  const resumo = resumoCaixa(
    caixa.valorInicialCentavos,
    // Partes achatadas: mesmo resultado da Fase 1 (cada parte é um pagamento).
    cobrancas.flatMap((c) =>
      c.partes.map((p) => ({
        forma: p.forma,
        valorCentavos: p.valorCentavos,
        descontoCentavos: p.descontoCentavos,
      })),
    ),
    recebimentos,
  );

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="lancamentos-t" className="flex flex-col gap-3">
        <h2 id="lancamentos-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Lançamentos de hoje
        </h2>
        {cobrancas.length === 0 ? (
          <p className="text-muted-foreground">Nenhum pagamento lançado ainda.</p>
        ) : (
          <div className="rounded-xl border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hora</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Formas</TableHead>
                  <TableHead className="text-right">Valor líquido</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cobrancas.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="align-top">{c.hora}</TableCell>
                    <TableCell className="align-top">
                      {c.clienteNome}
                      {c.origem !== "agendamento" && (
                        <span className="block text-xs text-muted-foreground">{ROTULO_ORIGEM[c.origem]}</span>
                      )}
                    </TableCell>
                    <TableCell className="align-top">
                      <ul className="flex flex-col gap-0.5">
                        {c.partes.length === 0 && <li>Cortesia</li>}
                        {c.partes.map((p, i) => (
                          <li key={i}>
                            {ROTULO_FORMA[p.forma]}
                            {p.parcelas > 1 ? ` (${p.parcelas}x)` : ""}
                            {c.partes.length > 1 && (
                              <span className="text-muted-foreground"> · {formatarBRL(liquidoParte(p))}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="text-right align-top">
                      {formatarBRL(c.partes.reduce((s, p) => s + liquidoParte(p), 0))}
                      {c.descontoCentavos > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          desconto {formatarBRL(c.descontoCentavos)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {recebimentos.length > 0 && (
        <section aria-labelledby="recebidas-t" className="flex flex-col gap-3">
          <h2 id="recebidas-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
            Parcelas recebidas hoje
          </h2>
          <ul className="flex flex-col divide-y rounded-xl border bg-card">
            {recebimentos.map((r) => (
              <li key={r.id} className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                <span className="tabular-nums text-muted-foreground">{r.hora}</span>
                <span className="font-medium">{r.clienteNome}</span>
                <span className="text-muted-foreground">
                  parcela {r.parcela} · {ROTULO_FORMA[r.forma]}
                </span>
                <span className="ml-auto font-semibold tabular-nums">{formatarBRL(r.valorCentavos)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="resumo-t" className="flex max-w-md flex-col gap-2 rounded-xl border bg-card p-4">
        <h2 id="resumo-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Resumo
        </h2>
        <TabelaResumo valorInicialCentavos={caixa.valorInicialCentavos} resumo={resumo} />
      </section>

      <FecharCaixa caixaId={caixa.id} onFechado={setFechamento} />
    </div>
  );
}
