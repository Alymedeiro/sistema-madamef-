"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { salvarRobo } from "@/app/(app)/configuracoes/actions";
import { roboConfigSchema } from "@/app/(app)/configuracoes/schemas";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  linkAgendamentoEfetivo,
  MAX_OPCOES_ROBO,
  ROTULO_QUANDO,
  ROTULO_TIPO_OPCAO,
  type OpcaoRobo,
  type QuandoRobo,
  type TipoOpcaoRobo,
} from "@/lib/dominio/robo";
import { previaMenuRobo, previaRespostaRobo } from "./previa-robo";

export type RoboEditavel = {
  ativo: boolean;
  quando: QuandoRobo;
  boasVindas: string;
  naoEntendi: string;
  rodapeOpcao: string;
  linkAgendamento: string;
  opcoes: OpcaoRobo[];
};

type Props = {
  inicial: RoboEditavel;
  clinica: string;
  endereco: string;
  horario: unknown;
  /** Link padrão do banco (robo_link_site: URL do site + /agendar); nulo sem URL. */
  linkSite: string | null;
};

type OpcaoLocal = OpcaoRobo & { chave: number };

const CLASSE_TEXTAREA =
  "min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring md:text-sm";

const NUMEROS = Array.from({ length: MAX_OPCOES_ROBO }, (_, i) => i + 1);

/** Balão de mensagem enviada, como no WhatsApp. */
function Balao({ texto, rotulo }: { texto: string; rotulo: string }) {
  return (
    <div className="flex justify-end">
      <p
        aria-label={rotulo}
        className="max-w-[85%] whitespace-pre-line rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 text-sm text-neutral-900 shadow-sm"
      >
        {texto}
      </p>
    </div>
  );
}

export function SecaoRobo({ inicial, clinica, endereco, horario, linkSite }: Props) {
  const [ativo, setAtivo] = useState(inicial.ativo);
  const [quando, setQuando] = useState<QuandoRobo>(inicial.quando);
  const [boasVindas, setBoasVindas] = useState(inicial.boasVindas);
  const [naoEntendi, setNaoEntendi] = useState(inicial.naoEntendi);
  const [rodape, setRodape] = useState(inicial.rodapeOpcao);
  const [link, setLink] = useState(inicial.linkAgendamento);
  const [opcoes, setOpcoes] = useState<OpcaoLocal[]>(() =>
    inicial.opcoes.map((o, i) => ({ ...o, chave: i })),
  );
  const [proximaChave, setProximaChave] = useState(inicial.opcoes.length);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const ordenadas = useMemo(
    () => [...opcoes].sort((a, b) => a.numero - b.numero || a.chave - b.chave),
    [opcoes],
  );
  const linkPadrao = linkSite ?? "";
  const dadosPrevia = { clinica, endereco, horario };
  const menu = previaMenuRobo(boasVindas, opcoes, dadosPrevia);

  function alterar(chave: number, mudanca: Partial<OpcaoRobo>) {
    setOpcoes((lista) => lista.map((o) => (o.chave === chave ? { ...o, ...mudanca } : o)));
  }

  function adicionar() {
    const usados = new Set(opcoes.map((o) => o.numero));
    const numero = NUMEROS.find((n) => !usados.has(n));
    if (numero === undefined) return;
    setOpcoes([
      ...opcoes,
      { chave: proximaChave, numero, rotulo: "", tipo: "texto", resposta: "", ativo: true },
    ]);
    setProximaChave(proximaChave + 1);
  }

  function salvar(e: React.FormEvent) {
    e.preventDefault();
    const dados = {
      ativo,
      quando,
      boasVindas,
      naoEntendi,
      rodapeOpcao: rodape,
      linkAgendamento: link,
      opcoes: ordenadas.map(({ numero, rotulo, tipo, resposta, ativo: a }) => ({
        numero,
        rotulo,
        tipo,
        resposta,
        ativo: a,
      })),
    };
    const check = roboConfigSchema.safeParse(dados);
    if (!check.success) {
      setErro(check.error.issues[0].message);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await salvarRobo(dados);
      if (r.ok) toast.success("Robô de atendimento salvo.");
      else toast.error(r.erro);
    });
  }

  return (
    <section
      id="robo"
      className="flex max-w-3xl flex-col gap-6"
      aria-labelledby="titulo-robo"
    >
      <h3 id="titulo-robo" className="font-titulo text-base font-semibold text-ouro-escuro">
        Robô de atendimento
      </h3>
      <p className="text-sm text-muted-foreground">
        Responde as mensagens recebidas com um menu de opções numeradas (sem inteligência
        artificial). Quando a equipe envia uma mensagem para a cliente, ou ela escolhe falar com a
        equipe, o robô fica pausado por 24 h naquela conversa. Variáveis: <code>{"{nome}"}</code>,{" "}
        <code>{"{clinica}"}</code>, <code>{"{endereco}"}</code>, <code>{"{horario}"}</code>.
      </p>
      <form onSubmit={salvar} noValidate className="flex flex-col gap-5">
        <label htmlFor="robo-ativo" className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
          <Checkbox
            id="robo-ativo"
            checked={ativo}
            onCheckedChange={(v) => setAtivo(v === true)}
            disabled={pendente}
          />
          Robô ativo
        </label>
        <div className="flex flex-col gap-2 sm:max-w-sm">
          <Label htmlFor="robo-quando">Quando responder</Label>
          <Select
            id="robo-quando"
            value={quando}
            onChange={(e) => setQuando(e.target.value as QuandoRobo)}
          >
            {(Object.keys(ROTULO_QUANDO) as QuandoRobo[]).map((q) => (
              <option key={q} value={q}>
                {ROTULO_QUANDO[q]}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="robo-boas-vindas">Boas-vindas (topo do menu)</Label>
          <textarea
            id="robo-boas-vindas"
            rows={2}
            maxLength={1000}
            value={boasVindas}
            onChange={(e) => setBoasVindas(e.target.value)}
            className={CLASSE_TEXTAREA}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="robo-nao-entendi">Quando não entender</Label>
          <textarea
            id="robo-nao-entendi"
            rows={2}
            maxLength={1000}
            value={naoEntendi}
            onChange={(e) => setNaoEntendi(e.target.value)}
            className={CLASSE_TEXTAREA}
          />
        </div>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="robo-rodape">Rodapé das respostas (opcional)</Label>
            <Input
              id="robo-rodape"
              maxLength={1000}
              value={rodape}
              onChange={(e) => setRodape(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="robo-link">Link de agendamento (opcional)</Label>
            <Input
              id="robo-link"
              type="url"
              inputMode="url"
              placeholder={linkPadrao || "https://..."}
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Vazio: usa o endereço do site{linkPadrao ? ` (${linkPadrao})` : ""}.
            </p>
          </div>
        </div>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-sm font-medium">
            Opções do menu ({opcoes.length} de {MAX_OPCOES_ROBO})
          </legend>
          {ordenadas.map((o) => (
            <article
              key={o.chave}
              aria-label={`Opção ${o.numero}`}
              className="flex flex-col gap-3 rounded-md border bg-card p-4"
            >
              <div className="grid gap-3 sm:grid-cols-[6rem_1fr_14rem]">
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`robo-num-${o.chave}`}>Número</Label>
                  <Select
                    id={`robo-num-${o.chave}`}
                    value={String(o.numero)}
                    onChange={(e) => alterar(o.chave, { numero: Number(e.target.value) })}
                  >
                    {NUMEROS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`robo-rotulo-${o.chave}`}>Nome da opção</Label>
                  <Input
                    id={`robo-rotulo-${o.chave}`}
                    maxLength={60}
                    value={o.rotulo}
                    onChange={(e) => alterar(o.chave, { rotulo: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`robo-tipo-${o.chave}`}>O que faz</Label>
                  <Select
                    id={`robo-tipo-${o.chave}`}
                    value={o.tipo}
                    onChange={(e) => alterar(o.chave, { tipo: e.target.value as TipoOpcaoRobo })}
                  >
                    {(Object.keys(ROTULO_TIPO_OPCAO) as TipoOpcaoRobo[]).map((t) => (
                      <option key={t} value={t}>
                        {ROTULO_TIPO_OPCAO[t]}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              {o.tipo === "texto" ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`robo-resposta-${o.chave}`}>Resposta</Label>
                  <textarea
                    id={`robo-resposta-${o.chave}`}
                    rows={3}
                    maxLength={1000}
                    value={o.resposta ?? ""}
                    onChange={(e) => alterar(o.chave, { resposta: e.target.value })}
                    className={CLASSE_TEXTAREA}
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label
                  htmlFor={`robo-opcao-ativa-${o.chave}`}
                  className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"
                >
                  <Checkbox
                    id={`robo-opcao-ativa-${o.chave}`}
                    checked={o.ativo}
                    onCheckedChange={(v) => alterar(o.chave, { ativo: v === true })}
                  />
                  Opção ativa
                </label>
                <Button
                  type="button"
                  variant="outline"
                  disabled={pendente}
                  onClick={() => setOpcoes(opcoes.filter((x) => x.chave !== o.chave))}
                >
                  Excluir opção {o.numero}
                </Button>
              </div>
            </article>
          ))}
          <Button
            type="button"
            variant="outline"
            className="self-start"
            disabled={pendente || opcoes.length >= MAX_OPCOES_ROBO}
            onClick={adicionar}
          >
            Adicionar opção
          </Button>
        </fieldset>

        <div className="flex flex-col gap-3 rounded-md bg-[#efeae2] p-4" aria-label="Prévia do robô">
          <p className="text-xs font-medium text-neutral-700">Prévia (com dados de exemplo)</p>
          <Balao texto={menu} rotulo="Prévia do menu" />
          {ordenadas
            .filter((o) => o.ativo)
            .map((o) => (
              <div key={o.chave} className="flex flex-col gap-2">
                <div className="flex">
                  <p className="rounded-lg rounded-tl-none bg-white px-3 py-2 text-sm text-neutral-900 shadow-sm">
                    {o.numero}
                  </p>
                </div>
                <Balao
                  texto={previaRespostaRobo(o, rodape, linkAgendamentoEfetivo(link, linkSite), dadosPrevia)}
                  rotulo={`Prévia da opção ${o.numero}`}
                />
              </div>
            ))}
        </div>

        {erro ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {erro}
          </p>
        ) : null}
        <div className="flex sm:justify-end">
          <Button type="submit" disabled={pendente} className="w-full sm:w-auto">
            {pendente ? "Salvando..." : "Salvar robô"}
          </Button>
        </div>
      </form>
    </section>
  );
}
