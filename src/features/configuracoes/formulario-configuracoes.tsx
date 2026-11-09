"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
    onlineAtivo: boolean;
    onlineAntecedenciaMinHoras: number;
    onlineAntecedenciaMaxDias: number;
    onlineAvisoPrivacidade: string;
  };
  /** NEXT_PUBLIC_SITE_URL; vazio cai para window.location.origin ao copiar. */
  siteUrl?: string;
};

const CAMPOS_COM_ERRO = [
  "nome",
  "telefone",
  "endereco",
  "onlineAntecedenciaMinHoras",
  "onlineAntecedenciaMaxDias",
  "onlineAvisoPrivacidade",
] as const;
type CampoComErro = (typeof CAMPOS_COM_ERRO)[number];

function numeroOuNaN(texto: string) {
  return texto.trim() === "" ? Number.NaN : Number(texto);
}

export function FormularioConfiguracoes({ inicial, siteUrl: siteUrlBruto = "" }: Props) {
  // "https://x.com/" não vira "https://x.com//agendar".
  const siteUrl = siteUrlBruto.trim().replace(/\/+$/, "");
  const [nome, setNome] = useState(inicial.nome);
  const [telefone, setTelefone] = useState(inicial.telefone);
  const [endereco, setEndereco] = useState(inicial.endereco);
  const [horario, setHorario] = useState<IntervalosPorDia>(inicial.horario);
  const [onlineAtivo, setOnlineAtivo] = useState(inicial.onlineAtivo);
  const [minHoras, setMinHoras] = useState(String(inicial.onlineAntecedenciaMinHoras));
  const [maxDias, setMaxDias] = useState(String(inicial.onlineAntecedenciaMaxDias));
  const [aviso, setAviso] = useState(inicial.onlineAvisoPrivacidade);
  const [copiado, setCopiado] = useState(false);
  const [erros, setErros] = useState<Partial<Record<CampoComErro, string>>>({});
  const [pendente, iniciar] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const dados = {
      nome,
      telefone,
      endereco,
      horarioFuncionamento: horario,
      onlineAtivo,
      onlineAntecedenciaMinHoras: numeroOuNaN(minHoras),
      onlineAntecedenciaMaxDias: numeroOuNaN(maxDias),
      onlineAvisoPrivacidade: aviso,
    };
    const check = configuracoesSchema.safeParse(dados);
    if (!check.success) {
      const novos: typeof erros = {};
      let outro: string | null = null;
      for (const issue of check.error.issues) {
        const campo = issue.path[0];
        if ((CAMPOS_COM_ERRO as readonly unknown[]).includes(campo)) {
          novos[campo as CampoComErro] ??= issue.message;
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

  const [origem, setOrigem] = useState("");
  useEffect(() => setOrigem(window.location.origin), []);
  const base = siteUrl || origem;
  const linkPublico = `${base}/agendar`;

  async function copiarLink() {
    // Sem NEXT_PUBLIC_SITE_URL, usa a origem atual no momento do clique.
    const link = `${siteUrl || window.location.origin}/agendar`;
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      toast.success("Link copiado.");
      setTimeout(() => setCopiado(false), 3000);
    } catch {
      toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
    }
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

      <section className="flex flex-col gap-5" aria-labelledby="titulo-online">
        <h2 id="titulo-online" className="font-titulo text-lg font-semibold text-ouro-escuro">
          Agendamento online
        </h2>
        <label
          htmlFor="cfg-online-ativo"
          className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"
        >
          <Checkbox
            id="cfg-online-ativo"
            checked={onlineAtivo}
            onCheckedChange={(v) => setOnlineAtivo(v === true)}
            disabled={pendente}
          />
          Aceitar pedidos de agendamento online
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-online-min">Antecedência mínima (horas)</Label>
            <Input
              id="cfg-online-min"
              type="number"
              inputMode="numeric"
              min={0}
              max={72}
              step={1}
              value={minHoras}
              onChange={(e) => setMinHoras(e.target.value)}
              aria-invalid={erros.onlineAntecedenciaMinHoras ? true : undefined}
              aria-describedby={erros.onlineAntecedenciaMinHoras ? "cfg-online-min-erro" : undefined}
            />
            {erros.onlineAntecedenciaMinHoras ? (
              <p id="cfg-online-min-erro" role="alert" className="text-sm font-medium text-destructive">
                {erros.onlineAntecedenciaMinHoras}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="cfg-online-max">Antecedência máxima (dias)</Label>
            <Input
              id="cfg-online-max"
              type="number"
              inputMode="numeric"
              min={1}
              max={180}
              step={1}
              value={maxDias}
              onChange={(e) => setMaxDias(e.target.value)}
              aria-invalid={erros.onlineAntecedenciaMaxDias ? true : undefined}
              aria-describedby={erros.onlineAntecedenciaMaxDias ? "cfg-online-max-erro" : undefined}
            />
            {erros.onlineAntecedenciaMaxDias ? (
              <p id="cfg-online-max-erro" role="alert" className="text-sm font-medium text-destructive">
                {erros.onlineAntecedenciaMaxDias}
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cfg-online-aviso">Aviso de privacidade</Label>
          <textarea
            id="cfg-online-aviso"
            value={aviso}
            onChange={(e) => setAviso(e.target.value)}
            rows={4}
            maxLength={1000}
            aria-invalid={erros.onlineAvisoPrivacidade ? true : undefined}
            aria-describedby={
              erros.onlineAvisoPrivacidade ? "cfg-online-aviso-erro" : undefined
            }
            className="min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm"
          />
          {erros.onlineAvisoPrivacidade ? (
            <p id="cfg-online-aviso-erro" role="alert" className="text-sm font-medium text-destructive">
              {erros.onlineAvisoPrivacidade}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="cfg-online-link">Link público</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input id="cfg-online-link" value={linkPublico} readOnly onFocus={(e) => e.target.select()} />
            <Button type="button" variant="outline" onClick={copiarLink} className="sm:w-auto">
              {copiado ? "Link copiado!" : "Copiar link"}
            </Button>
          </div>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {copiado ? "Link copiado para a área de transferência." : ""}
          </p>
        </div>
      </section>

      <div className="flex sm:justify-end">
        <Button type="submit" disabled={pendente} className="w-full sm:w-auto">
          {pendente ? "Salvando..." : "Salvar configurações"}
        </Button>
      </div>
    </form>
  );
}
