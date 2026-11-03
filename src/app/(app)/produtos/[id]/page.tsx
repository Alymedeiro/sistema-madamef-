import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { FormularioProduto } from "@/features/produtos/formulario-produto";
import { Badge } from "@/components/ui/badge";
import { exigirPerfil } from "@/lib/sessao";
import { createClient } from "@/lib/supabase/server";
import { idSchema } from "@/lib/validacao";

export const metadata = { title: "Produto | Madame Fê Clinic" };

function Titulo({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">
      {children}
    </h1>
  );
}

export default async function ProdutoPage({ params }: { params: Promise<{ id: string }> }) {
  // Cadastro (e custo) é só da dona; recepção e profissional voltam para /inicio.
  await exigirPerfil("dona");
  const { id } = await params;
  const novo = id === "novo";
  if (!novo && !idSchema.safeParse(id).success) notFound();

  let produto = null;
  let custo = 0;
  if (!novo) {
    const supabase = await createClient();
    const [p, c] = await Promise.all([
      supabase
        .from("produtos")
        .select("id, nome, unidade, preco_venda_centavos, estoque_atual, estoque_minimo, ativo")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("produtos_custos")
        .select("custo_unitario_centavos")
        .eq("produto_id", id)
        .maybeSingle(),
    ]);
    for (const r of [p, c]) {
      if (r.error) throw new Error(`Falha ao carregar o produto: ${r.error.message}`);
    }
    if (!p.data) notFound();
    produto = p.data;
    custo = c.data?.custo_unitario_centavos ?? 0;
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/produtos"
        className="inline-flex min-h-11 items-center gap-2 self-start text-sm font-medium text-ouro-escuro underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Produtos
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <Titulo>{produto ? produto.nome : "Novo produto"}</Titulo>
        {produto && !produto.ativo ? <Badge variant="destructive">Inativo</Badge> : null}
      </div>
      <FormularioProduto
        produto={
          produto
            ? {
                id: produto.id,
                nome: produto.nome,
                unidade: produto.unidade,
                custoCentavos: custo,
                precoVendaCentavos: produto.preco_venda_centavos,
                estoqueAtual: Number(produto.estoque_atual),
                estoqueMinimo: Number(produto.estoque_minimo),
              }
            : undefined
        }
      />
    </div>
  );
}
