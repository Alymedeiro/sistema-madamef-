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
import {
  abrirCaixa,
  estadoCaixaHoje,
  registrarCobranca,
  type EstadoCaixaHoje,
} from "@/app/(app)/caixa/actions";
import { erroDasPartes, saldoCobranca } from "@/lib/dominio/cobranca";
import { formatarBRL, parseBRL } from "@/lib/dominio/dinheiro";
import { MENSAGEM_VALOR_INVALIDO } from "@/lib/validacao";
import {
  EditorPartes,
  novaParte,
  partesEditadasParaCobranca,
  partesParaEnvio,
  valoresDasPartes,
  type ParteEditavel,
} from "./editor-partes";
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
  const bruto = atendimento.valorPrevistoCentavos;
  const [caixa, setCaixa] = useState<"carregando" | EstadoCaixaHoje>("carregando");
  const [erroCaixa, setErroCaixa] = useState<string | null>(null);
  const [desconto, setDesconto] = useState("");
  const [partes, setPartes] = useState<ParteEditavel[]>(() => [novaParte("pix", bruto)]);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  useEffect(() => {
    if (caixa !== "carregando") return;
    let ativo = true;
    estadoCaixaHoje()
      .then((r) => {
        if (!ativo) return;
        if (r.ok) setCaixa(r.estado);
        else setErroCaixa(r.erro);
      })
      .catch(() => ativo && setErroCaixa("Não foi possível verificar o caixa."));
    return () => {
      ativo = false;
    };
  }, [caixa]);

  const descontoC = desconto.trim() === "" ? 0 : parseBRL(desconto);
  const erroDesconto =
    descontoC === null
      ? MENSAGEM_VALOR_INVALIDO
      : descontoC > bruto
        ? "O desconto não pode ser maior que o valor."
        : null;
  const liquido = erroDesconto === null && descontoC !== null ? bruto - descontoC : null;

  function mudarDesconto(texto: string) {
    setDesconto(texto);
    // Com uma forma só, ela acompanha o total com desconto.
    const c = texto.trim() === "" ? 0 : parseBRL(texto);
    if (partes.length === 1 && c !== null && c <= bruto) {
      setPartes([{ ...partes[0], valor: centavosParaCampo(bruto - c) }]);
    }
  }

  const pronto =
    liquido !== null &&
    saldoCobranca(liquido, valoresDasPartes(partes)).fecha &&
    erroDasPartes(liquido, partesEditadasParaCobranca(partes)) === null;

  function confirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!pronto) return;
    setErro(null);
    iniciar(async () => {
      const r = await registrarCobranca({
        agendamentoId: atendimento.id,
        desconto,
        partes: partesParaEnvio(partes),
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
        <DialogDescription>{atendimento.clienteNome}</DialogDescription>
      </DialogHeader>

      {caixa === "carregando" && !erroCaixa && (
        <p className="text-sm text-muted-foreground">Verificando o caixa...</p>
      )}
      {erroCaixa && (
        <p role="alert" className={CLASSE_ERRO}>
          {erroCaixa}
        </p>
      )}
      {caixa === "nao_aberto" && <AbrirCaixaAgora onAberto={() => setCaixa("aberto")} />}
      {caixa === "fechado" && (
        <p role="status" className="rounded-md border bg-blush p-4 text-sm font-medium">
          O caixa de hoje já foi fechado. Não é possível lançar novos pagamentos hoje; o
          atendimento continua em &quot;Atendidos sem pagamento&quot; no Início.
        </p>
      )}

      {caixa === "aberto" && (
        <form onSubmit={confirmar} className="flex flex-col gap-4" noValidate>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Total do atendimento</dt>
            <dd className="text-right" data-testid="total-atendimento">
              {formatarBRL(bruto)}
            </dd>
            {liquido !== null && liquido !== bruto && (
              <>
                <dt className="font-medium">Total com desconto</dt>
                <dd className="text-right font-medium">{formatarBRL(liquido)}</dd>
              </>
            )}
          </dl>

          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-desconto`}>Desconto</Label>
            <Input
              id={`${id}-desconto`}
              inputMode="decimal"
              placeholder="0,00"
              value={desconto}
              aria-invalid={erroDesconto !== null}
              onChange={(e) => mudarDesconto(e.target.value)}
            />
            {erroDesconto && <p className="text-sm text-destructive">{erroDesconto}</p>}
          </div>

          {liquido !== null && (
            <EditorPartes liquidoCentavos={liquido} partes={partes} onMudar={setPartes} />
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
            <Button type="submit" disabled={pendente || !pronto}>
              Confirmar
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
