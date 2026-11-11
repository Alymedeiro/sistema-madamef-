import { carregarAlertasWhatsapp, type AlertasWhatsapp } from "@/app/(app)/mensagens/dados";
import {
  AlertaWhatsappDesconectado,
  CartaoPainel,
  ListaAniversariantes,
  ListaContasVencendo,
  ListaAtendimentos,
  ListaEstoqueBaixo,
  ListaPedidosOnline,
  ListaRespostasWhatsapp,
  ListaSemTermo,
  ResumoFalhasWhatsapp,
} from "@/features/inicio/cartoes";
import {
  aguardandoConfirmacao,
  aniversariantesDaSemana,
  atendidosSemPagamento,
  atendidosSemTermo,
  atendimentosDoDia,
  contasVencendo,
  pedidosAguardando,
  produtosComEstoqueBaixo,
} from "@/features/inicio/dados";
import {
  carregarCartao,
  diasDaSemana,
  primeiroNome,
  saudacaoPorHora,
  somarDias,
  type Cartao,
} from "@/features/inicio/painel";
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
  const sem: AlertasWhatsapp = { desconectado: false, semChaves: false, falhas: 0, respostas: [] };
  const [
    atendimentos,
    pendentes,
    semPagamento,
    aniversarios,
    estoque,
    semTermo,
    online,
    vencendo,
    whatsapp,
  ] = await Promise.all([
    carregarCartao(atendimentosDoDia(supabase, hoje)),
    carregarCartao(gerencia ? aguardandoConfirmacao(supabase, hoje, amanha) : Promise.resolve([])),
    carregarCartao(gerencia ? atendidosSemPagamento(supabase, seteDiasAtras, hoje) : Promise.resolve([])),
    carregarCartao(gerencia ? aniversariantesDaSemana(supabase, hoje, fimSemana) : Promise.resolve([])),
    carregarCartao(ehDona ? produtosComEstoqueBaixo(supabase) : Promise.resolve([])),
    // Últimos 30 dias, contando hoje.
    carregarCartao(ehDona ? atendidosSemTermo(supabase, somarDias(hoje, -29), hoje) : Promise.resolve([])),
    carregarCartao(gerencia ? pedidosAguardando(supabase) : Promise.resolve([])),
    carregarCartao(ehDona ? contasVencendo(supabase, hoje) : Promise.resolve([])),
    carregarCartao(gerencia ? carregarAlertasWhatsapp(supabase, agora) : Promise.resolve(sem)),
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
  const cSemTermo = estado(semTermo);
  const cOnline = estado(online);
  const cVencendo = estado(vencendo);
  const cRespostas = estado(whatsapp.ok ? { ok: true, dados: whatsapp.dados.respostas } : { ok: false });
  const falhasWhatsapp = whatsapp.ok ? whatsapp.dados.falhas : 0;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-script text-4xl text-ouro-escuro">
        {saudacaoPorHora(agora)}, {primeiroNome(colaborador.nome)}
      </h1>

      {gerencia && whatsapp.ok && whatsapp.dados.desconectado && (
        <AlertaWhatsappDesconectado ehDona={ehDona} semChaves={whatsapp.dados.semChaves} />
      )}

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
              id="pedidos-online-t"
              titulo={
                cOnline.falhou
                  ? "Pedidos online aguardando"
                  : `Pedidos online aguardando (${cOnline.itens.length})`
              }
              vazio={cOnline.vazio}
              falhou={cOnline.falhou}
              vazioTexto="Nenhum pedido online aguardando resposta"
            >
              <ListaPedidosOnline itens={cOnline.itens} agora={agora} />
            </CartaoPainel>

            <CartaoPainel
              id="respostas-whatsapp-t"
              titulo="Respostas do WhatsApp"
              vazio={cRespostas.vazio}
              falhou={cRespostas.falhou}
              vazioTexto="Nenhuma resposta do WhatsApp para ler"
            >
              <ListaRespostasWhatsapp itens={cRespostas.itens} />
            </CartaoPainel>

            <CartaoPainel
              id="falhas-whatsapp-t"
              titulo="Mensagens com falha"
              vazio={whatsapp.ok && falhasWhatsapp === 0}
              falhou={!whatsapp.ok}
              vazioTexto="Nenhuma mensagem com falha nos últimos 7 dias"
            >
              <ResumoFalhasWhatsapp falhas={falhasWhatsapp} />
            </CartaoPainel>

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
            id="vencendo-t"
            titulo="Contas vencendo"
            vazio={cVencendo.vazio}
            falhou={cVencendo.falhou}
            vazioTexto="Nenhuma conta vencendo nos próximos 7 dias"
          >
            <ListaContasVencendo itens={cVencendo.itens} />
          </CartaoPainel>
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

        {ehDona && (
          <CartaoPainel
            id="sem-termo-t"
            titulo="Atendidos sem termo"
            vazio={cSemTermo.vazio}
            falhou={cSemTermo.falhou}
            vazioTexto="Nenhum atendimento sem termo nos últimos 30 dias"
          >
            <ListaSemTermo itens={cSemTermo.itens} />
          </CartaoPainel>
        )}
      </div>
    </div>
  );
}
