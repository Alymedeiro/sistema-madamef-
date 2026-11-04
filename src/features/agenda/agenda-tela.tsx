"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { remarcarAgendamento } from "@/app/(app)/agenda/actions";
import type { Perfil } from "@/lib/dominio/permissoes";
import { combinarDataHora } from "@/lib/dominio/tempo";
import { BarraAgenda } from "./barra-agenda";
import { DetalhesAgendamento, SombraCartao } from "./cartao-agendamento";
import { ALTURA_LINHA } from "./coluna-agenda";
import type { AgendamentoAgenda, DadosAgenda } from "./dados-agenda";
import { DialogoAgendamento, DialogoEncaixe, type EstadoDialogo } from "./dialogo-agendamento";
import { hrefAgenda, lerIdDoHorario, PASSO_MIN, type Visao } from "./grade";
import { GradeDia } from "./grade-dia";
import { GradeSemana } from "./grade-semana";
import { useTelaGrande } from "./use-tela-grande";

type Props = {
  dados: DadosAgenda;
  data: string;
  datas: string[];
  visao: Visao;
  prof: string | null;
  perfil: Perfil;
};

type Movimento = { profissionalId: string; data: string; hora: string };

/** Alvo do arrastar = horário sob o topo do cartão (snap nas linhas de 15 min). */
const topoDoCartao: CollisionDetection = ({ collisionRect, droppableContainers, droppableRects }) => {
  const x = collisionRect.left + collisionRect.width / 2;
  const y = collisionRect.top + 2;
  for (const c of droppableContainers) {
    const r = droppableRects.get(c.id);
    if (r && x >= r.left && x < r.right && y >= r.top && y < r.bottom) return [{ id: c.id }];
  }
  return [];
};

function aplicarMovimento(a: AgendamentoAgenda, m: Movimento): AgendamentoAgenda {
  const inicio = combinarDataHora(m.data, m.hora);
  const duracao = new Date(a.fim).getTime() - new Date(a.inicio).getTime();
  return {
    ...a,
    profissionalId: m.profissionalId,
    inicio: inicio.toISOString(),
    fim: new Date(inicio.getTime() + duracao).toISOString(),
  };
}

export function AgendaTela({ dados, data, datas, visao, prof, perfil }: Props) {
  const router = useRouter();
  const telaGrande = useTelaGrande();
  const podeAgendar = perfil !== "profissional";
  const podeArrastar = podeAgendar && telaGrande;

  const [escolhida, setSelecionada] = useState<string | null>(prof);
  // Se a escolhida não está mais na agenda (ou nunca esteve), vale a primeira.
  const selecionada = dados.profissionais.some((p) => p.id === escolhida)
    ? escolhida
    : (dados.profissionais[0]?.id ?? null);
  const [dialogo, setDialogo] = useState<EstadoDialogo | null>(null);
  const [aberto, setAberto] = useState<AgendamentoAgenda | null>(null);
  const [arrastando, setArrastando] = useState<AgendamentoAgenda | null>(null);
  const [encaixe, setEncaixe] = useState<{ id: string; m: Movimento } | null>(null);
  const [, iniciar] = useTransition();

  // Remarcações otimistas até o servidor devolver a agenda atualizada.
  const [movimentos, setMovimentos] = useState<Record<string, Movimento>>({});
  const [base, setBase] = useState(dados.agendamentos);
  if (base !== dados.agendamentos) {
    setBase(dados.agendamentos);
    setMovimentos({});
  }
  const agendamentos = dados.agendamentos.map((a) =>
    movimentos[a.id] ? aplicarMovimento(a, movimentos[a.id]) : a,
  );

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  function selecionar(id: string) {
    setSelecionada(id);
    window.history.replaceState(null, "", hrefAgenda({ data, visao, prof: id }));
  }

  function desfazer(id: string, mensagem: string, erro = true) {
    setMovimentos(({ [id]: _desfeito, ...resto }) => {
      void _desfeito;
      return resto;
    });
    if (erro) toast.error(mensagem);
    else toast.info(mensagem);
  }

  function remarcar(id: string, m: Movimento, forcar: boolean) {
    iniciar(async () => {
      try {
        const r = await remarcarAgendamento(id, m.profissionalId, m.data, m.hora, forcar);
        if (r.ok) {
          setEncaixe(null);
          toast.success("Agendamento remarcado.");
          router.refresh();
        } else if ("aviso" in r) {
          setEncaixe({ id, m });
        } else {
          setEncaixe(null);
          desfazer(id, r.erro);
        }
      } catch {
        setEncaixe(null);
        desfazer(id, "Não foi possível remarcar. Tente novamente.");
      }
    });
  }

  function aoSoltar(e: DragEndEvent) {
    setArrastando(null);
    const alvo = e.over ? lerIdDoHorario(String(e.over.id)) : null;
    const a = dados.agendamentos.find((x) => x.id === String(e.active.id));
    if (!alvo || !a) return;
    const atual = agendamentos.find((x) => x.id === a.id)!;
    if (
      atual.profissionalId === alvo.profissionalId &&
      combinarDataHora(alvo.data, alvo.hora).toISOString() === new Date(atual.inicio).toISOString()
    ) {
      return;
    }
    setMovimentos((ms) => ({ ...ms, [a.id]: alvo }));
    remarcar(a.id, alvo, false);
  }

  function aoComecar(e: DragStartEvent) {
    setArrastando(agendamentos.find((a) => a.id === String(e.active.id)) ?? null);
  }

  const nomeProfissional = (id: string) => dados.profissionais.find((p) => p.id === id)?.nome ?? "";
  const corProfissional = (id: string) => dados.profissionais.find((p) => p.id === id)?.cor ?? "#986818";

  const propsGrade = {
    dados,
    agendamentos,
    podeAgendar,
    podeArrastar,
    onNovo: (profissionalId: string, d: string, hora: string) =>
      setDialogo({ modo: "novo", profissionalId, data: d, hora }),
    onAbrir: (a: AgendamentoAgenda) => setAberto(a),
  };

  return (
    <div className="flex flex-col gap-4">
      <BarraAgenda
        data={data}
        datas={datas}
        visao={visao}
        profissionais={dados.profissionais}
        selecionada={selecionada}
        onSelecionar={selecionar}
      />

      {dados.profissionais.length === 0 ? (
        <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
          Nenhuma profissional com serviços ativos. Cadastre a equipe e os serviços que cada uma
          realiza.
        </p>
      ) : (
        <DndContext
          sensors={sensores}
          collisionDetection={topoDoCartao}
          onDragStart={aoComecar}
          onDragEnd={aoSoltar}
          onDragCancel={() => setArrastando(null)}
        >
          {visao === "dia" ? (
            <GradeDia {...propsGrade} data={data} selecionada={selecionada} />
          ) : (
            <GradeSemana
              {...propsGrade}
              datas={datas}
              profissionalId={selecionada ?? dados.profissionais[0].id}
            />
          )}
          <DragOverlay dropAnimation={null}>
            {arrastando && (
              <SombraCartao
                agendamento={arrastando}
                corProfissional={corProfissional(arrastando.profissionalId)}
                alturaPx={
                  ((new Date(arrastando.fim).getTime() - new Date(arrastando.inicio).getTime()) /
                    60_000 /
                    PASSO_MIN) *
                    ALTURA_LINHA -
                  2
                }
              />
            )}
          </DragOverlay>
        </DndContext>
      )}

      <DialogoAgendamento
        estado={dialogo}
        profissionais={dados.profissionais}
        servicos={dados.servicos}
        onFechar={() => setDialogo(null)}
      />

      <DetalhesAgendamento
        agendamento={aberto}
        profissionalNome={aberto ? nomeProfissional(aberto.profissionalId) : ""}
        perfil={perfil}
        onFechar={() => setAberto(null)}
        onRemarcar={(a) => {
          setAberto(null);
          setDialogo({ modo: "editar", agendamento: a });
        }}
        onAbrirPagamento={() =>
          // Ponto de integração da Task 12 (diálogo de pagamento).
          toast.info("Atendimento concluído. Registre o pagamento no caixa.")
        }
      />

      <DialogoEncaixe
        aberto={!!encaixe}
        onConfirmar={() => encaixe && remarcar(encaixe.id, encaixe.m, true)}
        onCancelar={() => {
          if (encaixe) desfazer(encaixe.id, "Remarcação cancelada.", false);
          setEncaixe(null);
        }}
      />
    </div>
  );
}
