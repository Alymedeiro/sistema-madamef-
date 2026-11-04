"use client";

import { useEffect, useId, useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { salvarAgendamento } from "@/app/(app)/agenda/actions";
import { pacotesDisponiveis } from "@/app/(app)/clientes/ficha/pacotes";
import { agendamentoSchema, type AgendamentoInput } from "@/app/(app)/agenda/schemas";
import { MENSAGEM_VALIDACAO } from "@/lib/dominio/agenda";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { dataNoFuso, horaNoFuso } from "@/lib/dominio/tempo";
import type { AgendamentoAgenda, ProfissionalAgenda, ServicoAgenda } from "./dados-agenda";
import { SeletorCliente, type ClienteEscolhida } from "./seletor-cliente";

export type EstadoDialogo =
  | { modo: "novo"; profissionalId: string; data: string; hora: string }
  | { modo: "editar"; agendamento: AgendamentoAgenda };

/** "Encaixar mesmo assim?" — segundo diálogo quando o horário está fora da jornada. */
export function DialogoEncaixe({
  aberto,
  pendente = false,
  onConfirmar,
  onCancelar,
}: {
  aberto: boolean;
  pendente?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onCancelar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Encaixar mesmo assim?</DialogTitle>
          <DialogDescription>{MENSAGEM_VALIDACAO.fora_da_jornada}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancelar} disabled={pendente}>
            Não, escolher outro horário
          </Button>
          <Button type="button" onClick={onConfirmar} disabled={pendente}>
            Sim, encaixar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Props = {
  estado: EstadoDialogo | null;
  profissionais: ProfissionalAgenda[];
  servicos: ServicoAgenda[];
  onFechar: () => void;
};

/** Novo agendamento ou remarcação pelo formulário (dona e recepção). */
export function DialogoAgendamento({ estado, profissionais, servicos, onFechar }: Props) {
  const chave =
    estado?.modo === "editar"
      ? `editar-${estado.agendamento.id}`
      : estado
        ? `novo-${estado.profissionalId}-${estado.data}-${estado.hora}`
        : "fechado";
  return (
    <Dialog open={!!estado} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        {estado && (
          <FormularioAgendamento
            key={chave}
            estado={estado}
            profissionais={profissionais}
            servicos={servicos}
            onSalvo={onFechar}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function valoresIniciais(estado: EstadoDialogo) {
  if (estado.modo === "novo") {
    return {
      cliente: null as ClienteEscolhida | null,
      profissionalId: estado.profissionalId,
      servicoId: "",
      data: estado.data,
      hora: estado.hora,
      observacoes: "",
    };
  }
  const a = estado.agendamento;
  return {
    cliente: { id: a.clienteId, nome: a.clienteNome } as ClienteEscolhida | null,
    profissionalId: a.profissionalId,
    servicoId: a.servicoId,
    data: dataNoFuso(a.inicio),
    hora: horaNoFuso(a.inicio),
    observacoes: a.observacoes ?? "",
  };
}

function FormularioAgendamento({
  estado,
  profissionais,
  servicos,
  onSalvo,
}: {
  estado: EstadoDialogo;
  profissionais: ProfissionalAgenda[];
  servicos: ServicoAgenda[];
  onSalvo: () => void;
}) {
  const id = useId();
  const [v, setV] = useState(() => valoresIniciais(estado));
  const [erro, setErro] = useState<string | null>(null);
  const [erroCliente, setErroCliente] = useState<string | undefined>();
  const [encaixe, setEncaixe] = useState(false);
  const [pendente, iniciar] = useTransition();
  const [pacotes, setPacotes] = useState<{ id: string; restantes: number; validade: string | null }[]>([]);
  const [usarPacote, setUsarPacote] = useState(true);

  const editando = estado.modo === "editar";
  const profissional = profissionais.find((p) => p.id === v.profissionalId);
  const servicosDaProfissional = servicos.filter(
    (s) => s.ativo && profissional?.servicoIds.includes(s.id),
  );

  // Cliente + serviço escolhidos: procura pacote com sessão disponível (só em novo agendamento).
  const clienteId = v.cliente?.id;
  useEffect(() => {
    if (editando || !clienteId || !v.servicoId) {
      setPacotes([]);
      return;
    }
    let ativo = true;
    pacotesDisponiveis(clienteId, v.servicoId)
      .then((lista) => {
        if (!ativo) return;
        setPacotes(lista);
        setUsarPacote(true);
      })
      .catch(() => ativo && setPacotes([]));
    return () => {
      ativo = false;
    };
  }, [editando, clienteId, v.servicoId]);

  const pacote = pacotes[0] ?? null;

  function dados(forcarForaJornada: boolean): AgendamentoInput {
    return {
      id: editando ? estado.agendamento.id : undefined,
      clienteId: v.cliente?.id ?? "",
      profissionalId: v.profissionalId,
      servicoId: v.servicoId,
      data: v.data,
      hora: v.hora,
      observacoes: v.observacoes,
      forcarForaJornada,
      ...(!editando && pacote && usarPacote ? { pacoteVendidoId: pacote.id } : {}),
    };
  }

  function enviar(forcar: boolean) {
    const entrada = dados(forcar);
    const check = agendamentoSchema.safeParse(entrada);
    if (!v.cliente) {
      setErroCliente("Escolha ou cadastre a cliente.");
      return;
    }
    setErroCliente(undefined);
    if (!check.success) {
      setErro(check.error.issues[0].message);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await salvarAgendamento(entrada);
      if (r.ok) {
        setEncaixe(false);
        toast.success(editando ? "Agendamento atualizado." : "Agendamento criado.");
        onSalvo();
      } else if ("aviso" in r) {
        setEncaixe(true);
      } else {
        setEncaixe(false);
        setErro(r.erro);
      }
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{editando ? "Remarcar agendamento" : "Novo agendamento"}</DialogTitle>
        <DialogDescription>Horários de São Paulo.</DialogDescription>
      </DialogHeader>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(false);
        }}
      >
        <SeletorCliente
          cliente={v.cliente}
          onEscolher={(cliente) => setV((x) => ({ ...x, cliente }))}
          erro={erroCliente}
        />

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-prof`}>Profissional</Label>
          <Select
            id={`${id}-prof`}
            value={v.profissionalId}
            onChange={(e) => setV((x) => ({ ...x, profissionalId: e.target.value, servicoId: "" }))}
          >
            {profissionais.map((p) => (
              <option key={p.id} value={p.id} disabled={!p.aceitaAgendamento}>
                {p.nome}
                {p.aceitaAgendamento ? "" : p.ativa ? " (sem serviços ativos)" : " (inativa)"}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-data`}>Data</Label>
            <Input
              id={`${id}-data`}
              type="date"
              value={v.data}
              onChange={(e) => setV((x) => ({ ...x, data: e.target.value }))}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-hora`}>Horário</Label>
            <Input
              id={`${id}-hora`}
              type="time"
              step={300}
              value={v.hora}
              onChange={(e) => setV((x) => ({ ...x, hora: e.target.value }))}
              required
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-servico`}>Serviço</Label>
          <Select
            id={`${id}-servico`}
            value={v.servicoId}
            onChange={(e) => setV((x) => ({ ...x, servicoId: e.target.value }))}
            required
          >
            <option value="">Escolha o serviço</option>
            {servicosDaProfissional.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nome} · {s.duracaoMin} min · {formatarBRL(s.precoCentavos)}
              </option>
            ))}
          </Select>
          {servicosDaProfissional.length === 0 && (
            <p className="text-sm text-muted-foreground">Esta profissional não tem serviços ativos.</p>
          )}
        </div>

        {pacote && (
          <label className="flex min-h-11 items-center gap-3 rounded-md border bg-blush p-3 text-sm font-medium">
            <input
              type="checkbox"
              className="size-5"
              checked={usarPacote}
              onChange={(e) => setUsarPacote(e.target.checked)}
            />
            Usar sessão do pacote (restam {pacote.restantes})
          </label>
        )}

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-obs`}>Observações</Label>
          <textarea
            id={`${id}-obs`}
            value={v.observacoes}
            onChange={(e) => setV((x) => ({ ...x, observacoes: e.target.value }))}
            rows={3}
            maxLength={1000}
            className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm"
          />
        </div>

        {erro && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {erro}
          </p>
        )}

        <DialogFooter>
          <Button type="submit" disabled={pendente}>
            {pendente ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </form>

      <DialogoEncaixe
        aberto={encaixe}
        pendente={pendente}
        onConfirmar={() => enviar(true)}
        onCancelar={() => setEncaixe(false)}
      />
    </>
  );
}
