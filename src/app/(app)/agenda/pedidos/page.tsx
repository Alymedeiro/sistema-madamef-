import {
  listarPedidos,
  profissionaisAtivas,
  STATUS_PEDIDO,
  statusDoPedido,
  type StatusPedido,
} from "@/features/pedidos/dados";
import { ListaPedidos } from "@/features/pedidos/lista-pedidos";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

export const metadata = { title: "Pedidos online | Madame Fê Clinic" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const unico = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function PedidosPage({ searchParams }: Props) {
  await exigirPerfil("dona", "recepcao");
  const busca = await searchParams;
  const pedidoParam = unico(busca.pedido);
  const pedido = pedidoParam && idSchema.safeParse(pedidoParam).success ? pedidoParam : null;
  const statusParam = unico(busca.status);

  const supabase = await createClient();
  let status: StatusPedido = "aguardando";
  if (STATUS_PEDIDO.includes(statusParam as StatusPedido)) {
    status = statusParam as StatusPedido;
  } else if (pedido) {
    // Link da agenda (?pedido=<id>): abre a aba em que o pedido está agora.
    status = (await statusDoPedido(supabase, pedido)) ?? "aguardando";
  }

  const [pedidos, profissionais] = await Promise.all([
    listarPedidos(supabase, status),
    profissionaisAtivas(supabase),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">Pedidos online</h1>
      <ListaPedidos
        key={`${status}-${pedido ?? ""}`}
        status={status}
        pedidos={pedidos}
        profissionais={profissionais}
        agora={new Date().toISOString()}
        pedidoAberto={pedido}
      />
    </div>
  );
}
