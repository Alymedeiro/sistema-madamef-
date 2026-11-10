import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  CATEGORIAS_DESPESA,
  FILTROS_SITUACAO,
  ROTULO_CATEGORIA,
  type FiltroPeriodo,
  type FiltroSituacao,
} from "@/lib/dominio/financeiro";
import type { AbaFinanceiro } from "@/lib/dominio/permissoes";

const ROTULO_SITUACAO: Record<FiltroSituacao, (tipo: "pagar" | "receber") => string> = {
  todas: () => "Todas",
  aberta: () => "Em aberto",
  vencida: () => "Vencidas",
  paga: (t) => (t === "pagar" ? "Pagas" : "Recebidas"),
  cancelada: () => "Canceladas",
};

/**
 * Filtros da lista (GET, sem JS): situação, busca e — em Contas a pagar —
 * categoria. Mantém aba e período.
 */
export function FiltrosLista({
  aba,
  tipo,
  periodo,
  de,
  ate,
  situacao,
  busca,
  categoria,
}: {
  aba: AbaFinanceiro;
  tipo: "pagar" | "receber";
  periodo: FiltroPeriodo;
  de: string;
  ate: string;
  situacao: FiltroSituacao;
  busca: string;
  categoria?: string;
}) {
  return (
    <form method="get" action="/financeiro" role="search" className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="aba" value={aba} />
      {periodo !== "mes" && <input type="hidden" name="periodo" value={periodo} />}
      {periodo === "personalizado" && (
        <>
          <input type="hidden" name="de" value={de} />
          <input type="hidden" name="ate" value={ate} />
        </>
      )}
      <Select name="situacao" defaultValue={situacao} aria-label="Situação" className="w-40">
        {FILTROS_SITUACAO.map((s) => (
          <option key={s} value={s}>
            {ROTULO_SITUACAO[s](tipo)}
          </option>
        ))}
      </Select>
      {tipo === "pagar" && (
        <Select name="categoria" defaultValue={categoria ?? ""} aria-label="Categoria" className="w-40">
          <option value="">Todas as categorias</option>
          {CATEGORIAS_DESPESA.map((c) => (
            <option key={c} value={c}>
              {ROTULO_CATEGORIA[c]}
            </option>
          ))}
        </Select>
      )}
      <Input
        type="search"
        name="busca"
        defaultValue={busca}
        maxLength={60}
        placeholder={tipo === "pagar" ? "Buscar descrição ou fornecedor" : "Buscar cliente ou descrição"}
        aria-label="Buscar"
        className="w-56"
      />
      <Button type="submit" variant="outline">
        Filtrar
      </Button>
    </form>
  );
}
