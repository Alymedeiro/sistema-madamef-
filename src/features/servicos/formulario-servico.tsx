"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatarBRL, parseBRL } from "@/lib/dominio/dinheiro";
import { cn } from "@/lib/utils";
import { salvarServico } from "@/app/(app)/servicos/actions";
import { servicoSchema } from "@/app/(app)/servicos/schemas";

export type CategoriaOpcao = { id: string; nome: string };

type Valores = {
  nome: string;
  categoriaId: string;
  descricao: string;
  duracaoMin: string;
  preco: string;
  diasRetorno: string;
  permiteOnline: boolean;
  exigeAvaliacao: boolean;
};

type Props = {
  categorias: CategoriaOpcao[];
  /** Presente na edição. */
  servico?: {
    id: string;
    nome: string;
    categoriaId: string;
    descricao: string | null;
    duracaoMin: number;
    precoCentavos: number;
    diasRetorno: number | null;
    permiteOnline: boolean;
    exigeAvaliacao: boolean;
  };
};

const CAMPOS_ERRO: Record<string, keyof Valores> = {
  nome: "nome",
  categoriaId: "categoriaId",
  descricao: "descricao",
  duracaoMin: "duracaoMin",
  precoCentavos: "preco",
  diasRetorno: "diasRetorno",
};

const texto = (n: number) => (Number.isFinite(n) ? String(n) : "");

export function FormularioServico({ categorias, servico }: Props) {
  const router = useRouter();
  const idBase = useId();
  const editando = servico !== undefined;

  const [valores, setValores] = useState<Valores>({
    nome: servico?.nome ?? "",
    categoriaId: servico?.categoriaId ?? (categorias.length === 1 ? categorias[0].id : ""),
    descricao: servico?.descricao ?? "",
    duracaoMin: servico ? texto(servico.duracaoMin) : "60",
    preco: servico ? formatarBRL(servico.precoCentavos).replace("R$ ", "") : "",
    diasRetorno: servico?.diasRetorno ? texto(servico.diasRetorno) : "",
    permiteOnline: servico?.permiteOnline ?? false,
    exigeAvaliacao: servico?.exigeAvaliacao ?? false,
  });
  const [erros, setErros] = useState<Partial<Record<keyof Valores, string>>>({});
  const [pendente, iniciar] = useTransition();

  function definir<K extends keyof Valores>(campo: K, valor: Valores[K]) {
    setValores((v) => ({ ...v, [campo]: valor }));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    // Texto digitado vira número; o que não converte vira NaN e o schema reporta.
    const dados = {
      nome: valores.nome,
      categoriaId: valores.categoriaId,
      descricao: valores.descricao,
      duracaoMin: valores.duracaoMin.trim() === "" ? NaN : Number(valores.duracaoMin),
      precoCentavos: parseBRL(valores.preco) ?? NaN,
      diasRetorno: valores.diasRetorno.trim() === "" ? null : Number(valores.diasRetorno),
      permiteOnline: valores.permiteOnline,
      exigeAvaliacao: valores.exigeAvaliacao,
    };
    const check = servicoSchema.safeParse(dados);
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
      const r = await salvarServico(dados, servico?.id);
      if (r.ok) {
        toast.success(editando ? "Serviço salvo." : "Serviço criado.");
        if (editando) router.refresh();
        else router.push("/servicos");
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
      <div className="flex flex-col gap-2">
        <Label htmlFor={campo("nome")}>Nome do serviço</Label>
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
        <Label htmlFor={campo("categoriaId")}>Categoria</Label>
        <Select
          id={campo("categoriaId")}
          value={valores.categoriaId}
          onChange={(e) => definir("categoriaId", e.target.value)}
          required
          {...aria("categoriaId")}
        >
          <option value="">Escolha a categoria</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
        {erroDe("categoriaId")}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("duracaoMin")}>Duração (minutos)</Label>
          <Input
            id={campo("duracaoMin")}
            type="number"
            inputMode="numeric"
            min={5}
            max={480}
            step={5}
            value={valores.duracaoMin}
            onChange={(e) => definir("duracaoMin", e.target.value)}
            {...aria("duracaoMin")}
          />
          <p className="text-sm text-muted-foreground">De 5 a 480, de 5 em 5.</p>
          {erroDe("duracaoMin")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("preco")}>Preço (R$)</Label>
          <Input
            id={campo("preco")}
            inputMode="decimal"
            value={valores.preco}
            onChange={(e) => definir("preco", e.target.value)}
            placeholder="150,00"
            autoComplete="off"
            {...aria("preco")}
          />
          {erroDe("preco")}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={campo("descricao")}>Descrição (opcional)</Label>
        <textarea
          id={campo("descricao")}
          value={valores.descricao}
          onChange={(e) => definir("descricao", e.target.value)}
          rows={3}
          className={cn(
            "flex min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none md:text-sm",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring",
            "aria-invalid:border-destructive",
          )}
          {...aria("descricao")}
        />
        {erroDe("descricao")}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={campo("diasRetorno")}>Dias para retorno (opcional)</Label>
        <Input
          id={campo("diasRetorno")}
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          value={valores.diasRetorno}
          onChange={(e) => definir("diasRetorno", e.target.value)}
          className="sm:max-w-48"
          {...aria("diasRetorno")}
        />
        <p className="text-sm text-muted-foreground">
          Depois de quantos dias a cliente deve voltar. Deixe vazio se não há retorno.
        </p>
        {erroDe("diasRetorno")}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Opções</legend>
        <label
          htmlFor={campo("permiteOnline")}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3"
        >
          <Checkbox
            id={campo("permiteOnline")}
            checked={valores.permiteOnline}
            onCheckedChange={(v) => definir("permiteOnline", v === true)}
          />
          <span className="text-sm">Pode ser agendado online</span>
        </label>
        <label
          htmlFor={campo("exigeAvaliacao")}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3"
        >
          <Checkbox
            id={campo("exigeAvaliacao")}
            checked={valores.exigeAvaliacao}
            onCheckedChange={(v) => definir("exigeAvaliacao", v === true)}
          />
          <span className="text-sm">Exige avaliação antes</span>
        </label>
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.push("/servicos")} disabled={pendente}>
          Voltar
        </Button>
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando..." : editando ? "Salvar" : "Criar serviço"}
        </Button>
      </div>
    </form>
  );
}
