import { AbaCaixa } from "@/features/financeiro/aba-caixa";
import { AcoesCabecalho } from "@/features/financeiro/acoes-cabecalho";
import { AbasFinanceiro, AbaVazia } from "@/features/financeiro/abas";
import { CabecalhoFinanceiro } from "@/features/financeiro/cabecalho";
import { CartoesFinanceiro } from "@/features/financeiro/cartoes";
import { FiltroDePeriodo } from "@/features/financeiro/filtro-periodo";
import { FiltrosLista } from "@/features/financeiro/filtros-lista";
import { ListaPagar } from "@/features/financeiro/lista-pagar";
import { PainelFinanceiro } from "@/features/financeiro/painel";
import { hrefFinanceiro } from "@/features/financeiro/url";
import { filtroSituacao, periodoDoFiltro } from "@/lib/dominio/financeiro";
import { abaDoFinanceiro, abasDoFinanceiro, perfisComAcesso } from "@/lib/dominio/permissoes";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import {
  carregarProximosVencimentos,
  carregarResumo,
  listarColaboradorasAtivas,
  listarContasFixas,
  listarContasPagar,
} from "./dados";

export const metadata = { title: "Financeiro | Madame Fê Clinic" };

type Parametro = string | string[] | undefined;
const primeiro = (v: Parametro) => (Array.isArray(v) ? v[0] : v);

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<
    Record<"aba" | "periodo" | "de" | "ate" | "situacao" | "busca" | "categoria" | "conta", Parametro>
  >;
}) {
  const { colaborador } = await exigirPerfil(...perfisComAcesso("financeiro"));
  const ehDona = colaborador.perfil === "dona";
  const sp = await searchParams;
  // Recepção: só o Caixa do dia, sem cabeçalho, período, cartões nem outras abas.
  const aba = abaDoFinanceiro(colaborador.perfil, primeiro(sp.aba));

  if (!ehDona) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">Caixa do dia</h1>
        <AbaCaixa ehDona={false} />
      </div>
    );
  }

  const agora = new Date();
  const hoje = dataNoFuso(agora);
  const periodo = periodoDoFiltro(
    { periodo: primeiro(sp.periodo), de: primeiro(sp.de), ate: primeiro(sp.ate) },
    agora,
  );
  const situacao = filtroSituacao(primeiro(sp.situacao));
  const busca = (primeiro(sp.busca) ?? "").slice(0, 60);
  const categoria = primeiro(sp.categoria) ?? "";
  const supabase = await createClient();
  // Só a dona chega aqui: gerar_contas_fixas e resumo_financeiro recusam os outros perfis.
  // O resumo gera as contas fixas antes; a lista de contas a pagar espera por ele.
  const resumoGerado = carregarResumo(supabase, periodo.de, periodo.ate, agora);
  const [resumo, proximos, colaboradoras, pagar] = await Promise.all([
    resumoGerado,
    aba === "painel" ? carregarProximosVencimentos(supabase, hoje) : Promise.resolve([]),
    listarColaboradorasAtivas(supabase),
    aba === "pagar"
      ? resumoGerado.then(() =>
          Promise.all([
            listarContasPagar(supabase, { ...periodo, situacao, busca, categoria }, hoje),
            listarContasFixas(supabase),
          ]),
        )
      : Promise.resolve(null),
  ]);
  const filtroDaLista = { periodo: periodo.filtro, de: periodo.de, ate: periodo.ate, situacao, busca };
  const amanha = dataNoFuso(new Date(agora.getTime() + 86_400_000));

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoFinanceiro>
        <AcoesCabecalho
          colaboradoras={colaboradoras}
          hoje={hoje}
          hrefNovaReceber={`${hrefFinanceiro({ aba: "receber", periodo: periodo.filtro, de: periodo.de, ate: periodo.ate })}&novo=1`}
        />
      </CabecalhoFinanceiro>
      <FiltroDePeriodo aba={aba} {...periodo} />
      <CartoesFinanceiro resumo={resumo} />
      <AbasFinanceiro
        abas={abasDoFinanceiro("dona")}
        atual={aba}
        periodo={periodo.filtro}
        de={periodo.de}
        ate={periodo.ate}
      >
        {aba === "pagar" && (
          <FiltrosLista aba="pagar" tipo="pagar" categoria={categoria} {...filtroDaLista} />
        )}
      </AbasFinanceiro>
      {aba === "painel" && <PainelFinanceiro proximos={proximos} hoje={hoje} amanha={amanha} />}
      {aba === "receber" && (
        <AbaVazia titulo="Contas a receber" texto="Nenhuma conta a receber para mostrar neste período." />
      )}
      {pagar && <ListaPagar contas={pagar[0]} fixas={pagar[1]} hoje={hoje} destaque={primeiro(sp.conta)} />}
      {aba === "fluxo" && (
        <AbaVazia titulo="Fluxo de caixa" texto="Nenhuma movimentação para mostrar neste período." />
      )}
      {aba === "caixa" && <AbaCaixa ehDona />}
    </div>
  );
}
