"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { enviarRetorno } from "@/app/(app)/crm/actions";
import type { Retorno } from "@/app/(app)/crm/dados";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";

const SELO = {
  atrasado: { texto: "🔴 Atrasado", classe: "border-destructive/40 bg-destructive/10 text-destructive" },
  semana: { texto: "🟡 Esta semana", classe: "border-amber-300 bg-amber-50 text-amber-900" },
} as const;

function textoMensagem(r: Retorno): string {
  if (r.envio === "enviado" && r.retornoEnviadoEm)
    return `Enviada em ${formatarNoFuso(r.retornoEnviadoEm, "dd/MM")}`;
  if (r.envio === "sem_whatsapp") return "Sem WhatsApp";
  if (r.envio === "sem_optin") return "Sem opt-in";
  return "Não enviada";
}

const dia = (iso: string) => formatarNoFuso(iso, "dd/MM/yyyy");
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

function BotaoEnviarRetorno({ r }: { r: Retorno }) {
  const [pendente, iniciar] = useTransition();
  const [enviado, setEnviado] = useState(false);
  function enviar() {
    iniciar(async () => {
      const res = await enviarRetorno(r.agendamentoId);
      if (!res.ok) toast.error(res.erro);
      else {
        setEnviado(true);
        toast.success("Retorno enviado para a fila.");
      }
    });
  }
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={pendente || enviado || r.envio !== "livre"}
      onClick={enviar}
    >
      Enviar retorno
    </Button>
  );
}

function Selo({ r }: { r: Retorno }) {
  return (
    <Badge variant="outline" className={cn(SELO[r.situacao].classe)}>
      {SELO[r.situacao].texto}
    </Badge>
  );
}

function LinkCliente({ r }: { r: Retorno }) {
  return (
    <Link
      href={`/clientes/${r.clienteId}`}
      className="inline-flex min-h-11 items-center font-medium text-ouro-escuro underline-offset-4 hover:underline"
    >
      {r.clienteNome}
    </Link>
  );
}

export function ListaRetorno({ itens }: { itens: Retorno[] }) {
  if (itens.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum retorno para os próximos 7 dias. Os serviços com “dias para retorno” aparecem aqui.
      </p>
    );
  }
  return (
    <>
      <div className="hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Serviço</TableHead>
              <TableHead>Último atendimento</TableHead>
              <TableHead>Retorno</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead className="w-0" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((r) => (
              <TableRow key={r.agendamentoId} data-testid="linha-retorno">
                <TableCell>
                  <LinkCliente r={r} />
                </TableCell>
                <TableCell>{r.servicoNome}</TableCell>
                <TableCell className="tabular-nums">{dia(r.ultimoAtendimento)}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums">{diaCurto(r.dataRetorno)}</span>
                    <Selo r={r} />
                  </div>
                </TableCell>
                <TableCell>{textoMensagem(r)}</TableCell>
                <TableCell>
                  <BotaoEnviarRetorno r={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {itens.map((r) => (
          <li
            key={r.agendamentoId}
            data-testid="cartao-retorno"
            className="flex flex-col gap-2 rounded-xl border bg-card p-4 text-sm shadow-sm"
          >
            <div className="flex flex-wrap items-center gap-2">
              <LinkCliente r={r} />
              <Selo r={r} />
            </div>
            <span>{r.servicoNome}</span>
            <span className="text-xs text-muted-foreground tabular-nums">
              Último atendimento {dia(r.ultimoAtendimento)} · retorno {diaCurto(r.dataRetorno)}
            </span>
            <span className="text-xs text-muted-foreground">{textoMensagem(r)}</span>
            <BotaoEnviarRetorno r={r} />
          </li>
        ))}
      </ul>
    </>
  );
}
