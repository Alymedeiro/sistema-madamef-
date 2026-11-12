import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Aniversariante } from "@/app/(app)/crm/dados";
import { ROTULO_STATUS_MENSAGEM } from "@/lib/dominio/whatsapp";

const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

function textoOptin(a: Aniversariante): string {
  if (a.envio === "sem_whatsapp") return "Sem WhatsApp";
  return a.aceitaMarketing ? "Aceita marketing" : "Sem opt-in";
}

function textoMensagem(a: Aniversariante): string {
  if (a.statusFila) return ROTULO_STATUS_MENSAGEM[a.statusFila];
  if (a.envio === "sem_whatsapp") return "Sem WhatsApp";
  if (a.envio === "sem_optin") return "Sem opt-in: não envia";
  return "Entra na fila no dia";
}

function LinkCliente({ a }: { a: Aniversariante }) {
  return (
    <Link
      href={`/clientes/${a.clienteId}`}
      className="font-medium text-ouro-escuro underline-offset-4 hover:underline"
    >
      {a.nome}
    </Link>
  );
}

export function ListaAniversariantes({ itens, hoje }: { itens: Aniversariante[]; hoje: string }) {
  if (itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhum aniversário hoje nem nos próximos 7 dias.</p>;
  }
  const rotuloDia = (a: Aniversariante) => (a.dia === hoje ? "Hoje" : diaMes(a.dia));
  return (
    <>
      <div className="hidden rounded-xl border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Data</TableHead>
              <TableHead>Idade que faz</TableHead>
              <TableHead>Opt-in</TableHead>
              <TableHead>Mensagem do dia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {itens.map((a) => (
              <TableRow key={`${a.clienteId}-${a.dia}`} data-testid="linha-aniversariante">
                <TableCell>
                  <LinkCliente a={a} />
                </TableCell>
                <TableCell className="tabular-nums">
                  {rotuloDia(a)}
                  {a.dia === hoje ? ` (${diaMes(a.dia)})` : ""}
                </TableCell>
                <TableCell className="tabular-nums">{a.idade} anos</TableCell>
                <TableCell>{textoOptin(a)}</TableCell>
                <TableCell>{textoMensagem(a)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="flex flex-col gap-3 md:hidden">
        {itens.map((a) => (
          <li
            key={`${a.clienteId}-${a.dia}`}
            data-testid="cartao-aniversariante"
            className="flex flex-col gap-1 rounded-xl border bg-card p-4 text-sm shadow-sm"
          >
            <LinkCliente a={a} />
            <span className="text-xs text-muted-foreground tabular-nums">
              {rotuloDia(a)} · faz {a.idade} anos
            </span>
            <span className="text-xs text-muted-foreground">
              {textoOptin(a)} · {textoMensagem(a)}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
