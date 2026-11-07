"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { registrarAnamnese } from "@/app/(app)/clientes/ficha/anamnese";
import {
  errosDasRespostas,
  respostasLegiveis,
  type Pergunta,
  type Respostas,
  type ValorResposta,
} from "@/lib/dominio/anamnese";
import { cn } from "@/lib/utils";
import { CampoAssinatura } from "../campo-assinatura";

type Props = {
  clienteId: string;
  clienteNome: string;
  modelo: { id: string; titulo: string; perguntas: Pergunta[] };
};

const BOTAO_GRANDE = "min-h-14 min-w-28 flex-1 text-xl";

function BotaoOpcao({
  ativo,
  onClick,
  children,
}: {
  ativo: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={ativo ? "default" : "outline"}
      aria-pressed={ativo}
      className={cn(BOTAO_GRANDE, "h-14")}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function CampoPergunta({
  pergunta: p,
  valor,
  onMudar,
}: {
  pergunta: Pergunta;
  valor: ValorResposta | undefined;
  onMudar: (v: ValorResposta) => void;
}) {
  if (p.tipo === "texto") {
    return (
      <textarea
        aria-label={p.texto}
        rows={4}
        value={typeof valor === "string" ? valor : ""}
        onChange={(e) => onMudar(e.target.value)}
        className="w-full rounded-md border border-input bg-card p-3 text-xl shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
      />
    );
  }
  if (p.tipo === "data") {
    return (
      <Input
        type="date"
        aria-label={p.texto}
        value={typeof valor === "string" ? valor : ""}
        onChange={(e) => onMudar(e.target.value)}
        className="min-h-14 text-xl md:text-xl"
      />
    );
  }
  if (p.tipo === "sim_nao") {
    return (
      <div className="flex gap-4">
        <BotaoOpcao ativo={valor === true} onClick={() => onMudar(true)}>
          Sim
        </BotaoOpcao>
        <BotaoOpcao ativo={valor === false} onClick={() => onMudar(false)}>
          Não
        </BotaoOpcao>
      </div>
    );
  }
  if (p.tipo === "sim_nao_detalhe") {
    const o =
      valor && typeof valor === "object" && !Array.isArray(valor) ? valor : null;
    return (
      <div className="flex flex-col gap-4">
        <div className="flex gap-4">
          <BotaoOpcao
            ativo={o?.sim === true}
            onClick={() => onMudar({ sim: true, detalhe: o?.detalhe ?? "" })}
          >
            Sim
          </BotaoOpcao>
          <BotaoOpcao
            ativo={o?.sim === false}
            onClick={() => onMudar({ sim: false, detalhe: "" })}
          >
            Não
          </BotaoOpcao>
        </div>
        {o?.sim ? (
          <Input
            aria-label="Conte mais"
            placeholder="Conte mais"
            value={o.detalhe}
            onChange={(e) => onMudar({ sim: true, detalhe: e.target.value })}
            className="min-h-14 text-xl md:text-xl"
          />
        ) : null}
      </div>
    );
  }
  const marcadas = Array.isArray(valor) ? valor : [];
  return (
    <div className="flex flex-col gap-3">
      {(p.opcoes ?? []).map((opcao) => {
        const ativo = marcadas.includes(opcao);
        return (
          <Button
            key={opcao}
            type="button"
            variant={ativo ? "default" : "outline"}
            aria-pressed={ativo}
            className="h-14 justify-start text-xl"
            onClick={() =>
              onMudar(ativo ? marcadas.filter((m) => m !== opcao) : [...marcadas, opcao])
            }
          >
            {opcao}
          </Button>
        );
      })}
    </div>
  );
}

export function FormularioAnamnese({ clienteId, clienteNome, modelo }: Props) {
  const router = useRouter();
  const perguntas = modelo.perguntas;
  const [passo, setPasso] = useState(0);
  const [respostas, setRespostas] = useState<Respostas>({});
  const [erro, setErro] = useState<string | null>(null);
  const [assinatura, setAssinatura] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const resumo = passo >= perguntas.length;
  const atual = resumo ? null : perguntas[passo];

  function avancar() {
    if (!atual) return;
    const e = errosDasRespostas([atual], respostas)[atual.id];
    if (e) {
      setErro(e);
      return;
    }
    setErro(null);
    setPasso((n) => n + 1);
  }

  function confirmar() {
    if (!assinatura) {
      setErro("Assine no quadro antes de confirmar.");
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await registrarAnamnese({
        clienteId,
        modeloId: modelo.id,
        respostas,
        assinatura,
      });
      if (!r.ok) {
        setErro(r.erro);
        toast.error(r.erro);
        return;
      }
      toast.success("Anamnese registrada.");
      router.push(`/clientes/${clienteId}?aba=anamnese`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">
        {clienteNome} · {resumo ? "Confira e assine" : `Pergunta ${passo + 1} de ${perguntas.length}`}
      </p>

      <section className="flex flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm">
        {atual ? (
          <>
            <h2 className="text-2xl font-semibold">
              {atual.texto}
              {atual.obrigatoria ? <span aria-hidden> *</span> : null}
            </h2>
            <CampoPergunta
              pergunta={atual}
              valor={respostas[atual.id]}
              onMudar={(v) => {
                setErro(null);
                setRespostas((r) => ({ ...r, [atual.id]: v }));
              }}
            />
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold">Suas respostas</h2>
            <dl className="flex flex-col gap-3">
              {respostasLegiveis(perguntas, respostas).map((i) => (
                <div key={i.pergunta}>
                  <dt className="text-base text-muted-foreground">{i.pergunta}</dt>
                  <dd className="font-medium break-words">{i.resposta}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-col gap-2">
              <h3 className="text-xl font-semibold">Assinatura</h3>
              <p className="text-base text-muted-foreground">
                Declaro que as informações acima são verdadeiras.
              </p>
              <CampoAssinatura onMudar={setAssinatura} />
            </div>
          </>
        )}
        {erro ? (
          <p role="alert" className="text-lg font-medium text-destructive">
            {erro}
          </p>
        ) : null}
      </section>

      <div className="flex gap-4">
        {passo > 0 ? (
          <Button
            type="button"
            variant="outline"
            className="min-h-14 flex-1 text-xl"
            disabled={pendente}
            onClick={() => {
              setErro(null);
              setPasso((n) => n - 1);
            }}
          >
            Voltar
          </Button>
        ) : null}
        {resumo ? (
          <Button
            type="button"
            className="min-h-14 flex-1 text-xl"
            disabled={pendente}
            onClick={confirmar}
          >
            {pendente ? "Salvando…" : "Confirmar"}
          </Button>
        ) : (
          <Button type="button" className="min-h-14 flex-1 text-xl" onClick={avancar}>
            {passo === perguntas.length - 1 ? "Revisar" : "Próxima"}
          </Button>
        )}
      </div>
    </div>
  );
}
