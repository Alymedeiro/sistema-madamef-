import Link from "next/link";
import { FiltrosFila, ListaFila } from "@/features/mensagens/lista-fila";
import { FiltrosRespostas } from "@/features/mensagens/lista-respostas";
import { TelaConversas } from "@/features/mensagens/tela-conversas";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import {
  ROTULO_CLASSIFICACAO,
  ROTULO_STATUS_MENSAGEM,
  ROTULO_TIPO_MENSAGEM,
  type ClassificacaoResposta,
  type StatusMensagem,
  type TipoMensagem,
} from "@/lib/dominio/whatsapp";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { carregarConversas, carregarFila, envioWhatsappAtivo, type FiltroFila } from "./dados";

export const metadata = { title: "Mensagens | Madame Fê Clinic" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const unico = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function valorDe<T extends string>(
  rotulos: Record<T, string>,
  v: string | undefined,
): T | undefined {
  return v && v in rotulos ? (v as T) : undefined;
}

const ABAS = [
  { aba: "fila", rotulo: "Fila" },
  { aba: "respostas", rotulo: "Respostas" },
] as const;

export default async function MensagensPage({ searchParams }: Props) {
  await exigirPerfil(...perfisComAcesso("mensagens"));
  const busca = await searchParams;
  const aba = unico(busca.aba) === "respostas" ? "respostas" : "fila";

  const supabase = await createClient();
  // Falha ao ler a configuração não derruba a tela: só esconde o aviso.
  const ativo = await envioWhatsappAtivo(supabase).catch(() => true);

  let conteudo: React.ReactNode;
  if (aba === "fila") {
    const filtro: FiltroFila = {
      status: valorDe<StatusMensagem>(ROTULO_STATUS_MENSAGEM, unico(busca.status)),
      tipo: valorDe<TipoMensagem>(ROTULO_TIPO_MENSAGEM, unico(busca.tipo)),
      busca: (unico(busca.busca) ?? "").slice(0, 100),
    };
    const itens = await carregarFila(supabase, filtro);
    conteudo = (
      <>
        <FiltrosFila filtro={filtro} />
        <ListaFila itens={itens} />
      </>
    );
  } else {
    const classificacao =
      valorDe<ClassificacaoResposta>(ROTULO_CLASSIFICACAO, unico(busca.classificacao)) ?? null;
    const conversas = await carregarConversas(supabase, classificacao ? { classificacao } : {});
    conteudo = (
      <>
        <FiltrosRespostas classificacao={classificacao} />
        <TelaConversas
          key={classificacao ?? "todas"}
          iniciais={conversas}
          classificacao={classificacao}
          envioAtivo={ativo}
          chaveInicial={unico(busca.conversa) ?? null}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
        Mensagens
      </h1>

      {!ativo && (
        <p className="rounded-md border bg-blush p-3 text-sm">
          O envio automático está desligado: as mensagens ficam na fila até ele ser ligado em
          Configurações.
        </p>
      )}

      <nav aria-label="Mensagens" className="flex gap-1 rounded-lg bg-muted p-1 sm:w-fit">
        {ABAS.map((a) => (
          <Link
            key={a.aba}
            href={`/mensagens?aba=${a.aba}`}
            aria-current={a.aba === aba ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center rounded-md px-6 text-sm font-medium text-muted-foreground sm:flex-none",
              a.aba === aba && "bg-card text-foreground shadow-sm",
            )}
          >
            {a.rotulo}
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-4">{conteudo}</div>
    </div>
  );
}
