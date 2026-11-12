import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  ROTULO_STATUS_MENSAGEM,
  ROTULO_TIPO_MENSAGEM,
} from "@/lib/dominio/whatsapp";
import { ROTULO_LEITURA, type FiltroConversas } from "./filtro-conversas";

/** Filtros da tela: formulário GET (funciona sem JavaScript e fica no link). */
export function FiltrosConversas({ filtro }: { filtro: FiltroConversas }) {
  return (
    <form
      method="get"
      action="/mensagens"
      className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_2fr_auto] lg:items-end"
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="msg-status">Status</Label>
        <Select
          id="msg-status"
          name="status"
          defaultValue={filtro.status ?? ""}
        >
          <option value="">Todos</option>
          {Object.entries(ROTULO_STATUS_MENSAGEM).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="msg-tipo">Tipo</Label>
        <Select id="msg-tipo" name="tipo" defaultValue={filtro.tipo ?? ""}>
          <option value="">Todos</option>
          {Object.entries(ROTULO_TIPO_MENSAGEM).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="msg-leitura">Leitura</Label>
        <Select
          id="msg-leitura"
          name="leitura"
          defaultValue={filtro.leitura ?? ""}
        >
          <option value="">Todas</option>
          {Object.entries(ROTULO_LEITURA).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
        <Label htmlFor="msg-busca">Cliente</Label>
        <Input
          id="msg-busca"
          name="busca"
          type="search"
          defaultValue={filtro.busca ?? ""}
          placeholder="Nome ou WhatsApp"
        />
      </div>
      <Button
        type="submit"
        variant="secondary"
        className="sm:col-span-2 lg:col-span-1"
      >
        Filtrar
      </Button>
    </form>
  );
}
