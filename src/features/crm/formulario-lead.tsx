"use client";

import { useId, useState, useTransition } from "react";
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
import { salvarLead } from "@/app/(app)/crm/actions";
import type { Lead, OpcoesLead } from "@/app/(app)/crm/dados";
import { formatarTelefone } from "@/lib/dominio/telefone";

type Props = {
  aberto: boolean;
  onFechar: () => void;
  /** Sem lead = novo lead. */
  lead: Lead | null;
  opcoes: OpcoesLead;
};

export function DialogoLead(props: Props) {
  return (
    <Dialog open={props.aberto} onOpenChange={(v) => !v && props.onFechar()}>
      <DialogContent>{props.aberto && <Formulario {...props} />}</DialogContent>
    </Dialog>
  );
}

function Formulario({ onFechar, lead, opcoes }: Props) {
  const id = useId();
  const [nome, setNome] = useState(lead?.nome ?? "");
  const [whatsapp, setWhatsapp] = useState(lead?.whatsapp ? formatarTelefone(lead.whatsapp) : "");
  const [servicoId, setServicoId] = useState(lead?.servicoId ?? "");
  const [origem, setOrigem] = useState(lead?.origem ?? "");
  const [responsavelId, setResponsavelId] = useState(lead?.responsavelId ?? "");
  const [observacoes, setObservacoes] = useState(lead?.observacoes ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    iniciar(async () => {
      const r = await salvarLead({
        id: lead?.id,
        nome,
        whatsapp,
        servicoId,
        origem,
        responsavelId,
        observacoes,
      });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success(lead ? "Lead atualizado." : "Lead criado.");
      onFechar();
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
        <DialogDescription>Contato que ainda não é cliente.</DialogDescription>
      </DialogHeader>
      <form noValidate onSubmit={salvar} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-nome`}>Nome</Label>
          <Input id={`${id}-nome`} value={nome} onChange={(e) => setNome(e.target.value)} required />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-whatsapp`}>WhatsApp</Label>
          <Input
            id={`${id}-whatsapp`}
            type="tel"
            inputMode="tel"
            value={whatsapp}
            onChange={(e) => setWhatsapp(e.target.value)}
            placeholder="(11) 98765-4321"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-servico`}>Serviço de interesse</Label>
            <Select id={`${id}-servico`} value={servicoId} onChange={(e) => setServicoId(e.target.value)}>
              <option value="">Nenhum</option>
              {opcoes.servicos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nome}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-responsavel`}>Responsável</Label>
            <Select
              id={`${id}-responsavel`}
              value={responsavelId}
              onChange={(e) => setResponsavelId(e.target.value)}
            >
              <option value="">Ninguém</option>
              {opcoes.responsaveis.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-origem`}>Origem</Label>
          <Input
            id={`${id}-origem`}
            value={origem}
            onChange={(e) => setOrigem(e.target.value)}
            placeholder="Instagram, indicação…"
            maxLength={80}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={`${id}-obs`}>Observações</Label>
          <textarea
            id={`${id}-obs`}
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            rows={3}
            maxLength={2000}
            className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm"
          />
        </div>
        {erro && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {erro}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
            Cancelar
          </Button>
          <Button type="submit" disabled={pendente}>
            {pendente ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
