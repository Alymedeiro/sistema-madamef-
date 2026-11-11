"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DialogoCancelar } from "./dialogo-cancelar";
import { DialogoReceber, type ParcelaParaReceber } from "./dialogo-receber";

/** Ações de uma conta a receber em aberto: Receber e Cancelar. */
export function AcoesContaReceber({ conta, descricao }: { conta: ParcelaParaReceber; descricao: string }) {
  const [aberto, setAberto] = useState<null | "receber" | "cancelar">(null);
  const fechar = () => setAberto(null);
  return (
    <div className="flex flex-wrap justify-end gap-1">
      <Button type="button" size="sm" onClick={() => setAberto("receber")}>
        Receber
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setAberto("cancelar")}>
        Cancelar
      </Button>
      {aberto === "receber" && <DialogoReceber conta={conta} onFechar={fechar} />}
      {aberto === "cancelar" && (
        <DialogoCancelar tipo="receber" conta={{ id: conta.id, descricao }} onFechar={fechar} />
      )}
    </div>
  );
}
