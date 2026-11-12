"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { MessageCircle, Pencil, Plus, UserCheck } from "lucide-react";
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
import { moverLead } from "@/app/(app)/crm/actions";
import type { Lead, OpcoesLead } from "@/app/(app)/crm/dados";
import { LIMITE_MOTIVO_PERDA } from "@/app/(app)/crm/schemas";
import { diasSemVir, ETAPAS_LEAD, ROTULO_ETAPA_LEAD, type EtapaLead } from "@/lib/dominio/crm";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { cn } from "@/lib/utils";
import { DialogoConverter } from "./dialogo-converter";
import { DialogoWhatsappLead } from "./dialogo-whatsapp-lead";
import { DialogoLead } from "./formulario-lead";

type Props = { leads: Lead[]; opcoes: OpcoesLead; hoje: string };

type Acoes = {
  editar: (l: Lead) => void;
  converter: (l: Lead) => void;
  whatsapp: (l: Lead) => void;
  mover: (l: Lead, etapa: EtapaLead) => void;
};

export function QuadroLeads({ leads, opcoes, hoje }: Props) {
  const [filtro, setFiltro] = useState<EtapaLead>("novo");
  const [formulario, setFormulario] = useState<{ lead: Lead | null } | null>(null);
  const [convertendo, setConvertendo] = useState<Lead | null>(null);
  const [enviando, setEnviando] = useState<Lead | null>(null);
  const [perdendo, setPerdendo] = useState<Lead | null>(null);
  const [, iniciar] = useTransition();

  function mover(lead: Lead, etapa: EtapaLead, motivo?: string) {
    iniciar(async () => {
      const r = await moverLead({ id: lead.id, etapa, motivo });
      if (!r.ok) toast.error(r.erro);
      else toast.success(`Movido para ${ROTULO_ETAPA_LEAD[etapa]}.`);
    });
  }

  const acoes: Acoes = {
    editar: (l) => setFormulario({ lead: l }),
    converter: setConvertendo,
    whatsapp: setEnviando,
    mover: (l, etapa) => (etapa === "perdido" ? setPerdendo(l) : mover(l, etapa)),
  };

  const porEtapa = (e: EtapaLead) => leads.filter((l) => l.etapa === e);

  return (
    <>
      <div className="flex justify-end">
        <Button type="button" onClick={() => setFormulario({ lead: null })}>
          <Plus aria-hidden />
          Novo lead
        </Button>
      </div>

      {/* Celular e tablet: filtro por etapa + lista. */}
      <div className="flex flex-col gap-3 lg:hidden">
        <div role="group" aria-label="Filtrar por etapa" className="flex flex-wrap gap-2">
          {ETAPAS_LEAD.map((e) => (
            <button
              key={e}
              type="button"
              aria-pressed={filtro === e}
              onClick={() => setFiltro(e)}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium",
                filtro === e ? "border-primary bg-primary text-primary-foreground" : "bg-card",
              )}
            >
              {ROTULO_ETAPA_LEAD[e]} ({porEtapa(e).length})
            </button>
          ))}
        </div>
        <ListaCartoes leads={porEtapa(filtro)} hoje={hoje} acoes={acoes} />
      </div>

      {/* Computador: uma coluna por etapa (quebra em linhas, sem rolagem horizontal). */}
      <div className="hidden gap-4 lg:grid lg:grid-cols-3 xl:grid-cols-5">
        {ETAPAS_LEAD.map((e) => (
          <section key={e} aria-label={ROTULO_ETAPA_LEAD[e]} className="flex min-w-0 flex-col gap-3">
            <h2 className="font-titulo text-base font-semibold text-ouro-escuro">
              {ROTULO_ETAPA_LEAD[e]} ({porEtapa(e).length})
            </h2>
            <ListaCartoes leads={porEtapa(e)} hoje={hoje} acoes={acoes} />
          </section>
        ))}
      </div>

      <DialogoLead
        aberto={formulario !== null}
        onFechar={() => setFormulario(null)}
        lead={formulario?.lead ?? null}
        opcoes={opcoes}
      />
      <DialogoConverter lead={convertendo} onFechar={() => setConvertendo(null)} />
      <DialogoWhatsappLead lead={enviando} onFechar={() => setEnviando(null)} />
      <DialogoPerdido
        lead={perdendo}
        onFechar={() => setPerdendo(null)}
        onConfirmar={(l, motivo) => {
          setPerdendo(null);
          mover(l, "perdido", motivo);
        }}
      />
    </>
  );
}

function ListaCartoes({ leads, hoje, acoes }: { leads: Lead[]; hoje: string; acoes: Acoes }) {
  if (leads.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum lead nesta etapa.</p>;
  }
  return (
    <ul className="flex flex-col gap-3">
      {leads.map((l) => (
        <CartaoLead key={l.id} lead={l} hoje={hoje} acoes={acoes} />
      ))}
    </ul>
  );
}

function CartaoLead({ lead, hoje, acoes }: { lead: Lead; hoje: string; acoes: Acoes }) {
  const dias = diasSemVir(lead.criadoEm, hoje);
  return (
    <li
      data-testid="cartao-lead"
      className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3 text-sm shadow-sm"
    >
      <div className="flex flex-col gap-0.5">
        <span className="font-medium break-words">{lead.nome}</span>
        {lead.whatsapp && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatarTelefone(lead.whatsapp)}
          </span>
        )}
        <span className="text-xs text-muted-foreground">
          {[
            lead.servicoNome,
            lead.origem,
            lead.responsavelNome,
            dias === 0 ? "hoje" : `há ${dias} ${dias === 1 ? "dia" : "dias"}`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {lead.etapa === "perdido" && lead.perdidoMotivo && (
          <span className="text-xs text-muted-foreground">Motivo: {lead.perdidoMotivo}</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => acoes.editar(lead)}>
          <Pencil aria-hidden />
          Editar
        </Button>
        {lead.whatsapp && (
          <Button type="button" variant="outline" size="sm" onClick={() => acoes.whatsapp(lead)}>
            <MessageCircle aria-hidden />
            Enviar WhatsApp
          </Button>
        )}
        {lead.clienteId ? (
          <Link
            href={`/clientes/${lead.clienteId}`}
            className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm font-medium text-ouro-escuro hover:bg-accent"
          >
            Abrir ficha
          </Link>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={() => acoes.converter(lead)}>
            <UserCheck aria-hidden />
            Converter em cliente
          </Button>
        )}
      </div>
      <Select
        aria-label={`Mover ${lead.nome} para…`}
        value=""
        onChange={(e) => e.target.value && acoes.mover(lead, e.target.value as EtapaLead)}
      >
        <option value="">Mover para…</option>
        {ETAPAS_LEAD.filter((e) => e !== lead.etapa).map((e) => (
          <option key={e} value={e}>
            {ROTULO_ETAPA_LEAD[e]}
          </option>
        ))}
      </Select>
    </li>
  );
}

function DialogoPerdido({
  lead,
  onFechar,
  onConfirmar,
}: {
  lead: Lead | null;
  onFechar: () => void;
  onConfirmar: (lead: Lead, motivo: string) => void;
}) {
  const [motivo, setMotivo] = useState("");
  return (
    <Dialog
      open={lead !== null}
      onOpenChange={(v) => {
        if (!v) {
          setMotivo("");
          onFechar();
        }
      }}
    >
      <DialogContent>
        {lead && (
          <>
            <DialogHeader>
              <DialogTitle>Marcar como perdido</DialogTitle>
              <DialogDescription>{lead.nome}. O motivo é opcional.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="motivo-perda">Motivo</Label>
              <Input
                id="motivo-perda"
                value={motivo}
                maxLength={LIMITE_MOTIVO_PERDA}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const m = motivo;
                  setMotivo("");
                  onConfirmar(lead, m);
                }}
              >
                Marcar como perdido
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
