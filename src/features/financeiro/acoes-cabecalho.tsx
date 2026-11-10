"use client";

import { useState } from "react";
import { Camera, HandCoins, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ColaboradoraOpcao } from "@/app/(app)/financeiro/dados";
import { DialogoContaPagar } from "./dialogo-conta-pagar";
import { DialogoNovoLancamento } from "./dialogo-novo-lancamento";
import { DialogoVale } from "./dialogo-vale";

type Aberto = null | "vale" | "despesa" | "novo" | "nova_pagar";

/** Botões do cabeçalho do Financeiro (dona): Lançar vale, Despesa com foto/PDF, Novo lançamento. */
export function AcoesCabecalho({
  colaboradoras,
  hoje,
  hrefNovaReceber,
}: {
  colaboradoras: ColaboradoraOpcao[];
  hoje: string;
  hrefNovaReceber: string;
}) {
  const [aberto, setAberto] = useState<Aberto>(null);
  const fechar = () => setAberto(null);

  return (
    <>
      <Button type="button" variant="outline" onClick={() => setAberto("vale")}>
        <HandCoins aria-hidden />
        Lançar vale
      </Button>
      <Button type="button" variant="outline" onClick={() => setAberto("despesa")}>
        <Camera aria-hidden />
        Despesa com foto/PDF
      </Button>
      <Button type="button" onClick={() => setAberto("novo")}>
        <Plus aria-hidden />
        Novo lançamento
      </Button>

      {aberto === "vale" && <DialogoVale colaboradoras={colaboradoras} hoje={hoje} onFechar={fechar} />}
      {aberto === "despesa" && <DialogoContaPagar modo="despesa" hoje={hoje} onFechar={fechar} />}
      {aberto === "novo" && (
        <DialogoNovoLancamento
          hrefNovaReceber={hrefNovaReceber}
          onPagar={() => setAberto("nova_pagar")}
          onFechar={fechar}
        />
      )}
      {aberto === "nova_pagar" && <DialogoContaPagar modo="nova" hoje={hoje} onFechar={fechar} />}
    </>
  );
}
