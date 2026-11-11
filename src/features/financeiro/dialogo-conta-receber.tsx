"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { criarContaReceber } from "@/app/(app)/financeiro/actions";
import { SeletorCliente, type ClienteEscolhida } from "@/features/agenda/seletor-cliente";
import { Campo, MensagemErro } from "./formulario";

/** Nova conta a receber manual (parcela única). Montar só quando aberto. */
export function DialogoContaReceber({ hoje, onFechar }: { hoje: string; onFechar: () => void }) {
  const id = useId();
  const router = useRouter();
  const [cliente, setCliente] = useState<ClienteEscolhida | null>(null);
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [vencimento, setVencimento] = useState(hoje);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function confirmar() {
    setErro(null);
    iniciar(async () => {
      const r = await criarContaReceber({ clienteId: cliente?.id ?? "", descricao, valor, vencimento });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Conta a receber lançada.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova conta a receber</DialogTitle>
          <DialogDescription>Valor que uma cliente vai pagar depois (parcela única).</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            confirmar();
          }}
        >
          <SeletorCliente cliente={cliente} onEscolher={setCliente} />
          <Campo id={`${id}-descricao`} rotulo="Descrição">
            <Input
              id={`${id}-descricao`}
              value={descricao}
              maxLength={120}
              required
              onChange={(e) => setDescricao(e.target.value)}
            />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id={`${id}-valor`} rotulo="Valor (R$)">
              <Input
                id={`${id}-valor`}
                inputMode="decimal"
                placeholder="0,00"
                value={valor}
                required
                onChange={(e) => setValor(e.target.value)}
              />
            </Campo>
            <Campo id={`${id}-venc`} rotulo="Vencimento">
              <Input
                id={`${id}-venc`}
                type="date"
                value={vencimento}
                required
                onChange={(e) => setVencimento(e.target.value)}
              />
            </Campo>
          </div>
          <MensagemErro erro={erro} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
              Voltar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Salvando…" : "Lançar conta"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Botão "Nova conta a receber". Com `abrirAoCarregar` (link `?novo=1` do Novo
 * lançamento) o diálogo já abre; ao fechar, volta para `hrefSemNovo`.
 */
export function BotaoNovaContaReceber({
  hoje,
  abrirAoCarregar,
  hrefSemNovo,
}: {
  hoje: string;
  abrirAoCarregar: boolean;
  hrefSemNovo: string;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(abrirAoCarregar);
  function fechar() {
    setAberto(false);
    if (abrirAoCarregar) router.replace(hrefSemNovo, { scroll: false });
  }
  return (
    <>
      <Button type="button" onClick={() => setAberto(true)}>
        <Plus aria-hidden />
        Nova conta a receber
      </Button>
      {aberto && <DialogoContaReceber hoje={hoje} onFechar={fechar} />}
    </>
  );
}
