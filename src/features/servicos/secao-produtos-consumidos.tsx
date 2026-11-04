"use client";

import { useState, useTransition } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { parseQuantidade, quantidadeParaCampo } from "@/lib/dominio/catalogo";
import { salvarProdutosDoServico } from "@/app/(app)/servicos/actions";
import { produtosDoServicoSchema } from "@/app/(app)/servicos/schemas";

export type ProdutoOpcao = { id: string; nome: string; unidade: string };

type Linha = { chave: number; produtoId: string; quantidade: string };

type Props = {
  servicoId: string;
  produtos: ProdutoOpcao[];
  iniciais: { produtoId: string; quantidade: number }[];
};

export function SecaoProdutosConsumidos({ servicoId, produtos, iniciais }: Props) {
  const [proximaChave, setProximaChave] = useState(iniciais.length);
  const [linhas, setLinhas] = useState<Linha[]>(
    iniciais.map((i, n) => ({
      chave: n,
      produtoId: i.produtoId,
      quantidade: quantidadeParaCampo(i.quantidade),
    })),
  );
  const [pendente, iniciar] = useTransition();
  const porId = new Map(produtos.map((p) => [p.id, p]));

  const usados = new Set(linhas.map((l) => l.produtoId).filter(Boolean));
  const livres = produtos.filter((p) => !usados.has(p.id));

  function adicionar() {
    setLinhas((atual) => [...atual, { chave: proximaChave, produtoId: "", quantidade: "1" }]);
    setProximaChave((c) => c + 1);
  }

  function atualizar(chave: number, parcial: Partial<Linha>) {
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, ...parcial } : l)));
  }

  function remover(chave: number) {
    setLinhas((atual) => atual.filter((l) => l.chave !== chave));
  }

  function salvar() {
    const itens = linhas.map((l) => ({
      produtoId: l.produtoId,
      quantidade: parseQuantidade(l.quantidade) ?? NaN,
    }));
    const check = produtosDoServicoSchema.safeParse(itens);
    if (!check.success) {
      toast.error(check.error.issues[0].message);
      return;
    }
    iniciar(async () => {
      const r = await salvarProdutosDoServico(servicoId, itens);
      if (r.ok) toast.success("Produtos consumidos salvos.");
      else toast.error(r.erro);
    });
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4" aria-labelledby="titulo-produtos-consumidos">
      <div className="flex flex-col gap-1">
        <h2
          id="titulo-produtos-consumidos"
          className="font-titulo text-lg font-semibold text-ouro-escuro"
        >
          Produtos consumidos
        </h2>
        <p className="text-sm text-muted-foreground">
          Quanto de cada produto este serviço usa por atendimento (ex.: 0,5 ml).
        </p>
      </div>

      {produtos.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ainda não há produtos ativos cadastrados. Cadastre os produtos primeiro.
        </p>
      ) : (
        <>
          {linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum produto consumido por este serviço.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {linhas.map((l) => {
                const atual = porId.get(l.produtoId);
                const opcoes = produtos.filter((p) => p.id === l.produtoId || !usados.has(p.id));
                return (
                  <li
                    key={l.chave}
                    className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_9rem_auto] sm:items-end"
                  >
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`produto-${l.chave}`}>Produto</Label>
                      <Select
                        id={`produto-${l.chave}`}
                        value={l.produtoId}
                        onChange={(e) => atualizar(l.chave, { produtoId: e.target.value })}
                        disabled={pendente}
                      >
                        <option value="">Escolha o produto</option>
                        {opcoes.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor={`qtd-${l.chave}`}>
                        Quantidade{atual ? ` (${atual.unidade})` : ""}
                      </Label>
                      <Input
                        id={`qtd-${l.chave}`}
                        inputMode="decimal"
                        value={l.quantidade}
                        onChange={(e) => atualizar(l.chave, { quantidade: e.target.value })}
                        disabled={pendente}
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => remover(l.chave)}
                      disabled={pendente}
                    >
                      <Trash2 aria-hidden />
                      <span className="sr-only">
                        Remover {atual ? atual.nome : "produto"} da lista
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={adicionar}
              disabled={pendente || livres.length === 0}
            >
              <Plus aria-hidden />
              Adicionar produto
            </Button>
            <Button type="button" onClick={salvar} disabled={pendente}>
              {pendente ? "Salvando..." : "Salvar produtos"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
