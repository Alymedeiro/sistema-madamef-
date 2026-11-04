import { AgendaTela } from "@/features/agenda/agenda-tela";
import { parametrosAgenda } from "@/features/agenda/grade";
import { exigirPerfil } from "@/lib/sessao";
import { carregarAgenda, datasDaVisao } from "./dados";

export const metadata = { title: "Agenda | Madame Fê Clinic" };

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AgendaPage({ searchParams }: Props) {
  const { colaborador } = await exigirPerfil("dona", "recepcao", "profissional");
  const { data, visao, prof } = parametrosAgenda(await searchParams);
  const dados = await carregarAgenda(data, visao);

  return (
    <AgendaTela
      dados={dados}
      data={data}
      datas={datasDaVisao(data, visao)}
      visao={visao}
      prof={prof}
      perfil={colaborador.perfil}
    />
  );
}
