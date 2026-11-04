import { CartaoPainel, ListaAniversariantes, ListaAtendimentos, ListaEstoqueBaixo } from "@/features/inicio/cartoes";
import {
  aguardandoConfirmacao,
  aniversariantesDaSemana,
  atendidosSemPagamento,
  atendimentosDoDia,
  produtosComEstoqueBaixo,
} from "@/features/inicio/dados";
import { diasDaSemana, primeiroNome, saudacaoPorHora } from "@/features/inicio/painel";
import { ListaSemPagamento } from "@/features/inicio/sem-pagamento";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Início | Madame Fê Clinic" };

export default async function InicioPage() {
  const { colaborador } = await exigirPerfil();
  const agora = new Date();
  const { hoje, amanha, fimSemana } = diasDaSemana(agora);
  const ehDona = colaborador.perfil === "dona";
  const gerencia = ehDona || colaborador.perfil === "recepcao";
  const supabase = await createClient();

  const [atendimentos, pendentes, semPagamento, aniversarios, estoque] = await Promise.all([
    atendimentosDoDia(supabase, hoje),
    gerencia ? aguardandoConfirmacao(supabase, hoje, amanha) : [],
    gerencia ? atendidosSemPagamento(supabase, hoje) : [],
    gerencia ? aniversariantesDaSemana(supabase, hoje, fimSemana) : [],
    ehDona ? produtosComEstoqueBaixo(supabase) : [],
  ]);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-script text-4xl text-ouro-escuro">
        {saudacaoPorHora(agora)}, {primeiroNome(colaborador.nome)}
      </h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <CartaoPainel
          id="atendimentos-t"
          titulo="Atendimentos de hoje"
          vazio={atendimentos.length === 0}
          vazioTexto="Nenhum atendimento hoje"
        >
          <ListaAtendimentos itens={atendimentos} />
        </CartaoPainel>

        {gerencia && (
          <>
            <CartaoPainel
              id="pendentes-t"
              titulo="Aguardando confirmação"
              vazio={pendentes.length === 0}
              vazioTexto="Nenhum atendimento aguardando confirmação"
            >
              <ListaAtendimentos itens={pendentes} comDia hoje={hoje} />
            </CartaoPainel>

            <CartaoPainel
              id="sem-pagamento-t"
              titulo="Atendidos sem pagamento"
              vazio={semPagamento.length === 0}
              vazioTexto="Nenhum atendimento sem pagamento"
            >
              <ListaSemPagamento itens={semPagamento} />
            </CartaoPainel>

            <CartaoPainel
              id="aniversarios-t"
              titulo="Aniversariantes da semana"
              vazio={aniversarios.length === 0}
              vazioTexto="Nenhum aniversariante nesta semana"
            >
              <ListaAniversariantes itens={aniversarios} />
            </CartaoPainel>
          </>
        )}

        {ehDona && (
          <CartaoPainel
            id="estoque-t"
            titulo="Estoque baixo"
            vazio={estoque.length === 0}
            vazioTexto="Nenhum produto com estoque baixo"
          >
            <ListaEstoqueBaixo itens={estoque} />
          </CartaoPainel>
        )}
      </div>
    </div>
  );
}
