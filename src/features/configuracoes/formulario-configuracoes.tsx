"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { IntervalosPorDia } from "@/lib/dominio/intervalos";
import { EditorIntervalos } from "@/features/equipe/editor-intervalos";
import { salvarConfiguracoes } from "@/app/(app)/configuracoes/actions";
import { configuracoesSchema } from "@/app/(app)/configuracoes/schemas";

type Props = {
  inicial: {
    nome: string;
    telefone: string;
    endereco: string;
    horario: IntervalosPorDia;
  };
};

export function FormularioConfiguracoes({ inicial }: Props) {
  const [nome, setNome] = useState(inicial.nome);
  const [telefone, setTelefone] = useState(inicial.telefone);
  const [endereco, setEndereco] = useState(inicial.endereco);
  const [horario, setHorario] = useState<IntervalosPorDia>(inicial.horario);
  const [erros, setErros] = useState<{ nome?: string; telefone?: string; endereco?: string }>({});
  const [pendente, iniciar] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const dados = {
      nome,
      telefone,
      endereco,
      horarioFuncionamento: horario,
    };
    const check = configuracoesSchema.safeParse(dados);
    if (!check.success) {
      const novos: typeof erros = {};
      let outro: string | null = null;
      for (const issue of check.error.issues) {
        const campo = issue.path[0];
        if (campo === "nome" || campo === "telefone" || campo === "endereco") {
          novos[campo] ??= issue.message;
        } else outro ??= issue.message;
      }
      setErros(novos);
      if (outro) toast.error(outro);
      return;
    }
    setErros({});
    iniciar(async () => {
      const r = await salvarConfiguracoes(dados);
      if (r.ok) toast.success("Configurações salvas.");
      else toast.error(r.erro);
    });
  }

  return (
    <form onSubmit={enviar} noValidate className="flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-5" aria-labelledby="titulo-dados">
        <h2 id="titulo-dados" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Dados da clínica
        </h2>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cfg-nome">Nome</Label>
          <Input
            id="cfg-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            required
            aria-invalid={erros.nome ? true : undefined}
            aria-describedby={erros.nome ? "cfg-nome-erro" : undefined}
          />
          {erros.nome ? (
            <p id="cfg-nome-erro" role="alert" className="text-sm font-medium text-destructive">
              {erros.nome}
            </p>
          ) : null}
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-telefone">Telefone / WhatsApp</Label>
            <Input
              id="cfg-telefone"
              type="tel"
              inputMode="tel"
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              placeholder="(11) 98765-4321"
              aria-invalid={erros.telefone ? true : undefined}
              aria-describedby={erros.telefone ? "cfg-telefone-erro" : undefined}
            />
            {erros.telefone ? (
              <p id="cfg-telefone-erro" role="alert" className="text-sm font-medium text-destructive">
                {erros.telefone}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-endereco">Endereço</Label>
            <Input
              id="cfg-endereco"
              value={endereco}
              onChange={(e) => setEndereco(e.target.value)}
              aria-invalid={erros.endereco ? true : undefined}
              aria-describedby={erros.endereco ? "cfg-endereco-erro" : undefined}
            />
            {erros.endereco ? (
              <p id="cfg-endereco-erro" role="alert" className="text-sm font-medium text-destructive">
                {erros.endereco}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4" aria-labelledby="titulo-horario">
        <h2 id="titulo-horario" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Horário de funcionamento
        </h2>
        <p className="text-sm text-muted-foreground">
          Dia sem horário = clínica fechada. Use dois intervalos para fechar na hora do almoço.
        </p>
        <EditorIntervalos valor={horario} onChange={setHorario} disabled={pendente} />
      </section>

      <div className="flex sm:justify-end">
        <Button type="submit" disabled={pendente} className="w-full sm:w-auto">
          {pendente ? "Salvando..." : "Salvar configurações"}
        </Button>
      </div>
    </form>
  );
}
