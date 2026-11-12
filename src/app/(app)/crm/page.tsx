import { AbasCrm, abaDoCrm } from "@/features/crm/abas-crm";
import { ListaAniversariantes } from "@/features/crm/lista-aniversariantes";
import { ListaRetorno } from "@/features/crm/lista-retorno";
import { ListaSumidas } from "@/features/crm/lista-sumidas";
import { perfisComAcesso } from "@/lib/dominio/permissoes";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import {
  carregarAniversariantes,
  carregarModeloReativacao,
  carregarRetornos,
  carregarSumidas,
} from "./dados";

export const metadata = { title: "CRM | Madame Fê Clinic" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const unico = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CrmPage({ searchParams }: Props) {
  await exigirPerfil(...perfisComAcesso("crm"));
  const busca = await searchParams;
  const aba = abaDoCrm(unico(busca.aba));
  const hoje = dataNoFuso(new Date());
  const supabase = await createClient();

  let conteudo: React.ReactNode;
  if (aba === "retorno") {
    conteudo = <ListaRetorno itens={await carregarRetornos(supabase, hoje)} />;
  } else if (aba === "sumidas") {
    const [itens, modelo] = await Promise.all([
      carregarSumidas(supabase),
      carregarModeloReativacao(supabase),
    ]);
    conteudo = <ListaSumidas itens={itens} modelo={modelo} />;
  } else if (aba === "aniversariantes") {
    conteudo = <ListaAniversariantes itens={await carregarAniversariantes(supabase, hoje)} hoje={hoje} />;
  } else {
    conteudo = (
      <section
        aria-label="Leads"
        className="flex flex-col items-center gap-1 rounded-xl border border-dashed bg-card p-8 text-center"
      >
        <p className="font-medium">Em breve</p>
        <p className="text-sm text-muted-foreground">O quadro de leads chega na próxima etapa.</p>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">CRM</h1>
      <AbasCrm atual={aba} />
      <div className="flex flex-col gap-4">{conteudo}</div>
    </div>
  );
}
