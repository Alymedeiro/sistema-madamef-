import {
  carregarAlertasWhatsapp,
  contarPedidosAtendimento,
  type AlertasWhatsapp,
} from "@/app/(app)/mensagens/dados";
import { carregarContasVencendo } from "@/features/avisos/dados";
import {
  aguardandoConfirmacao,
  aniversariantesDaSemana,
  atendidosSemPagamento,
  atendidosSemTermo,
  atendimentosDaSemana,
  atendimentosDoDia,
  carregarCrmInicio,
  carregarFinanceiroInicio,
  pedidosAguardando,
  produtosComEstoqueBaixo,
} from "@/features/inicio/dados";
import { montarAlertas, proximoAtendimento } from "@/features/inicio/indicadores";
import {
  carregarCartao,
  diasDaSemana,
  primeiroNome,
  saudacaoPorHora,
  somarDias,
} from "@/features/inicio/painel";
import {
  AgendaHoje,
  BlocoCrm,
  GraficoBarras,
  LinhaKpis,
  ListaAlertas,
  Quadro,
  VariacaoMes,
  type DadosKpi,
} from "@/features/inicio/painel-ui";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Início | Madame Fê Clinic" };

const INICIAIS_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export default async function InicioPage() {
  const [{ colaborador }, supabase] = await Promise.all([exigirPerfil(), createClient()]);
  const agora = new Date();
  const { hoje, amanha, fimSemana, seteDiasAtras } = diasDaSemana(agora);
  const ehDona = colaborador.perfil === "dona";
  const gerencia = ehDona || colaborador.perfil === "recepcao";

  // Cada quadro carrega por conta própria: uma falha não apaga o painel.
  const sem: AlertasWhatsapp = { desconectado: false, semChaves: false, falhas: 0, respostas: [] };
  const [
    dia,
    semana,
    financeiro,
    pendentes,
    semPagamento,
    aniversarios,
    estoque,
    semTermo,
    online,
    vencendo,
    whatsapp,
    crm,
    pedidosEquipe,
  ] = await Promise.all([
    carregarCartao(atendimentosDoDia(supabase, hoje)),
    carregarCartao(atendimentosDaSemana(supabase, hoje)),
    carregarCartao(carregarFinanceiroInicio(supabase, colaborador.perfil, hoje)),
    carregarCartao(gerencia ? aguardandoConfirmacao(supabase, hoje, amanha) : Promise.resolve([])),
    carregarCartao(gerencia ? atendidosSemPagamento(supabase, seteDiasAtras, hoje) : Promise.resolve([])),
    carregarCartao(gerencia ? aniversariantesDaSemana(supabase, hoje, fimSemana) : Promise.resolve([])),
    carregarCartao(ehDona ? produtosComEstoqueBaixo(supabase) : Promise.resolve([])),
    carregarCartao(ehDona ? atendidosSemTermo(supabase, somarDias(hoje, -29), hoje) : Promise.resolve([])),
    carregarCartao(gerencia ? pedidosAguardando(supabase) : Promise.resolve([])),
    carregarCartao(ehDona ? carregarContasVencendo(supabase, hoje, 1000) : Promise.resolve([])),
    carregarCartao(gerencia ? carregarAlertasWhatsapp(supabase, agora) : Promise.resolve(sem)),
    carregarCartao(carregarCrmInicio(supabase, colaborador.perfil, hoje)),
    carregarCartao(gerencia ? contarPedidosAtendimento(supabase) : Promise.resolve(0)),
  ]);

  const lista = <T,>(c: { ok: true; dados: T[] } | { ok: false }) => (c.ok ? c.dados : []);
  const zap = whatsapp.ok ? whatsapp.dados : sem;
  const itensDia = lista(dia);
  const confirmados = itensDia.filter((a) => a.status === "confirmado").length;
  const fin = financeiro.ok ? financeiro.dados : null;

  const kpis: DadosKpi[] = [
    {
      chave: "atendimentos-hoje",
      rotulo: "Atendimentos hoje",
      valor: dia.ok ? String(itensDia.length) : null,
      detalhe: `${confirmados} confirmados`,
      href: "/agenda",
    },
  ];
  if (ehDona) {
    kpis.push(
      {
        chave: "faturamento-hoje",
        rotulo: "Faturamento hoje",
        valor: fin ? formatarBRL(fin.hojeCentavos) : null,
        detalhe: "recebido hoje",
      },
      {
        chave: "faturamento-mes",
        rotulo: "Faturamento do mês",
        valor: fin ? formatarBRL(fin.mesCentavos) : null,
        detalhe: fin && <VariacaoMes variacao={fin.variacaoMes} />,
      },
      {
        chave: "ticket-medio",
        rotulo: "Ticket médio do mês",
        valor: fin ? (fin.ticketMedioCentavos === null ? "—" : formatarBRL(fin.ticketMedioCentavos)) : null,
        detalhe: fin && `${fin.atendidosMes} atendidos no mês`,
      },
    );
  }
  if (gerencia) {
    kpis.push(
      {
        chave: "pedidos-online",
        rotulo: "Pedidos online",
        valor: online.ok ? String(online.dados.length) : null,
        detalhe: "aguardando resposta",
        href: "/agenda/pedidos",
      },
      {
        chave: "respostas",
        rotulo: "Respostas para ler",
        valor: whatsapp.ok ? String(zap.respostas.length) : null,
        detalhe: "do WhatsApp",
        href: "/mensagens?aba=respostas",
      },
    );
  }

  const alertas = montarAlertas([
    {
      id: "robo-equipe",
      contagem: pedidosEquipe.ok ? pedidosEquipe.dados : 0,
      singular: "pediu atendimento",
      plural: "pediram atendimento",
      href: "/mensagens?aba=respostas",
    },
    {
      id: "whatsapp",
      contagem: gerencia && zap.desconectado ? 1 : 0,
      singular: zap.semChaves ? "Chaves da Z-API não configuradas" : "WhatsApp desconectado",
      plural: zap.semChaves ? "Chaves da Z-API não configuradas" : "WhatsApp desconectado",
      href: ehDona ? "/configuracoes#whatsapp" : "/mensagens",
      semNumero: true,
    },
    {
      id: "falhas",
      contagem: zap.falhas,
      singular: "mensagem com falha",
      plural: "mensagens com falha",
      href: "/mensagens?aba=fila&status=falhou",
    },
    {
      id: "pendentes",
      contagem: lista(pendentes).length,
      singular: "aguardando confirmação",
      plural: "aguardando confirmação",
      href: "/agenda",
    },
    {
      id: "sem-pagamento",
      contagem: lista(semPagamento).length,
      singular: "atendido sem pagamento",
      plural: "atendidos sem pagamento",
      href: "/caixa",
    },
    {
      id: "vencendo",
      contagem: lista(vencendo).length,
      singular: "conta vencendo",
      plural: "contas vencendo",
      href: "/financeiro",
    },
    {
      id: "estoque",
      contagem: lista(estoque).length,
      singular: "produto com estoque baixo",
      plural: "produtos com estoque baixo",
      href: "/produtos",
    },
    {
      id: "sem-termo",
      contagem: lista(semTermo).length,
      singular: "atendido sem termo",
      plural: "atendidos sem termo",
      href: `/clientes/${lista(semTermo)[0]?.clienteId ?? ""}?aba=termos`,
    },
  ]);
  const algumAlertaFalhou = [
    pendentes,
    semPagamento,
    estoque,
    semTermo,
    vencendo,
    whatsapp,
    pedidosEquipe,
  ].some((c) => !c.ok);

  const semanaDados = semana.ok ? semana.dados : [];
  const proximo = proximoAtendimento(itensDia, agora);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <h1 className="font-script text-4xl text-ouro-escuro">
        {saudacaoPorHora(agora)}, {primeiroNome(colaborador.nome)}
      </h1>

      <LinhaKpis itens={kpis} />

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {ehDona && (
          <Quadro id="grafico-fat-t" titulo="Faturamento — últimos 30 dias" falhou={!fin}>
            {fin && (
              <GraficoBarras
                pontos={fin.serie30}
                formatar={formatarBRL}
                destaque={hoje}
                rotulos={fin.serie30.map((p, i) => (i % 7 === 0 || i === 29 ? `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}` : ""))}
                titulo="Faturamento por dia"
                descricao={`Faturamento por dia nos últimos 30 dias, total ${formatarBRL(fin.serie30.reduce((s, p) => s + p.valor, 0))}`}
              />
            )}
          </Quadro>
        )}
        <Quadro id="grafico-semana-t" titulo="Atendimentos da semana" falhou={!semana.ok}>
          <GraficoBarras
            pontos={semanaDados.map((d) => ({ dia: d.dia, valor: d.quantidade }))}
            formatar={(n) => `${n} ${n === 1 ? "atendimento" : "atendimentos"}`}
            destaque={hoje}
            rotulos={INICIAIS_SEMANA}
            titulo="Atendimentos por dia da semana"
            descricao={`Atendimentos de segunda a domingo, total ${semanaDados.reduce((s, d) => s + d.quantidade, 0)}`}
          />
        </Quadro>
      </div>

      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        <Quadro id="agenda-hoje-t" titulo="Agenda de hoje" falhou={!dia.ok}>
          <AgendaHoje itens={itensDia} proximoId={proximo?.id ?? null} />
        </Quadro>
        <Quadro id="alertas-t" titulo="Alertas">
          <ListaAlertas alertas={alertas} />
          {algumAlertaFalhou && (
            <p role="alert" className="text-sm text-destructive">
              Alguns alertas não puderam ser carregados. Atualize a página para tentar de novo.
            </p>
          )}
        </Quadro>
      </div>

      {gerencia && (
        <Quadro id="crm-t" titulo="CRM" falhou={!crm.ok}>
          {crm.ok && crm.dados && (
            <BlocoCrm dados={crm.dados} aniversariantes={aniversarios.ok ? aniversarios.dados : null} />
          )}
        </Quadro>
      )}
    </div>
  );
}
