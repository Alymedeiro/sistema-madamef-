import { CaixasNaoFechados, PainelCaixa, type CobrancaPainel } from "@/features/caixa/painel-caixa";
import type { FormaPagamento } from "@/lib/dominio/caixa";
import { formatarBRL } from "@/lib/dominio/dinheiro";
import { dataNoFuso, formatarNoFuso } from "@/lib/dominio/tempo";
import { createClient } from "@/lib/supabase/server";
import {
  caixasNaoFechados,
  CLASSE_TOM,
  dataCurta,
  descreverDiferenca,
  type CaixaNaoFechado,
} from "@/features/caixa/formato";
import { cn } from "@/lib/utils";

/**
 * Aba "Caixa do dia" do Financeiro (antiga página /caixa): abrir, lançar e
 * fechar o caixa de hoje; para a dona, caixas não fechados e o histórico.
 * Quem chama já passou por `exigirPerfil`.
 */
export async function AbaCaixa({ ehDona }: { ehDona: boolean }) {
  const supabase = await createClient();

  const { data: hoje, error: erroHoje } = await supabase.rpc("caixa_de_hoje");
  if (erroHoje) throw new Error(`Falha ao carregar o caixa: ${erroHoje.message}`);
  // Sem caixa visível o PostgREST devolve um objeto com todos os campos nulos.
  const caixaHoje = hoje?.id ? hoje : null;
  const aberto = caixaHoje && !caixaHoje.fechado_em ? caixaHoje : null;

  let cobrancas: CobrancaPainel[] = [];
  if (aberto) {
    const { data, error } = await supabase
      .from("cobrancas")
      .select(
        "id, origem, valor_bruto_centavos, desconto_centavos, lancada_em, clientes(nome), pagamentos(forma, parcelas, valor_centavos, desconto_centavos)",
      )
      .eq("caixa_id", aberto.id)
      .order("lancada_em", { ascending: true });
    if (error) throw new Error(`Falha ao carregar os lançamentos: ${error.message}`);
    cobrancas = (data ?? []).map((c) => ({
      id: c.id,
      hora: formatarNoFuso(c.lancada_em, "HH:mm"),
      clienteNome: c.clientes?.nome ?? "—",
      origem: c.origem,
      brutoCentavos: c.valor_bruto_centavos,
      descontoCentavos: c.desconto_centavos,
      // As partes de uma cobrança são gravadas na mesma transação (mesmo criado_em).
      partes: (c.pagamentos ?? []).map((p) => ({
        forma: p.forma as FormaPagamento,
        parcelas: p.parcelas,
        valorCentavos: p.valor_centavos,
        descontoCentavos: p.desconto_centavos,
      })),
    }));
  }

  // Histórico só para a dona (o RLS também esconde caixas antigos da recepção).
  let historico: {
    id: string;
    data: string;
    valor_contado_centavos: number | null;
    diferenca_centavos: number | null;
  }[] = [];
  // Caixas de dias anteriores que ficaram abertos: só a dona pode fechá-los.
  let naoFechados: CaixaNaoFechado[] = [];
  if (ehDona) {
    const hojeSP = dataNoFuso(new Date());
    const { data: abertos, error: erroAbertos } = await supabase
      .from("caixas")
      .select("id, data, valor_inicial_centavos, fechado_em")
      .is("fechado_em", null)
      .lt("data", hojeSP)
      .order("data");
    if (erroAbertos) throw new Error(`Falha ao carregar os caixas não fechados: ${erroAbertos.message}`);
    let pagamentosAbertos: {
      caixa_id: string;
      forma: string;
      valor_centavos: number;
      desconto_centavos: number;
    }[] = [];
    if (abertos && abertos.length > 0) {
      const { data, error } = await supabase
        .from("pagamentos")
        .select("caixa_id, forma, valor_centavos, desconto_centavos")
        .in(
          "caixa_id",
          abertos.map((c) => c.id),
        );
      if (error) throw new Error(`Falha ao carregar os caixas não fechados: ${error.message}`);
      pagamentosAbertos = data ?? [];
    }
    naoFechados = caixasNaoFechados(abertos ?? [], pagamentosAbertos, hojeSP);
  }

  if (ehDona) {
    const { data, error } = await supabase
      .from("caixas")
      .select("id, data, valor_contado_centavos, diferenca_centavos")
      .not("fechado_em", "is", null)
      .order("data", { ascending: false })
      .limit(30);
    if (error) throw new Error(`Falha ao carregar o histórico: ${error.message}`);
    historico = data ?? [];
  }

  return (
    <div className="flex flex-col gap-6">
      <PainelCaixa
        caixa={aberto ? { id: aberto.id, valorInicialCentavos: aberto.valor_inicial_centavos } : null}
        fechadoHoje={!!caixaHoje && !aberto}
        cobrancas={cobrancas}
      />

      {ehDona && <CaixasNaoFechados caixas={naoFechados} />}

      {ehDona && (
        <section aria-labelledby="historico-t" className="flex flex-col gap-3">
          <h2 id="historico-t" className="font-titulo text-lg font-semibold text-ouro-escuro">
            Caixas anteriores
          </h2>
          {historico.length === 0 ? (
            <p className="text-muted-foreground">Nenhum caixa fechado ainda.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {historico.map((c) => {
                const d = descreverDiferenca(c.diferenca_centavos ?? 0);
                return (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3 text-sm"
                  >
                    <span className="font-medium">{dataCurta(c.data)}</span>
                    <span>Contado: {formatarBRL(c.valor_contado_centavos ?? 0)}</span>
                    <span className={cn(CLASSE_TOM[d.tom])}>Diferença: {d.texto}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
