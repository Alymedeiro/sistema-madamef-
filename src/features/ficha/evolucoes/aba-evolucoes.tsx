import type { EvolucaoFicha } from "@/app/(app)/clientes/ficha/dados";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { CampoEvolucao, ItemEvolucao, type AtendimentoEvolucao } from "./campo-evolucao";

export function AbaEvolucoes({
  evolucoes,
  atendimentos,
  podeAdicionar,
}: {
  evolucoes: EvolucaoFicha[];
  atendimentos: AtendimentoEvolucao[];
  podeAdicionar: boolean;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      {podeAdicionar ? <CampoEvolucao atendimentos={atendimentos} /> : null}
      {evolucoes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma evolução registrada.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {evolucoes.map((e) => (
            <li key={e.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm">
              <p className="text-muted-foreground">
                {formatarNoFuso(e.criadoEm, "dd/MM/yyyy 'às' HH:mm")} · {e.profissionalNome} ·{" "}
                {e.servicoNome} em {formatarNoFuso(e.atendimentoEm, "dd/MM/yyyy")}
              </p>
              <ItemEvolucao id={e.id} texto={e.texto} editavel={e.editavel} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
