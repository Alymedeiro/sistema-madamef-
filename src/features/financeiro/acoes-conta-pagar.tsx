"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { desativarContaFixa, urlAnexo } from "@/app/(app)/financeiro/actions";
import { DialogoCancelar } from "./dialogo-cancelar";
import { DialogoContaPagar, type ContaEditavel } from "./dialogo-conta-pagar";
import { DialogoPagar } from "./dialogo-pagar";

/** Ações da linha: Marcar como paga, Editar e Cancelar (só em aberto). */
export function AcoesContaPagar({ conta, hoje }: { conta: ContaEditavel; hoje: string }) {
  const [aberto, setAberto] = useState<null | "pagar" | "editar" | "cancelar">(null);
  const fechar = () => setAberto(null);
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button type="button" size="sm" onClick={() => setAberto("pagar")}>
        Marcar como paga
      </Button>
      <Button type="button" size="sm" variant="outline" onClick={() => setAberto("editar")}>
        Editar
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setAberto("cancelar")}>
        Cancelar
      </Button>
      {aberto === "pagar" && <DialogoPagar conta={conta} hoje={hoje} onFechar={fechar} />}
      {aberto === "editar" && <DialogoContaPagar modo="editar" conta={conta} hoje={hoje} onFechar={fechar} />}
      {aberto === "cancelar" && <DialogoCancelar tipo="pagar" conta={conta} onFechar={fechar} />}
    </div>
  );
}

/** Abre o anexo em outra aba com URL assinada de 5 minutos. */
export function BotaoAnexo({ contaId }: { contaId: string }) {
  const [pendente, iniciar] = useTransition();
  function abrir() {
    // Abre a aba já no toque (senão o navegador bloqueia) e depois aponta para a URL.
    const janela = window.open("about:blank", "_blank");
    iniciar(async () => {
      const r = await urlAnexo(contaId);
      if (!r.ok) {
        janela?.close();
        toast.error(r.erro);
        return;
      }
      if (janela) {
        janela.opener = null;
        janela.location.href = r.url;
      } else window.location.href = r.url;
    });
  }
  return (
    <Button type="button" size="icon" variant="ghost" onClick={abrir} disabled={pendente} aria-label="Abrir anexo">
      <Paperclip aria-hidden />
    </Button>
  );
}

/** "Parar de repetir" uma conta fixa (as contas já geradas continuam). */
export function BotaoPararContaFixa({ id, descricao }: { id: string; descricao: string }) {
  const router = useRouter();
  const [pendente, iniciar] = useTransition();
  function parar() {
    if (!window.confirm(`Parar de lançar "${descricao}" todo mês? As contas já lançadas continuam.`)) return;
    iniciar(async () => {
      const r = await desativarContaFixa(id);
      if (!r.ok) {
        toast.error(r.erro);
        return;
      }
      toast.success("Conta fixa encerrada.");
      router.refresh();
    });
  }
  return (
    <Button type="button" size="sm" variant="outline" onClick={parar} disabled={pendente}>
      Parar de repetir
    </Button>
  );
}
