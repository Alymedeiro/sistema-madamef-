"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
import { Select } from "@/components/ui/select";
import type { ColaboradoraOpcao } from "@/app/(app)/financeiro/dados";
import { lancarVale } from "@/app/(app)/financeiro/actions";
import type { FormaSaida } from "@/lib/dominio/financeiro";
import { Campo, MensagemErro, OpcoesFormaSaida } from "./formulario";

/** Vale de colaboradora (só as ativas): entra como despesa paga na data. Montar só quando aberto. */
export function DialogoVale({
  colaboradoras,
  hoje,
  onFechar,
}: {
  colaboradoras: ColaboradoraOpcao[];
  hoje: string;
  onFechar: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const [colaboradorId, setColaboradorId] = useState("");
  const [valor, setValor] = useState("");
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState<FormaSaida>("pix");
  const [obs, setObs] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await lancarVale({ colaboradorId, valor, data, forma, obs });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Vale lançado.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Lançar vale</DialogTitle>
          <DialogDescription>Adiantamento a uma colaboradora; entra como despesa já paga.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
          <Campo id={`${id}-colab`} rotulo="Colaboradora">
            <Select id={`${id}-colab`} value={colaboradorId} required onChange={(e) => setColaboradorId(e.target.value)}>
              <option value="" disabled>
                Escolha
              </option>
              {colaboradoras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id={`${id}-valor`} rotulo="Valor (R$)">
              <Input id={`${id}-valor`} inputMode="decimal" placeholder="0,00" value={valor} required onChange={(e) => setValor(e.target.value)} />
            </Campo>
            <Campo id={`${id}-data`} rotulo="Data">
              <Input id={`${id}-data`} type="date" value={data} required onChange={(e) => setData(e.target.value)} />
            </Campo>
          </div>
          <Campo id={`${id}-forma`} rotulo="Forma de pagamento">
            <Select id={`${id}-forma`} value={forma} onChange={(e) => setForma(e.target.value as FormaSaida)}>
              <OpcoesFormaSaida />
            </Select>
          </Campo>
          <Campo id={`${id}-obs`} rotulo="Observação (opcional)">
            <Input id={`${id}-obs`} value={obs} maxLength={80} onChange={(e) => setObs(e.target.value)} />
          </Campo>
          <MensagemErro erro={erro} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
              Voltar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Salvando…" : "Lançar vale"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
