import { CartaoPainel, ListaAniversariantes, ListaAtendimentos, ListaEstoqueBaixo } from "@/features/inicio/cartoes";
import {
  aguardandoConfirmacao,
  aniversariantesDaSemana,
  atendidosSemPagamento,
  atendimentosDoDia,
  produtosComEstoqueBaixo,
} from "@/features/inicio/dados";
import { carregarCartao, diasDaSemana, primeiroNome, saudacaoPorHora, type Cartao } from "@/features/inicio/painel";
import { ListaSemPagamento } from "@/features/inicio/sem-pagamento";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Início | Madame Fê Clinic" };

export default async function InicioPage() {
  const { colaborador } = await exigirPerfil();
  const agora = new Date();
  const { hoje, amanha, fimSemana, seteDiasAtras } = diasDaSemana(agora);
  const ehDona = colaborador.perfil === "dona";
  const gerencia = ehDona || colaborador.perfil === "recepcao";
  const supabase = await createClient();

  // Cada cartão carrega por conta própria: uma falha não apaga o painel.
  const [atendimentos, pendentes, semPagamento, aniversarios, estoque] = await Promise.all([
    carregarCartao(atendimentosDoDia(supabase, hoje)),
    carregarCartao(gerencia ? aguardandoConfirmacao(supabase, hoje, amanha) : Promise.resolve([])),
    carregarCartao(gerencia ? atendidosSemPagamento(supabase, seteDiasAtras, hoje) : Promise.resolve([])),
    carregarCartao(gerencia ? aniversariantesDaSemana(supabase, hoje, fimSemana) : Promise.resolve([])),
    carregarCartao(ehDona ? produtosComEstoqueBaixo(supabase) : Promise.resolve([])),
  ]);
  const estado = <T,>(c: Cartao<T[]>) => ({
    falhou: !c.ok,
    vazio: c.ok && c.dados.length === 0,
    itens: c.ok ? c.dados : [],
  });
  const cAtendimentos = estado(atendimentos);
  const cPendentes = estado(pendentes);
  const cSemPagamento = estado(semPagamento);
  const cAniversarios = estado(aniversarios);
  const cEstoque = estado(estoque);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-script text-4xl text-ouro-escuro">
        {saudacaoPorHora(agora)}, {primeiroNome(colaborador.nome)}
      </h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <CartaoPainel
          id="atendimentos-t"
          titulo="Atendimentos de hoje"
          vazio={cAtendimentos.vazio}
          falhou={cAtendimentos.falhou}
          vazioTexto="Nenhum atendimento hoje"
        >
          <ListaAtendimentos itens={cAtendimentos.itens} />
        </CartaoPainel>

        {gerencia && (
          <>
            <CartaoPainel
              id="pendentes-t"
              titulo="Aguardando confirmação"
              vazio={cPendentes.vazio}
              falhou={cPendentes.falhou}
              vazioTexto="Nenhum atendimento aguardando confirmação"
            >
              <ListaAtendimentos itens={cPendentes.itens} comDia hoje={hoje} />
            </CartaoPainel>

            <CartaoPainel
              id="sem-pagamento-t"
              titulo="Atendidos sem pagamento"
              vazio={cSemPagamento.vazio}
              falhou={cSemPagamento.falhou}
              vazioTexto="Nenhum atendimento sem pagamento nos últimos 7 dias"
            >
              <ListaSemPagamento itens={cSemPagamento.itens} hoje={hoje} />
            </CartaoPainel>

            <CartaoPainel
              id="aniversarios-t"
              titulo="Aniversariantes da semana"
              vazio={cAniversarios.vazio}
              falhou={cAniversarios.falhou}
              vazioTexto="Nenhum aniversariante nesta semana"
            >
              <ListaAniversariantes itens={cAniversarios.itens} />
            </CartaoPainel>
          </>
        )}

        {ehDona && (
          <CartaoPainel
            id="estoque-t"
            titulo="Estoque baixo"
            vazio={cEstoque.vazio}
            falhou={cEstoque.falhou}
            vazioTexto="Nenhum produto com estoque baixo"
          >
            <ListaEstoqueBaixo itens={cEstoque.itens} />
          </CartaoPainel>
        )}
      </div>
    </div>
  );
}
