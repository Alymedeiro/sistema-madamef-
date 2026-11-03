"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { atualizarCliente, criarCliente } from "@/app/(app)/clientes/actions";
import {
  clienteAtualizacaoSchema,
  clienteSchema,
  ORIGENS_CLIENTE,
  type OrigemCliente,
  ROTULO_ORIGEM,
} from "@/app/(app)/clientes/schemas";

type Valores = {
  nome: string;
  whatsapp: string;
  cpf: string;
  email: string;
  dataNascimento: string;
  endereco: string;
  origem: "" | OrigemCliente;
  observacoes: string;
  aceitaWhatsappMarketing: boolean;
  aceiteLgpd: boolean;
};

type Props = {
  /** Presente na edição; o aceite LGPD só é pedido no cadastro. */
  cliente?: { id: string } & Omit<Valores, "aceiteLgpd">;
};

type Campo = keyof Valores;

const VAZIO: Valores = {
  nome: "",
  whatsapp: "",
  cpf: "",
  email: "",
  dataNascimento: "",
  endereco: "",
  origem: "",
  observacoes: "",
  aceitaWhatsappMarketing: false,
  aceiteLgpd: false,
};

const CAMPOS_ERRO = new Set<string>(Object.keys(VAZIO));

export function FormularioCliente({ cliente }: Props) {
  const router = useRouter();
  const idBase = useId();
  const editando = cliente !== undefined;

  const [valores, setValores] = useState<Valores>(
    cliente ? { ...VAZIO, ...cliente } : VAZIO,
  );
  const [erros, setErros] = useState<Partial<Record<Campo, string>>>({});
  const [pendente, iniciar] = useTransition();

  function definir<K extends Campo>(campo: K, valor: Valores[K]) {
    setValores((v) => ({ ...v, [campo]: valor }));
  }

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const { aceiteLgpd, ...resto } = valores;
    const dados = editando ? resto : { ...resto, aceiteLgpd };

    const check = (editando ? clienteAtualizacaoSchema : clienteSchema).safeParse(dados);
    if (!check.success) {
      const novos: Partial<Record<Campo, string>> = {};
      for (const issue of check.error.issues) {
        const campo = String(issue.path[0]);
        if (CAMPOS_ERRO.has(campo)) novos[campo as Campo] ??= issue.message;
      }
      setErros(novos);
      return;
    }
    setErros({});

    iniciar(async () => {
      if (cliente) {
        const r = await atualizarCliente(cliente.id, resto);
        if (r.ok) {
          toast.success("Dados da cliente salvos.");
          router.refresh();
        } else {
          toast.error(r.erro);
        }
      } else {
        const r = await criarCliente({ ...resto, aceiteLgpd });
        if (r.ok) {
          toast.success("Cliente cadastrada.");
          router.push(`/clientes/${r.id}`);
        } else {
          toast.error(r.erro);
        }
      }
    });
  }

  const campo = (nome: Campo) => `${idBase}-${nome}`;
  const erroDe = (nome: Campo) =>
    erros[nome] ? (
      <p id={`${campo(nome)}-erro`} role="alert" className="text-sm font-medium text-destructive">
        {erros[nome]}
      </p>
    ) : null;
  const aria = (nome: Campo) => ({
    "aria-invalid": erros[nome] ? true : undefined,
    "aria-describedby": erros[nome] ? `${campo(nome)}-erro` : undefined,
  });

  return (
    <form onSubmit={enviar} noValidate className="flex max-w-2xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor={campo("nome")}>Nome completo</Label>
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

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("whatsapp")}>WhatsApp (com DDD)</Label>
          <Input
            id={campo("whatsapp")}
            type="tel"
            inputMode="tel"
            value={valores.whatsapp}
            onChange={(e) => definir("whatsapp", e.target.value)}
            placeholder="(11) 98765-4321"
            autoComplete="off"
            {...aria("whatsapp")}
          />
          {erroDe("whatsapp")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("cpf")}>CPF (opcional)</Label>
          <Input
            id={campo("cpf")}
            inputMode="numeric"
            value={valores.cpf}
            onChange={(e) => definir("cpf", e.target.value)}
            placeholder="000.000.000-00"
            autoComplete="off"
            {...aria("cpf")}
          />
          {erroDe("cpf")}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("email")}>E-mail (opcional)</Label>
          <Input
            id={campo("email")}
            type="email"
            inputMode="email"
            value={valores.email}
            onChange={(e) => definir("email", e.target.value)}
            autoComplete="off"
            {...aria("email")}
          />
          {erroDe("email")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("dataNascimento")}>Data de nascimento (opcional)</Label>
          <Input
            id={campo("dataNascimento")}
            type="date"
            value={valores.dataNascimento}
            onChange={(e) => definir("dataNascimento", e.target.value)}
            {...aria("dataNascimento")}
          />
          {erroDe("dataNascimento")}
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-[1fr_14rem]">
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("endereco")}>Endereço (opcional)</Label>
          <Input
            id={campo("endereco")}
            value={valores.endereco}
            onChange={(e) => definir("endereco", e.target.value)}
            autoComplete="off"
            {...aria("endereco")}
          />
          {erroDe("endereco")}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor={campo("origem")}>Como conheceu a clínica</Label>
          <Select
            id={campo("origem")}
            value={valores.origem}
            onChange={(e) => definir("origem", e.target.value as Valores["origem"])}
            {...aria("origem")}
          >
            <option value="">Não informado</option>
            {ORIGENS_CLIENTE.map((o) => (
              <option key={o} value={o}>
                {ROTULO_ORIGEM[o]}
              </option>
            ))}
          </Select>
          {erroDe("origem")}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={campo("observacoes")}>Observações (opcional)</Label>
        <textarea
          id={campo("observacoes")}
          value={valores.observacoes}
          onChange={(e) => definir("observacoes", e.target.value)}
          rows={4}
          className="flex min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring aria-invalid:border-destructive md:text-sm"
          {...aria("observacoes")}
        />
        {erroDe("observacoes")}
      </div>

      <div className="flex flex-col gap-3">
        <label
          htmlFor={campo("aceitaWhatsappMarketing")}
          className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3"
        >
          <Checkbox
            id={campo("aceitaWhatsappMarketing")}
            checked={valores.aceitaWhatsappMarketing}
            onCheckedChange={(v) => definir("aceitaWhatsappMarketing", v === true)}
          />
          <span className="text-sm">Aceita receber promoções e novidades por WhatsApp</span>
        </label>

        {editando ? null : (
          <div className="flex flex-col gap-2">
            <label
              htmlFor={campo("aceiteLgpd")}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2"
            >
              <Checkbox
                id={campo("aceiteLgpd")}
                checked={valores.aceiteLgpd}
                onCheckedChange={(v) => definir("aceiteLgpd", v === true)}
                {...aria("aceiteLgpd")}
              />
              <span className="text-sm">
                A cliente concorda com o tratamento dos seus dados pessoais pela clínica (LGPD)
              </span>
            </label>
            {erroDe("aceiteLgpd")}
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/clientes")}
          disabled={pendente}
        >
          Voltar
        </Button>
        <Button type="submit" disabled={pendente}>
          {pendente ? "Salvando..." : editando ? "Salvar" : "Cadastrar cliente"}
        </Button>
      </div>
    </form>
  );
}
