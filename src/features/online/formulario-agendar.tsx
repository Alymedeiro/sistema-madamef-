"use client";

import { useRef, useState, useTransition } from "react";
import { buscarHorarios, enviarPedido } from "@/app/agendar/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { PassoDados, type Dados } from "./passo-dados";
import { PassoHorario } from "./passo-horario";
import { PassoProfissional } from "./passo-profissional";
import { PassoServico } from "./passo-servico";
import { rotuloServico, type ProfissionalOnline, type ServicoOnline } from "./tipos";
import { WidgetTurnstile } from "./turnstile";

const RESERVADO = "Esse horário acabou de ser reservado, escolha outro.";
const SEM_ACEITE = "Aceite o aviso de privacidade para continuar.";

type Resumo = { servico: string; profissional: string; inicio: string };

export function FormularioAgendar({
  servicos,
  profissionais,
  dias,
  avisoPrivacidade,
  siteKey,
}: {
  servicos: ServicoOnline[];
  profissionais: ProfissionalOnline[];
  dias: string[];
  avisoPrivacidade: string;
  siteKey: string;
}) {
  const [passo, setPasso] = useState(1);
  const [servicoId, setServicoId] = useState<string | null>(null);
  // undefined = ainda não escolheu; null = "Qualquer uma".
  const [profissionalId, setProfissionalId] = useState<string | null | undefined>(undefined);
  const [dia, setDia] = useState<string | null>(null);
  const [horarios, setHorarios] = useState<string[] | null>(null);
  const [erroHorarios, setErroHorarios] = useState<string | null>(null);
  const [inicio, setInicio] = useState<string | null>(null);
  const [dados, setDados] = useState<Dados>({ nome: "", whatsapp: "", aceite: false });
  const [token, setToken] = useState("");
  const [chaveTurnstile, setChaveTurnstile] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [buscando, iniciarBusca] = useTransition();
  const [enviando, iniciarEnvio] = useTransition();
  const ultimaBusca = useRef(0);

  const servico = servicos.find((s) => s.id === servicoId) ?? null;
  const daServico = profissionais.filter((p) => servicoId && p.servicoIds.includes(servicoId));

  function limparHorario() {
    ultimaBusca.current++;
    setDia(null);
    setHorarios(null);
    setErroHorarios(null);
    setInicio(null);
  }

  function carregarHorarios(d: string, prof: string | null) {
    if (!servicoId) return;
    const n = ++ultimaBusca.current;
    setDia(d);
    setInicio(null);
    setErroHorarios(null);
    iniciarBusca(async () => {
      const r = await buscarHorarios({ servicoId, profissionalId: prof, dia: d });
      if (n !== ultimaBusca.current) return;
      setHorarios(r.ok ? r.horarios.map((h) => h.inicio) : []);
      setErroHorarios(r.ok ? null : r.erro);
    });
  }

  function enviar() {
    if (!servicoId || profissionalId === undefined || !inicio) return;
    if (!dados.aceite) return setErro(SEM_ACEITE);
    setErro(null);
    iniciarEnvio(async () => {
      const r = await enviarPedido({
        servicoId,
        profissionalId,
        inicio,
        nome: dados.nome,
        whatsapp: dados.whatsapp,
        aceite: true,
        token,
      });
      if (r.ok) {
        setResumo(r.resumo);
        return;
      }
      // Token do Turnstile vale uma vez: pede outro.
      setToken("");
      setChaveTurnstile((k) => k + 1);
      setErro(r.erro);
      if (r.erro === RESERVADO && dia) {
        setPasso(3);
        carregarHorarios(dia, profissionalId);
      }
    });
  }

  if (resumo) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-4">
          <p role="status" className="font-titulo text-xl font-semibold text-ouro-escuro">
            Pedido recebido! A Madame Fê Clinic vai te responder pelo WhatsApp em breve.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-base">
            <dt className="font-medium">Serviço</dt>
            <dd>{resumo.servico}</dd>
            <dt className="font-medium">Profissional</dt>
            <dd>{resumo.profissional}</dd>
            <dt className="font-medium">Quando</dt>
            <dd className="first-letter:uppercase">
              {formatarNoFuso(resumo.inicio, "EEEE, d 'de' MMMM 'às' HH:mm")}
            </dd>
          </dl>
        </CardContent>
      </Card>
    );
  }

  const nomeProf =
    profissionalId === null
      ? "Qualquer uma"
      : profissionais.find((p) => p.id === profissionalId)?.nome;
  const escolhas = [
    passo > 1 && servico ? rotuloServico(servico) : null,
    passo > 2 ? nomeProf : null,
    passo > 3 && inicio ? formatarNoFuso(inicio, "dd/MM 'às' HH:mm") : null,
  ].filter(Boolean);

  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        {escolhas.length > 0 ? (
          <p className="text-sm text-muted-foreground">{escolhas.join(" · ")}</p>
        ) : null}

        {passo === 1 ? (
          <PassoServico
            servicos={servicos}
            selecionado={servicoId}
            aoEscolher={(id) => {
              if (id !== servicoId) {
                setServicoId(id);
                setProfissionalId(undefined);
                limparHorario();
              }
              setPasso(2);
            }}
          />
        ) : null}

        {passo === 2 ? (
          <PassoProfissional
            profissionais={daServico}
            selecionada={profissionalId}
            aoEscolher={(id) => {
              if (id !== profissionalId) {
                setProfissionalId(id);
                limparHorario();
              }
              setPasso(3);
            }}
          />
        ) : null}

        {passo === 3 ? (
          <PassoHorario
            dias={dias}
            dia={dia}
            horarios={horarios}
            carregando={buscando}
            erro={erroHorarios ?? (erro === RESERVADO ? erro : null)}
            inicio={inicio}
            aoEscolherDia={(d) => {
              setErro(null);
              carregarHorarios(d, profissionalId ?? null);
            }}
            aoEscolherHorario={(h) => {
              setErro(null);
              setInicio(h);
              setPasso(4);
            }}
          />
        ) : null}

        {passo === 4 ? (
          <>
            <PassoDados dados={dados} avisoPrivacidade={avisoPrivacidade} aoMudar={setDados} />
            <WidgetTurnstile key={chaveTurnstile} siteKey={siteKey} aoMudarToken={setToken} />
            {erro ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {erro}
              </p>
            ) : null}
            <Button
              type="button"
              size="lg"
              disabled={enviando || (siteKey !== "" && token === "")}
              onClick={enviar}
            >
              {enviando ? "Enviando..." : "Pedir horário"}
            </Button>
          </>
        ) : null}

        {passo > 1 ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setErro(null);
              setPasso(passo - 1);
            }}
          >
            Voltar
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
