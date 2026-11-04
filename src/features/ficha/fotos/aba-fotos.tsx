import type { FotoFicha } from "@/app/(app)/clientes/ficha/dados";
import { AdicionarFotos, type AtendimentoOpcao } from "./adicionar-fotos";
import { GaleriaFotos } from "./galeria-fotos";

export function AbaFotos({
  clienteId,
  fotos,
  atendimentos,
  podeAdicionar,
  podeArquivar,
}: {
  clienteId: string;
  fotos: FotoFicha[];
  atendimentos: AtendimentoOpcao[];
  podeAdicionar: boolean;
  podeArquivar: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {podeAdicionar ? <AdicionarFotos clienteId={clienteId} atendimentos={atendimentos} /> : null}
      <GaleriaFotos fotos={fotos} podeArquivar={podeArquivar} />
    </div>
  );
}
