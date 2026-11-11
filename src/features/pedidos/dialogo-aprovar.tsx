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
import { aprovarPedido, sugerirClientes } from "@/app/(app)/agenda/pedidos/actions";
import { DialogoEncaixe } from "@/features/agenda/dialogo-agendamento";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { dataNoFuso, formatarNoFuso, horaNoFuso } from "@/lib/dominio/tempo";
import { BotaoWhatsApp, descricaoAviso } from "./botao-whatsapp";
import type { PedidoLista, ProfissionalPedido } from "./dados";

type Props = {
  pedido: PedidoLista | null;
  profissionais: ProfissionalPedido[];
  onFechar: () => void;
};

/** Aprovação de um pedido online: cliente, profissional e horário, depois o aviso. */
export function DialogoAprovar({ pedido, profissionais, onFechar }: Props) {
  return (
    <Dialog open={!!pedido} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent>
        {pedido && (
          <FormularioAprovar
            key={pedido.id}
            pedido={pedido}
            profissionais={profissionais}
            onFechar={onFechar}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const NOVA = "nova";

function FormularioAprovar({
  pedido,
  profissionais,
  onFechar,
}: {
  pedido: PedidoLista;
  profissionais: ProfissionalPedido[];
  onFechar: () => void;
}) {
  const id = useId();
  const [sugestoes, setSugestoes] = useState<{ id: string; nome: string }[]>([]);
  const [escolha, setEscolha] = useState<string>(NOVA);
  const [nova, setNova] = useState({
    nome: pedido.nome ?? "",
    whatsapp: pedido.whatsapp ? formatarTelefone(pedido.whatsapp) : "",
  });
  const [profissionalId, setProfissionalId] = useState(pedido.profissionalId);
  const [data, setData] = useState(dataNoFuso(pedido.inicio));
  const [hora, setHora] = useState(horaNoFuso(pedido.inicio));
  const [erro, setErro] = useState<string | null>(null);
  const [encaixe, setEncaixe] = useState(false);
  const [resultado, setResultado] = useState<{ mensagem: string; link: string; naFila: boolean } | null>(null);
  const [pendente, iniciar] = useTransition();

  // Sugestão pelo WhatsApp normalizado: a primeira cadastrada já vem escolhida.
  useEffect(() => {
    if (!pedido.whatsapp) return;
    let ativo = true;
    sugerirClientes(pedido.whatsapp)
      .then((lista) => {
        if (!ativo) return;
        setSugestoes(lista);
        if (lista.length > 0) setEscolha(lista[0].id);
      })
      .catch(() => ativo && setSugestoes([]));
    return () => {
      ativo = false;
    };
  }, [pedido.whatsapp]);

  const opcoes = profissionais.filter((p) => p.servicoIds.includes(pedido.servicoId));
  const original = opcoes.some((p) => p.id === pedido.profissionalId);

  function enviar(forcarForaJornada: boolean) {
    setErro(null);
    iniciar(async () => {
      const r = await aprovarPedido({
        pedidoId: pedido.id,
        clienteId: escolha === NOVA ? null : escolha,
        novaCliente: escolha === NOVA ? nova : undefined,
        profissionalId,
        data,
        hora,
        forcarForaJornada,
      });
      if (r.ok) {
        setEncaixe(false);
        toast.success("Pedido aprovado. O horário está na agenda.");
        setResultado({ mensagem: r.mensagem, link: r.link, naFila: r.naFila });
      } else if ("aviso" in r) {
        setEncaixe(true);
      } else {
        setEncaixe(false);
        setErro(r.erro);
        // A cliente já foi cadastrada: tentar de novo aprova com ela.
        if ("clienteId" in r && r.clienteId) {
          const cadastrada = { id: r.clienteId, nome: nova.nome.trim() };
          setSugestoes((lista) =>
            lista.some((c) => c.id === cadastrada.id) ? lista : [cadastrada, ...lista],
          );
          setEscolha(cadastrada.id);
        }
      }
    });
  }

  if (resultado) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Pedido aprovado</DialogTitle>
          <DialogDescription>{descricaoAviso(resultado.naFila)}</DialogDescription>
        </DialogHeader>
        <BotaoWhatsApp link={resultado.link} mensagem={resultado.mensagem} naFila={resultado.naFila} />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar}>
            Fechar
          </Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Aprovar pedido</DialogTitle>
        <DialogDescription>
          {pedido.servicoNome} · pedido para {formatarNoFuso(pedido.inicio, "dd/MM 'às' HH:mm")}.
          Horários de São Paulo.
        </DialogDescription>
      </DialogHeader>

      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          enviar(false);
        }}
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Cliente</legend>
          {sugestoes.map((c) => (
            <label key={c.id} className="flex min-h-11 items-center gap-3 rounded-md border p-3 text-sm">
              <input
                type="radio"
                name={`${id}-cliente`}
                className="size-5"
                checked={escolha === c.id}
                onChange={() => setEscolha(c.id)}
              />
              É a {c.nome} (cadastrada)?
            </label>
          ))}
          <label className="flex min-h-11 items-center gap-3 rounded-md border p-3 text-sm">
            <input
              type="radio"
              name={`${id}-cliente`}
              className="size-5"
              checked={escolha === NOVA}
              onChange={() => setEscolha(NOVA)}
            />
            Cadastrar nova cliente
          </label>
          {escolha === NOVA && (
            <div className="flex flex-col gap-3 rounded-md border bg-blush p-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-nome`}>Nome</Label>
                <Input
                  id={`${id}-nome`}
                  value={nova.nome}
                  maxLength={120}
                  onChange={(e) => setNova((x) => ({ ...x, nome: e.target.value }))}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-whats`}>WhatsApp</Label>
                <Input
                  id={`${id}-whats`}
                  type="tel"
                  inputMode="tel"
                  value={nova.whatsapp}
                  onChange={(e) => setNova((x) => ({ ...x, whatsapp: e.target.value }))}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Aceite LGPD registrado com a data do pedido (a cliente aceitou o aviso na página).
              </p>
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-prof`}>Profissional</Label>
          <Select id={`${id}-prof`} value={profissionalId} onChange={(e) => setProfissionalId(e.target.value)}>
            {!original && <option value={pedido.profissionalId}>{pedido.profissionalNome}</option>}
            {opcoes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-data`}>Data</Label>
            <Input id={`${id}-data`} type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-hora`}>Horário</Label>
            <Input
              id={`${id}-hora`}
              type="time"
              step={300}
              value={hora}
              onChange={(e) => setHora(e.target.value)}
            />
          </div>
        </div>

        {erro && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {erro}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pendente}>
            {pendente ? "Aprovando…" : "Confirmar agendamento"}
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
