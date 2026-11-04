"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { abrirCaixa, caixaAbertoHoje, registrarPagamento } from "@/app/(app)/caixa/actions";
import {
  FORMAS_PAGAMENTO,
  formaParcelada,
  gerarParcelas,
  MAX_PARCELAS,
  ROTULO_FORMA,
  type FormaPagamento,
} from "@/lib/dominio/caixa";
import { formatarBRL, parseBRL } from "@/lib/dominio/dinheiro";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { centavosParaCampo } from "./formato";

export type AtendimentoParaPagar = {
  id: string;
  clienteId: string;
  clienteNome: string;
  valorPrevistoCentavos: number;
};

const CLASSE_ERRO =
  "rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive";

function AbrirCaixaAgora({ onAberto }: { onAberto: () => void }) {
  const id = useId();
  const [valor, setValor] = useState("0,00");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function abrir() {
    setErro(null);
    iniciar(async () => {
      const r = await abrirCaixa(valor);
      if (r.ok) {
        toast.success("Caixa aberto.");
        onAberto();
      } else setErro(r.erro);
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-blush p-4">
      <p className="text-sm font-medium">O caixa de hoje ainda não foi aberto.</p>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-inicial`}>Troco inicial em dinheiro</Label>
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
      <Button type="button" onClick={abrir} disabled={pendente}>
        Abrir caixa agora
      </Button>
    </div>
  );
}

function FormularioPagamento({
  atendimento,
  onFechar,
}: {
  atendimento: AtendimentoParaPagar;
  onFechar: () => void;
}) {
  const id = useId();
  const [caixa, setCaixa] = useState<"carregando" | "aberto" | "fechado">("carregando");
  const [erroCaixa, setErroCaixa] = useState<string | null>(null);
  const [forma, setForma] = useState<FormaPagamento>("pix");
  const [valor, setValor] = useState(centavosParaCampo(atendimento.valorPrevistoCentavos));
  const [desconto, setDesconto] = useState("");
  const [parcelas, setParcelas] = useState(2);
  const [vencimento, setVencimento] = useState(dataNoFuso(new Date()));
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    if (caixa !== "carregando") return;
    let ativo = true;
    caixaAbertoHoje()
      .then((r) => {
        if (!ativo) return;
        if (r.ok) setCaixa(r.aberto ? "aberto" : "fechado");
        else setErroCaixa(r.erro);
      })
      .catch(() => ativo && setErroCaixa("Não foi possível verificar o caixa."));
    return () => {
      ativo = false;
    };
  }, [caixa]);

  const parcelado = formaParcelada(forma);
  const valorC = parseBRL(valor);
  const descontoC = desconto.trim() === "" ? 0 : parseBRL(desconto);
  const liquido =
    valorC !== null && descontoC !== null && descontoC <= valorC ? valorC - descontoC : null;

  let previa: ReturnType<typeof gerarParcelas> | null = null;
  if (forma === "a_receber" && liquido !== null && Number.isInteger(parcelas)) {
    try {
      if (parcelas >= 2 && parcelas <= MAX_PARCELAS) previa = gerarParcelas(liquido, parcelas, vencimento);
    } catch {
      previa = null;
    }
  }

  function lancar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    iniciar(async () => {
      const r = await registrarPagamento({
        clienteId: atendimento.clienteId,
        agendamentoId: atendimento.id,
        forma,
        valor,
        desconto,
        parcelas: parcelado ? parcelas : 1,
        primeiroVencimento: forma === "a_receber" ? vencimento : undefined,
      });
      if (r.ok) {
        toast.success("Pagamento registrado.");
        onFechar();
      } else setErro(r.erro);
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Pagamento do atendimento</DialogTitle>
        <DialogDescription>
          {atendimento.clienteNome} · valor previsto {formatarBRL(atendimento.valorPrevistoCentavos)}
        </DialogDescription>
      </DialogHeader>

      {caixa === "carregando" && !erroCaixa && (
        <p className="text-sm text-muted-foreground">Verificando o caixa...</p>
      )}
      {erroCaixa && (
        <p role="alert" className={CLASSE_ERRO}>
          {erroCaixa}
        </p>
      )}
      {caixa === "fechado" && <AbrirCaixaAgora onAberto={() => setCaixa("aberto")} />}

      {caixa === "aberto" && (
        <form onSubmit={lancar} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-forma`}>Forma de pagamento</Label>
            <Select
              id={`${id}-forma`}
              value={forma}
              onChange={(e) => setForma(e.target.value as FormaPagamento)}
            >
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f} value={f}>
                  {ROTULO_FORMA[f]}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-valor`}>Valor</Label>
              <Input
                id={`${id}-valor`}
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-desconto`}>Desconto</Label>
              <Input
                id={`${id}-desconto`}
                inputMode="decimal"
                placeholder="0,00"
                value={desconto}
                onChange={(e) => setDesconto(e.target.value)}
              />
            </div>
          </div>

          {parcelado && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-parcelas`}>Número de parcelas</Label>
              <Select
                id={`${id}-parcelas`}
                value={parcelas}
                onChange={(e) => setParcelas(Number(e.target.value))}
              >
                {Array.from({ length: MAX_PARCELAS - 1 }, (_, i) => i + 2).map((n) => (
                  <option key={n} value={n}>
                    {n}x
                  </option>
                ))}
              </Select>
            </div>
          )}

          {forma === "a_receber" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-venc`}>Primeiro vencimento</Label>
              <Input
                id={`${id}-venc`}
                type="date"
                min={dataNoFuso(new Date())}
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
              />
              {previa && (
                <ul className="text-sm text-muted-foreground" aria-label="Prévia das parcelas">
                  {previa.map((p) => (
                    <li key={p.numero}>
                      {p.numero}ª: {formatarBRL(p.valorCentavos)} em{" "}
                      {p.vencimento.split("-").reverse().join("/")}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {liquido !== null && (
            <p className="text-sm">
              Total a lançar: <strong>{formatarBRL(liquido)}</strong>
            </p>
          )}

          {erro && (
            <p role="alert" className={CLASSE_ERRO}>
              {erro}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
              Pagar depois
            </Button>
            <Button type="submit" disabled={pendente}>
              Registrar pagamento
            </Button>
          </DialogFooter>
        </form>
      )}

      {caixa !== "aberto" && (
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar}>
            Pagar depois
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

/** Abre ao marcar "Atendido": lança o pagamento no caixa do dia. */
export function DialogoPagamento({
  atendimento,
  onFechar,
}: {
  atendimento: AtendimentoParaPagar | null;
  onFechar: () => void;
}) {
  return (
    <Dialog open={!!atendimento} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        {atendimento && (
          <FormularioPagamento key={atendimento.id} atendimento={atendimento} onFechar={onFechar} />
        )}
      </DialogContent>
    </Dialog>
  );
}
