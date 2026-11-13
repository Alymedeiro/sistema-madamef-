"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { permissaoComputador, useNotificacoes } from "./provedor";
import {
  ROTULO_TIPO_NOTIFICACAO,
  TIPOS_NOTIFICACAO,
  tiposDoPerfil,
  type PermissaoComputador,
  type Preferencias,
  type TipoNotificacao,
} from "./regras";
import { tocarSomSuave } from "./som";
import type { Perfil } from "@/lib/dominio/permissoes";

const TEXTO_PERMISSAO: Record<PermissaoComputador, string> = {
  granted: "Permitidas neste computador.",
  default: "Ainda não permitidas.",
  denied:
    "Bloqueadas neste navegador. Para liberar, clique no cadeado ao lado do endereço do site, " +
    "permita as notificações e recarregue a página.",
  indisponivel: "Este navegador não mostra notificações do computador.",
};

/** Seção "Notificações": som, volume, notificações do computador e tipos. */
export function PreferenciasNotificacoes({ perfil }: { perfil: Perfil }) {
  const { preferencias, salvarPreferencias } = useNotificacoes();
  const [rascunho, setRascunho] = useState<Preferencias>(preferencias);
  const [permissao, setPermissao] = useState<PermissaoComputador>("default");
  const [salvando, iniciar] = useTransition();
  const idVolume = useId();

  // As preferências chegam do banco depois da montagem.
  useEffect(() => setRascunho(preferencias), [preferencias]);
  useEffect(() => setPermissao(permissaoComputador()), []);

  const alterar = (p: Partial<Preferencias>) => setRascunho((r) => ({ ...r, ...p }));
  const alternarTipo = (tipo: TipoNotificacao, ligado: boolean) =>
    setRascunho((r) => ({
      ...r,
      tipos: ligado
        ? TIPOS_NOTIFICACAO.filter((t) => t === tipo || r.tipos.includes(t))
        : r.tipos.filter((t) => t !== tipo),
    }));

  async function pedirPermissao() {
    if (!("Notification" in window)) return;
    try {
      setPermissao((await Notification.requestPermission()) as PermissaoComputador);
    } catch {
      setPermissao(permissaoComputador());
    }
  }

  function salvar() {
    iniciar(async () => {
      const erro = await salvarPreferencias(rascunho);
      if (erro) toast.error(erro);
      else toast.success("Preferências salvas.");
    });
  }

  return (
    <section aria-labelledby="titulo-notificacoes" className="flex max-w-2xl flex-col gap-6 rounded-xl border bg-card p-4 sm:p-6">
      <h2 id="titulo-notificacoes" className="text-lg font-semibold">
        Notificações
      </h2>

      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <Checkbox checked={rascunho.som} onCheckedChange={(v) => alterar({ som: v === true })} />
        <span>Som</span>
      </label>

      <div className="flex flex-col gap-2">
        <label htmlFor={idVolume} className="text-sm font-medium">
          Volume: {rascunho.volume}
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <input
            id={idVolume}
            type="range"
            min={0}
            max={100}
            step={5}
            value={rascunho.volume}
            disabled={!rascunho.som}
            onChange={(e) => alterar({ volume: Number(e.target.value) })}
            className="h-11 min-w-0 flex-1 accent-primary"
          />
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            disabled={!rascunho.som || rascunho.volume === 0}
            onClick={() => tocarSomSuave(rascunho.volume, { gesto: true })}
          >
            Testar som
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-3">
          <Checkbox checked={rascunho.desktop} onCheckedChange={(v) => alterar({ desktop: v === true })} />
          <span>Notificações do computador (quando o sistema está em outra aba ou minimizado)</span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground" role="status">
            {TEXTO_PERMISSAO[permissao]}
          </p>
          {permissao === "default" && (
            <Button type="button" variant="outline" className="min-h-11" onClick={pedirPermissao}>
              Permitir
            </Button>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-sm font-medium">Avisar sobre</legend>
        {/* Os tipos que o perfil não recebe ficam como estão ao salvar. */}
        {tiposDoPerfil(perfil).map((tipo) => (
          <label key={tipo} className="flex min-h-11 cursor-pointer items-center gap-3">
            <Checkbox
              checked={rascunho.tipos.includes(tipo)}
              onCheckedChange={(v) => alternarTipo(tipo, v === true)}
            />
            <span>{ROTULO_TIPO_NOTIFICACAO[tipo]}</span>
          </label>
        ))}
        <p className="text-xs text-muted-foreground">
          Os tipos desligados continuam no sininho, só sem aviso na tela, som ou notificação do computador.
        </p>
      </fieldset>

      <div>
        <Button type="button" className="min-h-11" disabled={salvando} onClick={salvar}>
          Salvar preferências
        </Button>
      </div>
    </section>
  );
}
