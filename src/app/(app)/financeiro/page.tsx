import { AbaCaixa } from "@/features/financeiro/aba-caixa";
import { AbasFinanceiro, AbaVazia } from "@/features/financeiro/abas";
import { CabecalhoFinanceiro } from "@/features/financeiro/cabecalho";
import { CartoesFinanceiro } from "@/features/financeiro/cartoes";
import { FiltroDePeriodo } from "@/features/financeiro/filtro-periodo";
import { PainelFinanceiro } from "@/features/financeiro/painel";
import { periodoDoFiltro } from "@/lib/dominio/financeiro";
import { abaDoFinanceiro, abasDoFinanceiro, perfisComAcesso } from "@/lib/dominio/permissoes";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { carregarProximosVencimentos, carregarResumo } from "./dados";

export const metadata = { title: "Financeiro | Madame Fê Clinic" };

type Parametro = string | string[] | undefined;
const primeiro = (v: Parametro) => (Array.isArray(v) ? v[0] : v);

export default async function FinanceiroPage({
  searchParams,
}: {
  searchParams: Promise<Record<"aba" | "periodo" | "de" | "ate", Parametro>>;
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
  const supabase = await createClient();
  // Só a dona chega aqui: gerar_contas_fixas e resumo_financeiro recusam os outros perfis.
  const [resumo, proximos] = await Promise.all([
    carregarResumo(supabase, periodo.de, periodo.ate, agora),
    aba === "painel" ? carregarProximosVencimentos(supabase, hoje) : Promise.resolve([]),
  ]);
  const amanha = dataNoFuso(new Date(agora.getTime() + 86_400_000));

  return (
    <div className="flex flex-col gap-6">
      <CabecalhoFinanceiro />
      <FiltroDePeriodo aba={aba} {...periodo} />
      <CartoesFinanceiro resumo={resumo} />
      <AbasFinanceiro
        abas={abasDoFinanceiro("dona")}
        atual={aba}
        periodo={periodo.filtro}
        de={periodo.de}
        ate={periodo.ate}
      />
      {aba === "painel" && <PainelFinanceiro proximos={proximos} hoje={hoje} amanha={amanha} />}
      {aba === "receber" && (
        <AbaVazia titulo="Contas a receber" texto="Nenhuma conta a receber para mostrar neste período." />
      )}
      {aba === "pagar" && (
        <AbaVazia titulo="Contas a pagar" texto="Nenhuma conta a pagar para mostrar neste período." />
      )}
      {aba === "fluxo" && (
        <AbaVazia titulo="Fluxo de caixa" texto="Nenhuma movimentação para mostrar neste período." />
      )}
      {aba === "caixa" && <AbaCaixa ehDona />}
    </div>
  );
}
