"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseQuantidade, quantidadeParaCampo } from "@/lib/dominio/catalogo";
import { formatarBRL, parseBRL } from "@/lib/dominio/dinheiro";
import { salvarProduto } from "@/app/(app)/produtos/actions";
import { produtoSchema } from "@/app/(app)/produtos/schemas";

type Valores = {
  nome: string;
  unidade: string;
  custo: string;
  precoVenda: string;
  estoqueAtual: string;
  estoqueMinimo: string;
};

type Props = {
  /** Presente na edição. */
  produto?: {
    id: string;
    nome: string;
    unidade: string;
    custoCentavos: number;
    precoVendaCentavos: number | null;
    estoqueAtual: number;
    estoqueMinimo: number;
  };
};

const CAMPOS_ERRO: Record<string, keyof Valores> = {
  nome: "nome",
  unidade: "unidade",
  custoCentavos: "custo",
  precoVendaCentavos: "precoVenda",
  estoqueAtual: "estoqueAtual",
  estoqueMinimo: "estoqueMinimo",
};

const semSimbolo = (centavos: number) => formatarBRL(centavos).replace("R$ ", "");

/** Formulário da dona: é o único lugar que lê e grava o custo do produto (R10). */
export function FormularioProduto({ produto }: Props) {
  const router = useRouter();
  const idBase = useId();
  const editando = produto !== undefined;

  const [valores, setValores] = useState<Valores>({
    nome: produto?.nome ?? "",
    unidade: produto?.unidade ?? "un",
    custo: produto ? semSimbolo(produto.custoCentavos) : "",
    precoVenda:
      produto && produto.precoVendaCentavos !== null ? semSimbolo(produto.precoVendaCentavos) : "",
    estoqueAtual: produto ? quantidadeParaCampo(produto.estoqueAtual) : "0",
    estoqueMinimo: produto ? quantidadeParaCampo(produto.estoqueMinimo) : "0",
  });
  const [erros, setErros] = useState<Partial<Record<keyof Valores, string>>>({});
  const [pendente, iniciar] = useTransition();

  function definir<K extends keyof Valores>(campo: K, valor: Valores[K]) {
    setValores((v) => ({ ...v, [campo]: valor }));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const dados = {
      nome: valores.nome,
      unidade: valores.unidade,
      // Texto que não converte vira NaN e o schema devolve a mensagem do campo.
      custoCentavos: parseBRL(valores.custo) ?? NaN,
      precoVendaCentavos: valores.precoVenda.trim() === "" ? null : (parseBRL(valores.precoVenda) ?? NaN),
      estoqueAtual: parseQuantidade(valores.estoqueAtual) ?? NaN,
      estoqueMinimo: parseQuantidade(valores.estoqueMinimo) ?? NaN,
    };
    const check = produtoSchema.safeParse(dados);
    if (!check.success) {
      const novos: Partial<Record<keyof Valores, string>> = {};
      for (const issue of check.error.issues) {
        const campo = CAMPOS_ERRO[String(issue.path[0])];
        if (campo) novos[campo] ??= issue.message;
      }
      setErros(novos);
      return;
    }
    setErros({});

    iniciar(async () => {
      const r = await salvarProduto(dados, produto?.id);
      if (r.ok) {
        toast.success(editando ? "Produto salvo." : "Produto criado.");
        if (editando) router.refresh();
        else router.push("/produtos");
      } else {
        toast.error(r.erro);
      }
    });
  }

  const campo = (nome: keyof Valores) => `${idBase}-${nome}`;
  const erroDe = (nome: keyof Valores) =>
    erros[nome] ? (
      <p id={`${campo(nome)}-erro`} role="alert" className="text-sm font-medium text-destructive">
        {erros[nome]}
      </p>
    ) : null;
  const aria = (nome: keyof Valores) => ({
    "aria-invalid": erros[nome] ? true : undefined,
    "aria-describedby": erros[nome] ? `${campo(nome)}-erro` : undefined,
  });

  return (
    <form onSubmit={enviar} noValidate className="flex max-w-2xl flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("nome")}>Nome do produto</Label>
          <Input
            id={campo("nome")}
            value={valores.nome}
            onChange={(e) => definir("nome", e.target.value)}
            autoComplete="off"
            required
            {...aria("nome")}
          />
          {erroDe("nome")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("unidade")}>Unidade</Label>
          <Input
            id={campo("unidade")}
            value={valores.unidade}
            onChange={(e) => definir("unidade", e.target.value)}
            placeholder="un, ml, g"
            autoComplete="off"
            required
            {...aria("unidade")}
          />
          {erroDe("unidade")}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("custo")}>Custo por unidade (R$)</Label>
          <Input
            id={campo("custo")}
            inputMode="decimal"
            value={valores.custo}
            onChange={(e) => definir("custo", e.target.value)}
            placeholder="120,00"
            autoComplete="off"
            {...aria("custo")}
          />
          <p className="text-sm text-muted-foreground">Só você enxerga o custo.</p>
          {erroDe("custo")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("precoVenda")}>Preço de venda (R$, opcional)</Label>
          <Input
            id={campo("precoVenda")}
            inputMode="decimal"
            value={valores.precoVenda}
            onChange={(e) => definir("precoVenda", e.target.value)}
            placeholder="Deixe vazio se não vende"
            autoComplete="off"
            {...aria("precoVenda")}
          />
          {erroDe("precoVenda")}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("estoqueAtual")}>Estoque atual</Label>
          <Input
            id={campo("estoqueAtual")}
            inputMode="decimal"
            value={valores.estoqueAtual}
            onChange={(e) => definir("estoqueAtual", e.target.value)}
            autoComplete="off"
            {...aria("estoqueAtual")}
          />
          {erroDe("estoqueAtual")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("estoqueMinimo")}>Estoque mínimo</Label>
          <Input
            id={campo("estoqueMinimo")}
            inputMode="decimal"
            value={valores.estoqueMinimo}
            onChange={(e) => definir("estoqueMinimo", e.target.value)}
            autoComplete="off"
            {...aria("estoqueMinimo")}
          />
          <p className="text-sm text-muted-foreground">
            Abaixo deste valor o produto aparece como &quot;Estoque baixo&quot;.
          </p>
          {erroDe("estoqueMinimo")}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.push("/produtos")} disabled={pendente}>
          Voltar
        </Button>
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando..." : editando ? "Salvar" : "Criar produto"}
        </Button>
      </div>
    </form>
  );
}
