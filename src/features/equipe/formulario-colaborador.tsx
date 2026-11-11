"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { quantidadeParaCampo } from "@/lib/dominio/catalogo";
import { ROTULO_PERFIL, type Perfil } from "@/lib/dominio/permissoes";
import { formatarTelefone } from "@/lib/dominio/telefone";
import { cn } from "@/lib/utils";
import { atualizarColaborador, convidarColaborador } from "@/app/(app)/equipe/actions";
import {
  colaboradorEdicaoSchema,
  colaboradorSchema,
  PERFIS,
} from "@/app/(app)/equipe/schemas";

/** Cores combinando com a marca (cor da profissional na agenda). */
const PALETA = [
  { nome: "Dourado", cor: "#986818" },
  { nome: "Rosa", cor: "#C2678D" },
  { nome: "Vinho", cor: "#8E3B5A" },
  { nome: "Lilás", cor: "#8B6BB1" },
  { nome: "Verde sálvia", cor: "#5E8C6A" },
  { nome: "Azul petróleo", cor: "#3F7C85" },
  { nome: "Terracota", cor: "#B5654A" },
  { nome: "Grafite", cor: "#5B4B45" },
] as const;

type Valores = {
  nome: string;
  email: string;
  funcao: string;
  perfil: Perfil;
  cor: string;
  telefone: string;
  comissaoPadraoPct: string;
};

type Props =
  | { modo: "novo" }
  | {
      modo: "editar";
      id: string;
      email: string | null;
      ehVoceMesma: boolean;
      valores: { nome: string; funcao: string | null; perfil: Perfil; cor: string; telefone: string | null };
      /** Comissão padrão gravada (só a dona carrega); null = sem linha (0%). */
      comissaoPadraoPct: number | null;
    };

export function FormularioColaborador(props: Props) {
  const router = useRouter();
  const idBase = useId();
  const editando = props.modo === "editar";
  const bloqueiaPerfil = editando && props.ehVoceMesma;

  const [valores, setValores] = useState<Valores>(
    editando
      ? {
          nome: props.valores.nome,
          email: props.email ?? "",
          funcao: props.valores.funcao ?? "",
          perfil: props.valores.perfil,
          cor: props.valores.cor,
          telefone: props.valores.telefone ? formatarTelefone(props.valores.telefone) : "",
          comissaoPadraoPct:
            props.comissaoPadraoPct === null ? "" : quantidadeParaCampo(props.comissaoPadraoPct),
        }
      : {
          nome: "",
          email: "",
          funcao: "",
          perfil: "profissional",
          cor: PALETA[0].cor,
          telefone: "",
          comissaoPadraoPct: "",
        },
  );
  const [erros, setErros] = useState<Partial<Record<keyof Valores, string>>>({});
  const [pendente, iniciar] = useTransition();

  function definir<K extends keyof Valores>(campo: K, valor: Valores[K]) {
    setValores((v) => ({ ...v, [campo]: valor }));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const dados = { ...valores };
    const schema = editando ? colaboradorEdicaoSchema : colaboradorSchema;
    const check = schema.safeParse(dados);
    if (!check.success) {
      const campos = z.flattenError(check.error).fieldErrors as Record<string, string[] | undefined>;
      setErros(
        Object.fromEntries(
          Object.entries(campos).map(([k, v]) => [k, v?.[0]]),
        ) as Partial<Record<keyof Valores, string>>,
      );
      return;
    }
    setErros({});

    iniciar(async () => {
      if (props.modo === "editar") {
        const { email, ...semEmail } = dados;
        void email;
        const r = await atualizarColaborador(props.id, semEmail);
        if (r.ok) {
          toast.success("Dados salvos.");
          router.refresh();
        } else toast.error(r.erro);
      } else {
        const r = await convidarColaborador(dados);
        if (r.ok) {
          toast.success("Convite enviado por e-mail.");
          router.push("/equipe");
        } else toast.error(r.erro);
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
        <Label htmlFor={campo("nome")}>Nome</Label>
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
        <Label htmlFor={campo("email")}>E-mail (login)</Label>
        <Input
          id={campo("email")}
          type="email"
          inputMode="email"
          value={valores.email}
          onChange={(e) => definir("email", e.target.value)}
          disabled={editando}
          autoComplete="off"
          required
          {...aria("email")}
        />
        {editando ? (
          <p className="text-sm text-muted-foreground">O e-mail não pode ser alterado.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Enviaremos um convite para este e-mail, para a pessoa criar a senha.
          </p>
        )}
        {erroDe("email")}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("funcao")}>Função</Label>
          <Input
            id={campo("funcao")}
            value={valores.funcao}
            onChange={(e) => definir("funcao", e.target.value)}
            placeholder="Ex.: Esteticista"
            {...aria("funcao")}
          />
          {erroDe("funcao")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("perfil")}>Perfil de acesso</Label>
          <Select
            id={campo("perfil")}
            value={valores.perfil}
            onChange={(e) => definir("perfil", e.target.value as Perfil)}
            disabled={bloqueiaPerfil}
            {...aria("perfil")}
          >
            {PERFIS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PERFIL[p]}
              </option>
            ))}
          </Select>
          {bloqueiaPerfil ? (
            <p className="text-sm text-muted-foreground">
              Você não pode remover o seu próprio acesso de dona.
            </p>
          ) : null}
          {erroDe("perfil")}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={campo("telefone")}>Telefone / WhatsApp (opcional)</Label>
        <Input
          id={campo("telefone")}
          type="tel"
          inputMode="tel"
          value={valores.telefone}
          onChange={(e) => definir("telefone", e.target.value)}
          placeholder="(11) 98765-4321"
          autoComplete="off"
          {...aria("telefone")}
        />
        {erroDe("telefone")}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={campo("comissaoPadraoPct")}>Comissão padrão (%)</Label>
        <Input
          id={campo("comissaoPadraoPct")}
          inputMode="decimal"
          value={valores.comissaoPadraoPct}
          onChange={(e) => definir("comissaoPadraoPct", e.target.value)}
          placeholder="0"
          autoComplete="off"
          className="sm:max-w-48"
          {...aria("comissaoPadraoPct")}
        />
        <p className="text-sm text-muted-foreground">
          Vale para os atendimentos de serviços sem comissão própria. Vazio = 0%.
        </p>
        {erroDe("comissaoPadraoPct")}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Cor na agenda</legend>
        <div className="flex flex-wrap items-center gap-2">
          {PALETA.map((p) => {
            const selecionada = valores.cor.toLowerCase() === p.cor.toLowerCase();
            return (
              <button
                key={p.cor}
                type="button"
                onClick={() => definir("cor", p.cor)}
                aria-label={p.nome}
                aria-pressed={selecionada}
                className="inline-flex size-11 items-center justify-center rounded-full outline-none focus-visible:ring-[3px] focus-visible:ring-ring"
              >
                <span
                  className={cn(
                    "size-8 rounded-full border-2 border-card ring-2 ring-transparent",
                    selecionada && "ring-texto",
                  )}
                  style={{ backgroundColor: p.cor }}
                />
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label="Escolher outra cor"
            value={/^#[0-9A-Fa-f]{6}$/.test(valores.cor) ? valores.cor : "#986818"}
            onChange={(e) => definir("cor", e.target.value.toUpperCase())}
            className="size-11 shrink-0 cursor-pointer rounded-md border bg-card p-1"
          />
          <Input
            id={campo("cor")}
            aria-label="Código da cor (#RRGGBB)"
            value={valores.cor}
            onChange={(e) => definir("cor", e.target.value)}
            className="w-36 font-mono"
            maxLength={7}
            {...aria("cor")}
          />
        </div>
        {erroDe("cor")}
      </fieldset>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => router.push("/equipe")} disabled={pendente}>
          Voltar
        </Button>
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando..." : editando ? "Salvar" : "Enviar convite"}
        </Button>
      </div>
    </form>
  );
}
