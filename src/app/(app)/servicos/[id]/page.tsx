import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FormularioServico } from "@/features/servicos/formulario-servico";
import { SecaoProdutosConsumidos } from "@/features/servicos/secao-produtos-consumidos";
import { Badge } from "@/components/ui/badge";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

export const metadata = { title: "Serviço | Madame Fê Clinic" };

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
      {children}
    </h1>
  );
}

function Voltar() {
  return (
    <Link
      href="/servicos"
      className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
    >
      <ArrowLeft className="size-4" aria-hidden />
      Serviços
    </Link>
  );
}

export default async function ServicoPage({ params }: { params: Promise<{ id: string }> }) {
  // Cadastro é só da dona; recepção e profissional voltam para /inicio.
  await exigirPerfil("dona");
  const { id } = await params;
  const novo = id === "novo";
  if (!novo && !idSchema.safeParse(id).success) notFound();

  const supabase = await createClient();
  // Página só da dona (exigirPerfil acima): o percentual só é lido por ela.
  const [categorias, servico, vinculos, produtos, termos, comissao] = await Promise.all([
    supabase.from("categorias_servico").select("id, nome").order("nome", { ascending: true }),
    novo
      ? Promise.resolve({ data: null, error: null })
      : supabase
          .from("servicos")
          .select(
            "id, nome, categoria_id, descricao, duracao_min, preco_centavos, dias_retorno, permite_online, exige_avaliacao, modelo_termo_id, ativo",
          )
          .eq("id", id)
          .maybeSingle(),
    novo
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("servico_produtos").select("produto_id, quantidade").eq("servico_id", id),
    supabase.from("produtos").select("id, nome, unidade, ativo").order("nome", { ascending: true }),
    supabase
      .from("modelos_termo")
      .select("id, titulo")
      .eq("ativo", true)
      .order("titulo", { ascending: true }),
    novo
      ? Promise.resolve({ data: null, error: null })
      : supabase.from("servicos_comissao").select("percentual").eq("servico_id", id).maybeSingle(),
  ]);
  for (const r of [categorias, servico, vinculos, produtos, termos, comissao]) {
    if (r.error) throw new Error(`Falha ao carregar o serviço: ${r.error.message}`);
  }
  const s = servico.data;
  if (!novo && !s) notFound();

  const categoriasLista = categorias.data ?? [];
  if (novo && categoriasLista.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <Voltar />
        <Titulo>Novo serviço</Titulo>
        <p className="text-muted-foreground">
          Crie uma categoria na lista de serviços antes de cadastrar o primeiro serviço.
        </p>
      </div>
    );
  }

  const iniciais = (vinculos.data ?? []).map((v) => ({
    produtoId: v.produto_id,
    quantidade: Number(v.quantidade),
  }));
  const jaUsados = new Set(iniciais.map((i) => i.produtoId));
  // Produto inativo só aparece se o serviço já o consome.
  const opcoesProduto = (produtos.data ?? [])
    .filter((p) => p.ativo || jaUsados.has(p.id))
    .map((p) => ({ id: p.id, nome: p.nome, unidade: p.unidade }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <Voltar />
        <div className="flex flex-wrap items-center gap-3">
          <Titulo>{s ? s.nome : "Novo serviço"}</Titulo>
          {s && !s.ativo ? <Badge variant="destructive">Inativo</Badge> : null}
        </div>
      </div>

      <FormularioServico
        categorias={categoriasLista}
        termos={termos.data ?? []}
        servico={
          s
            ? {
                id: s.id,
                nome: s.nome,
                categoriaId: s.categoria_id,
                descricao: s.descricao,
                duracaoMin: s.duracao_min,
                precoCentavos: s.preco_centavos,
                diasRetorno: s.dias_retorno,
                permiteOnline: s.permite_online,
                exigeAvaliacao: s.exige_avaliacao,
                modeloTermoId: s.modelo_termo_id,
                comissaoPct: comissao.data ? Number(comissao.data.percentual) : null,
              }
            : undefined
        }
      />

      {s ? (
        <SecaoProdutosConsumidos servicoId={s.id} produtos={opcoesProduto} iniciais={iniciais} />
      ) : (
        <p className="max-w-2xl text-sm text-muted-foreground">
          Depois de criar o serviço, edite-o para informar os produtos consumidos.
        </p>
      )}
    </div>
  );
}
