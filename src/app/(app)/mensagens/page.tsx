import { FiltrosConversas } from "@/features/mensagens/filtros-conversas";
import { lerFiltro } from "@/features/mensagens/filtro-conversas";
import { TelaConversas } from "@/features/mensagens/tela-conversas";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { carregarConversas, envioWhatsappAtivo } from "./dados";

export const metadata = { title: "Mensagens | Madame Fê Clinic" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function MensagensPage({ searchParams }: Props) {
  await exigirPerfil(...perfisComAcesso("mensagens"));
  const busca = await searchParams;
  // Links antigos (?aba=fila / ?aba=respostas) abrem a mesma tela: `aba` é ignorada.
  const filtro = lerFiltro(busca);
  const conversa = Array.isArray(busca.conversa)
    ? busca.conversa[0]
    : busca.conversa;

  const supabase = await createClient();
  // Falha ao ler a configuração não derruba a tela: só esconde o aviso.
  const ativo = await envioWhatsappAtivo(supabase).catch(() => true);
  let filtroTela = filtro;
  let conversas = await carregarConversas(supabase, filtro);
  // ?conversa= de uma conversa arquivada: abre no filtro "Arquivadas".
  if (conversa && !conversas.some((c) => c.chave === conversa)) {
    const arquivadas = await carregarConversas(supabase, {
      leitura: "arquivadas",
    }).catch(() => []);
    if (arquivadas.some((c) => c.chave === conversa)) {
      filtroTela = { leitura: "arquivadas" };
      conversas = arquivadas;
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
        Mensagens
      </h1>

      {!ativo && (
        <p className="rounded-md border bg-blush p-3 text-sm">
          O envio automático está desligado: as mensagens ficam na fila até ele
          ser ligado em Configurações.
        </p>
      )}

      <div className="flex flex-col gap-4">
        <FiltrosConversas filtro={filtroTela} />
        <TelaConversas
          key={JSON.stringify(filtroTela)}
          iniciais={conversas}
          filtro={filtroTela}
          envioAtivo={ativo}
          chaveInicial={conversa ?? null}
        />
      </div>
    </div>
  );
}
