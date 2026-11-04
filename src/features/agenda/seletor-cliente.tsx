"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { buscarClientes, criarCliente, type ClienteResumo } from "@/app/(app)/clientes/actions";
import { clienteSchema } from "@/app/(app)/clientes/schemas";
import { classificarTermoBusca } from "@/lib/dominio/clientes";
import { formatarTelefone } from "@/lib/dominio/telefone";

const ATRASO_MS = 300;

export type ClienteEscolhida = { id: string; nome: string };

type Props = {
  cliente: ClienteEscolhida | null;
  onEscolher: (c: ClienteEscolhida | null) => void;
  erro?: string;
};

/** Busca de cliente (nome, WhatsApp ou CPF) com "Cadastrar nova" inline. */
export function SeletorCliente({ cliente, onEscolher, erro }: Props) {
  const id = useId();
  const [termo, setTermo] = useState("");
  const [resultados, setResultados] = useState<ClienteResumo[]>([]);
  const [buscando, iniciarBusca] = useTransition();
  const [cadastrando, setCadastrando] = useState(false);

  useEffect(() => {
    if (cliente || cadastrando) return;
    if (classificarTermoBusca(termo).tipo === "vazia") return;
    let ativo = true;
    const timer = setTimeout(() => {
      iniciarBusca(async () => {
        try {
          const lista = await buscarClientes(termo);
          if (ativo) setResultados(lista);
        } catch {
          if (ativo) toast.error("Não foi possível buscar clientes. Tente novamente.");
        }
      });
    }, ATRASO_MS);
    return () => {
      ativo = false;
      clearTimeout(timer);
    };
  }, [termo, cliente, cadastrando]);

  if (cliente) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Cliente</span>
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-md border bg-blush px-3">
          <span className="truncate font-medium">{cliente.nome}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => onEscolher(null)}>
            <X aria-hidden />
            Trocar
          </Button>
        </div>
      </div>
    );
  }

  if (cadastrando) {
    return (
      <CadastroRapido
        nomeInicial={/\d/.test(termo) ? "" : termo}
        whatsappInicial={/\d/.test(termo) ? termo : ""}
        onCancelar={() => setCadastrando(false)}
        onCriada={(c) => {
          setCadastrando(false);
          onEscolher(c);
        }}
      />
    );
  }

  const semResultado =
    !buscando && classificarTermoBusca(termo).tipo !== "vazia" && resultados.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`${id}-busca`}>Cliente</Label>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          id={`${id}-busca`}
          type="search"
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            if (classificarTermoBusca(e.target.value).tipo === "vazia") setResultados([]);
          }}
          placeholder="Nome, WhatsApp ou CPF"
          autoComplete="off"
          className="pl-9"
          aria-busy={buscando}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${id}-erro` : undefined}
        />
      </div>
      {resultados.length > 0 && (
        <ul className="flex max-h-48 flex-col overflow-y-auto rounded-md border" aria-label="Clientes encontradas">
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onEscolher({ id: c.id, nome: c.nome })}
                className="flex min-h-11 w-full flex-col justify-center px-3 py-1 text-left hover:bg-blush focus-visible:bg-blush focus-visible:outline-none"
              >
                <span className="font-medium">{c.nome}</span>
                {c.whatsapp && (
                  <span className="text-xs text-muted-foreground">{formatarTelefone(c.whatsapp)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {semResultado && <p className="text-sm text-muted-foreground">Nenhuma cliente encontrada.</p>}
      {erro && (
        <p id={`${id}-erro`} className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <Button type="button" variant="outline" className="self-start" onClick={() => setCadastrando(true)}>
        <UserPlus aria-hidden />
        Cadastrar nova
      </Button>
    </div>
  );
}

function CadastroRapido({
  nomeInicial,
  whatsappInicial,
  onCancelar,
  onCriada,
}: {
  nomeInicial: string;
  whatsappInicial: string;
  onCancelar: () => void;
  onCriada: (c: ClienteEscolhida) => void;
}) {
  const id = useId();
  const [nome, setNome] = useState(nomeInicial);
  const [whatsapp, setWhatsapp] = useState(whatsappInicial);
  const [aceite, setAceite] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function cadastrar() {
    const dados = { nome, whatsapp, aceiteLgpd: aceite };
    const check = clienteSchema.safeParse(dados);
    if (!check.success) {
      setErro(check.error.issues[0].message);
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await criarCliente(dados);
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success("Cliente cadastrada.");
      onCriada({ id: r.id, nome: check.data.nome });
    });
  }

  // Sem <form> próprio: fica dentro do formulário do agendamento.
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-sm font-medium">Nova cliente</legend>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-nome`}>Nome</Label>
        <Input id={`${id}-nome`} value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="off" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${id}-whatsapp`}>WhatsApp</Label>
        <Input
          id={`${id}-whatsapp`}
          type="tel"
          inputMode="tel"
          value={whatsapp}
          onChange={(e) => setWhatsapp(e.target.value)}
          placeholder="(11) 98765-4321"
          autoComplete="off"
        />
      </div>
      <label
        htmlFor={`${id}-lgpd`}
        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border bg-card px-3 py-2"
      >
        <Checkbox id={`${id}-lgpd`} checked={aceite} onCheckedChange={(v) => setAceite(v === true)} />
        <span className="text-sm">
          A cliente concorda com o tratamento dos seus dados pessoais pela clínica (LGPD)
        </span>
      </label>
      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={cadastrar} disabled={pendente}>
          {pendente ? "Cadastrando…" : "Cadastrar"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar} disabled={pendente}>
          Voltar à busca
        </Button>
      </div>
    </fieldset>
  );
}
