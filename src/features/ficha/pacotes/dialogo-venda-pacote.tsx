"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { estadoCaixaHoje, type EstadoCaixaHoje } from "@/app/(app)/caixa/actions";
import { venderPacote } from "@/app/(app)/clientes/ficha/pacotes";
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
import { AbrirCaixaAgora, CLASSE_ERRO } from "@/features/caixa/dialogo-pagamento";
import {
  EditorPartes,
  novaParte,
  partesEditadasParaCobranca,
  partesParaEnvio,
  valoresDasPartes,
  type ParteEditavel,
} from "@/features/caixa/editor-partes";
import { centavosParaCampo } from "@/features/caixa/formato";
import { erroDasPartes, saldoCobranca } from "@/lib/dominio/cobranca";
import { formatarBRL, parseBRL } from "@/lib/dominio/dinheiro";
import { MAX_SESSOES, sugestaoValorPacote } from "@/lib/dominio/pacotes";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { MENSAGEM_VALOR_INVALIDO } from "@/lib/validacao";

export type ServicoVenda = { id: string; nome: string; precoCentavos: number };

function Formulario({
  clienteId,
  clienteNome,
  servicos,
  onFechar,
}: {
  clienteId: string;
  clienteNome: string;
  servicos: ServicoVenda[];
  onFechar: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [etapa, setEtapa] = useState<"pacote" | "pagamento">("pacote");
  const [servicoId, setServicoId] = useState("");
  const [sessoes, setSessoes] = useState("");
  const [valor, setValor] = useState("");
  const [valorEditado, setValorEditado] = useState(false);
  const [validade, setValidade] = useState("");
  const [desconto, setDesconto] = useState("");
  const [partes, setPartes] = useState<ParteEditavel[]>([]);
  const [caixa, setCaixa] = useState<"carregando" | EstadoCaixaHoje>("carregando");
  const [erroCaixa, setErroCaixa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  // Um id por venda: um segundo envio (duplo toque) falha no banco em vez de vender de novo.
  const [idVenda] = useState(() => crypto.randomUUID());

  const servico = servicos.find((s) => s.id === servicoId);
  const nSessoes = sessoes.trim() === "" ? NaN : Number(sessoes);
  const sessoesOk = Number.isInteger(nSessoes) && nSessoes >= 1 && nSessoes <= MAX_SESSOES;
  const bruto = parseBRL(valor);
  const hoje = dataNoFuso(new Date());

  function recalcularSugestao(s: ServicoVenda | undefined, n: number) {
    if (valorEditado || !s || !Number.isInteger(n) || n < 1 || n > MAX_SESSOES) return;
    setValor(centavosParaCampo(sugestaoValorPacote(s.precoCentavos, n)));
  }

  const erroPacote = !servico
    ? "Escolha o serviço."
    : !sessoesOk
      ? `Informe de 1 a ${MAX_SESSOES} sessões.`
      : bruto === null || bruto <= 0
        ? bruto === null
          ? MENSAGEM_VALOR_INVALIDO
          : "O valor do pacote deve ser maior que zero."
        : validade && validade < hoje
          ? "A validade não pode ser anterior a hoje."
          : null;

  const descontoC = desconto.trim() === "" ? 0 : parseBRL(desconto);
  const erroDesconto =
    descontoC === null
      ? MENSAGEM_VALOR_INVALIDO
      : bruto !== null && descontoC > bruto
        ? "O desconto não pode ser maior que o valor."
        : null;
  const liquido = bruto !== null && erroDesconto === null && descontoC !== null ? bruto - descontoC : null;

  useEffect(() => {
    if (etapa !== "pagamento" || caixa !== "carregando") return;
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
  }, [etapa, caixa]);

  function continuar(e: React.FormEvent) {
    e.preventDefault();
    if (erroPacote || bruto === null) {
      setErro(erroPacote);
      return;
    }
    setErro(null);
    setPartes([novaParte("pix", bruto - (descontoC ?? 0))]);
    setEtapa("pagamento");
  }

  function mudarDesconto(texto: string) {
    setDesconto(texto);
    const c = texto.trim() === "" ? 0 : parseBRL(texto);
    if (partes.length === 1 && c !== null && bruto !== null && c <= bruto) {
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
      const r = await venderPacote({
        id: idVenda,
        clienteId,
        servicoId,
        sessoes: nSessoes,
        valorTotal: valor,
        validade: validade || null,
        desconto,
        partes: partesParaEnvio(partes),
      });
      if (r.ok) {
        toast.success("Pacote vendido.");
        onFechar();
        router.refresh();
      } else setErro(r.erro);
    });
  }

  const erroBloco = erro && (
    <p role="alert" className={CLASSE_ERRO}>
      {erro}
    </p>
  );

  return (
    <>
      <DialogHeader>
        <DialogTitle>Vender pacote</DialogTitle>
        <DialogDescription>{clienteNome}</DialogDescription>
      </DialogHeader>

      {etapa === "pacote" ? (
        <form onSubmit={continuar} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-servico`}>Serviço</Label>
            <Select
              id={`${id}-servico`}
              value={servicoId}
              onChange={(e) => {
                setServicoId(e.target.value);
                recalcularSugestao(
                  servicos.find((s) => s.id === e.target.value),
                  nSessoes,
                );
              }}
            >
              <option value="">Escolha o serviço</option>
              {servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome} · {formatarBRL(s.precoCentavos)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-sessoes`}>Número de sessões</Label>
              <Input
                id={`${id}-sessoes`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_SESSOES}
                value={sessoes}
                onChange={(e) => {
                  setSessoes(e.target.value);
                  recalcularSugestao(servico, Number(e.target.value));
                }}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={`${id}-valor`}>Valor total</Label>
              <Input
                id={`${id}-valor`}
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                onChange={(e) => {
                  setValor(e.target.value);
                  setValorEditado(true);
                }}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-validade`}>Validade (opcional)</Label>
            <Input
              id={`${id}-validade`}
              type="date"
              min={hoje}
              value={validade}
              onChange={(e) => setValidade(e.target.value)}
            />
          </div>
          {erroBloco}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="submit">Continuar</Button>
          </DialogFooter>
        </form>
      ) : (
        <>
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
              O caixa de hoje já foi fechado. Não é possível vender pacotes hoje.
            </p>
          )}

          {caixa === "aberto" && (
            <form onSubmit={confirmar} className="flex flex-col gap-4" noValidate>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">
                  {servico?.nome} · {nSessoes} sessões
                </dt>
                <dd className="text-right" data-testid="total-pacote">
                  {bruto !== null ? formatarBRL(bruto) : "—"}
                </dd>
                {liquido !== null && bruto !== null && liquido !== bruto && (
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
              {erroBloco}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEtapa("pacote")}
                  disabled={pendente}
                >
                  Voltar
                </Button>
                <Button type="submit" disabled={pendente || !pronto}>
                  Confirmar venda
                </Button>
              </DialogFooter>
            </form>
          )}

          {caixa !== "aberto" && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEtapa("pacote")}>
                Voltar
              </Button>
            </DialogFooter>
          )}
        </>
      )}
    </>
  );
}

/** Venda de pacote: dados do pacote e, em seguida, desconto e formas de pagamento. */
export function DialogoVendaPacote({
  aberto,
  clienteId,
  clienteNome,
  servicos,
  onFechar,
}: {
  aberto: boolean;
  clienteId: string;
  clienteNome: string;
  servicos: ServicoVenda[];
  onFechar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        {aberto && (
          <Formulario
            clienteId={clienteId}
            clienteNome={clienteNome}
            servicos={servicos}
            onFechar={onFechar}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
