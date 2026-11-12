"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createBrowserClient } from "@/lib/supabase/client";
import {
  criarLimitadorSom,
  decidirAvisos,
  ehRecente,
  linkSeguro,
  MAX_NA_LISTA,
  mesclarNotificacoes,
  normalizarPreferencias,
  PREFERENCIAS_PADRAO,
  type Notificacao,
  type PermissaoComputador,
  type Preferencias,
} from "./regras";
import { prepararDesbloqueioAudio, tocarSomSuave } from "./som";

const COLUNAS = "id, tipo, titulo, corpo, link, criada_em, lida_em";
/** Espera antes de re-assinar o canal (cresce a cada queda, até 30 s). */
const ESPERAS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

type Contexto = {
  notificacoes: Notificacao[];
  naoLidas: number;
  preferencias: Preferencias;
  /** Marca como lidas (ids) ou todas (null). */
  marcarLidas: (ids: string[] | null) => Promise<boolean>;
  abrir: (n: Notificacao) => void;
  salvarPreferencias: (p: Preferencias) => Promise<string | null>;
};

const ContextoNotificacoes = createContext<Contexto | null>(null);

export function useNotificacoes(): Contexto {
  const ctx = useContext(ContextoNotificacoes);
  if (!ctx) throw new Error("useNotificacoes fora do ProvedorNotificacoes");
  return ctx;
}

export function permissaoComputador(): PermissaoComputador {
  if (typeof window === "undefined" || !("Notification" in window)) return "indisponivel";
  return Notification.permission as PermissaoComputador;
}

/**
 * Notificações do colaborador logado: carrega as últimas, assina o Realtime
 * (INSERT em notificacoes do próprio colaborador; o RLS também filtra) e avisa
 * com toast, som e notificação do computador conforme as preferências.
 * Se o canal cair, re-assina; ao voltar, busca as criadas depois da última
 * recebida (toast só para as dos últimos 60 s).
 */
export function ProvedorNotificacoes({
  colaboradorId,
  children,
}: {
  colaboradorId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createBrowserClient(), []);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [naoLidas, setNaoLidas] = useState(0);
  const [preferencias, setPreferencias] = useState<Preferencias>(PREFERENCIAS_PADRAO);

  const prefsRef = useRef(preferencias);
  const vistas = useRef(new Set<string>());
  const ultimaCriada = useRef<string | null>(null);
  const podeTocar = useRef(criarLimitadorSom());

  useEffect(() => {
    prefsRef.current = preferencias;
  }, [preferencias]);

  const contarNaoLidas = useCallback(async () => {
    const { count, error } = await supabase
      .from("notificacoes")
      .select("id", { count: "exact", head: true })
      .is("lida_em", null);
    if (!error && count !== null) setNaoLidas(count);
  }, [supabase]);

  const marcarLidas = useCallback(
    async (ids: string[] | null) => {
      if (ids && ids.length === 0) return true;
      const { error } = await supabase.rpc("marcar_notificacoes_lidas", { p_ids: ids });
      if (error) return false;
      const agora = new Date().toISOString();
      setNotificacoes((lista) =>
        lista.map((n) => (n.lida_em || (ids && !ids.includes(n.id)) ? n : { ...n, lida_em: agora })),
      );
      if (ids === null) setNaoLidas(0);
      else await contarNaoLidas();
      return true;
    },
    [supabase, contarNaoLidas],
  );

  const abrir = useCallback(
    (n: Notificacao) => {
      if (!n.lida_em) void marcarLidas([n.id]);
      router.push(linkSeguro(n.link));
    },
    [marcarLidas, router],
  );

  const avisar = useCallback(
    (n: Notificacao) => {
      const visivel = typeof document === "undefined" || document.visibilityState === "visible";
      const permissao = permissaoComputador();
      const d = decidirAvisos({ tipo: n.tipo, prefs: prefsRef.current, visivel, permissao });
      if (d.toast) {
        toast(n.titulo, {
          description: n.corpo ?? undefined,
          duration: visivel ? 8_000 : 30_000,
          action: { label: "Abrir", onClick: () => abrir(n) },
        });
      }
      if (d.som && podeTocar.current(Date.now())) tocarSomSuave(prefsRef.current.volume);
      if (d.desktop) {
        try {
          const aviso = new Notification(n.titulo, {
            body: n.corpo ?? undefined,
            tag: n.tipo,
            icon: "/icons/icon-192.png",
          });
          aviso.onclick = () => {
            window.focus();
            abrir(n);
            aviso.close();
          };
        } catch {
          // Alguns navegadores (ex.: Android) só aceitam via service worker.
          toast(n.titulo, { description: n.corpo ?? undefined });
        }
      }
    },
    [abrir],
  );

  /** Junta as novas; devolve as que ainda não tinham sido vistas. */
  const receber = useCallback((novas: Notificacao[]): Notificacao[] => {
    const ineditas = novas.filter((n) => !vistas.current.has(n.id));
    for (const n of ineditas) vistas.current.add(n.id);
    for (const n of novas) {
      if (!ultimaCriada.current || n.criada_em > ultimaCriada.current) ultimaCriada.current = n.criada_em;
    }
    if (ineditas.length) {
      setNotificacoes((lista) => mesclarNotificacoes(lista, ineditas, MAX_NA_LISTA));
      setNaoLidas((v) => v + ineditas.filter((n) => !n.lida_em).length);
    }
    return ineditas;
  }, []);

  // Carga inicial: preferências, últimas notificações e contagem de não lidas.
  useEffect(() => {
    let ativo = true;
    void (async () => {
      const [prefs, lista, contagem] = await Promise.all([
        supabase.from("preferencias_notificacao").select("som, volume, desktop, tipos").maybeSingle(),
        supabase.from("notificacoes").select(COLUNAS).order("criada_em", { ascending: false }).limit(MAX_NA_LISTA),
        supabase.from("notificacoes").select("id", { count: "exact", head: true }).is("lida_em", null),
      ]);
      if (!ativo) return;
      if (!prefs.error) setPreferencias(normalizarPreferencias(prefs.data));
      if (!lista.error && lista.data) {
        for (const n of lista.data) vistas.current.add(n.id);
        if (lista.data[0] && (!ultimaCriada.current || lista.data[0].criada_em > ultimaCriada.current)) {
          ultimaCriada.current = lista.data[0].criada_em;
        }
        setNotificacoes((atual) => mesclarNotificacoes(atual, lista.data));
      }
      if (!contagem.error && contagem.count !== null) setNaoLidas(contagem.count);
    })();
    return () => {
      ativo = false;
    };
  }, [supabase]);

  // Realtime com re-assinatura e busca do que chegou enquanto estava fora.
  useEffect(() => {
    let geracao = 0;
    let tentativas = 0;
    let espera: ReturnType<typeof setTimeout> | null = null;
    let canal: ReturnType<typeof supabase.channel> | null = null;
    let encerrado = false;

    async function buscarPerdidas() {
      const desde = ultimaCriada.current;
      if (!desde) return;
      const { data, error } = await supabase
        .from("notificacoes")
        .select(COLUNAS)
        .gt("criada_em", desde)
        .order("criada_em", { ascending: true })
        .limit(MAX_NA_LISTA);
      if (error || !data || encerrado) return;
      const agora = Date.now();
      for (const n of receber(data)) if (ehRecente(n.criada_em, agora)) avisar(n);
    }

    function reassinar() {
      if (encerrado || espera) return;
      const ms = ESPERAS_MS[Math.min(tentativas, ESPERAS_MS.length - 1)];
      tentativas += 1;
      espera = setTimeout(() => {
        espera = null;
        void assinar();
      }, ms);
    }

    async function assinar() {
      if (encerrado) return;
      const minha = ++geracao;
      if (canal) {
        const antigo = canal;
        canal = null;
        await supabase.removeChannel(antigo);
      }
      const { data } = await supabase.auth.getSession();
      if (encerrado || minha !== geracao) return;
      if (data.session) await supabase.realtime.setAuth(data.session.access_token);
      canal = supabase
        .channel(`notificacoes:${colaboradorId}:${minha}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notificacoes",
            filter: `colaborador_id=eq.${colaboradorId}`,
          },
          (payload) => {
            for (const n of receber([payload.new as Notificacao])) avisar(n);
          },
        )
        .subscribe((status) => {
          if (encerrado || minha !== geracao) return;
          if (status === "SUBSCRIBED") {
            // Inclui o reencontro após queda da conexão: busca o que chegou
            // nesse meio-tempo (sem duplicar as já vistas).
            tentativas = 0;
            void buscarPerdidas();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            reassinar();
          }
        });
    }

    const aoVoltar = () => {
      if (document.visibilityState === "visible") void buscarPerdidas();
    };
    const aoConectar = () => {
      void buscarPerdidas();
      void assinar();
    };

    void assinar();
    const removerDesbloqueio = prepararDesbloqueioAudio();
    document.addEventListener("visibilitychange", aoVoltar);
    window.addEventListener("online", aoConectar);
    return () => {
      encerrado = true;
      if (espera) clearTimeout(espera);
      if (canal) void supabase.removeChannel(canal);
      removerDesbloqueio();
      document.removeEventListener("visibilitychange", aoVoltar);
      window.removeEventListener("online", aoConectar);
    };
  }, [supabase, colaboradorId, receber, avisar]);

  const salvarPreferencias = useCallback(
    async (p: Preferencias): Promise<string | null> => {
      const { error } = await supabase.rpc("salvar_preferencias_notificacao", {
        p_som: p.som,
        p_volume: p.volume,
        p_desktop: p.desktop,
        p_tipos: p.tipos,
      });
      if (error) return error.code === "P0001" ? error.message : "Não foi possível salvar. Tente novamente.";
      setPreferencias(p);
      return null;
    },
    [supabase],
  );

  const valor = useMemo<Contexto>(
    () => ({ notificacoes, naoLidas, preferencias, marcarLidas, abrir, salvarPreferencias }),
    [notificacoes, naoLidas, preferencias, marcarLidas, abrir, salvarPreferencias],
  );

  return <ContextoNotificacoes.Provider value={valor}>{children}</ContextoNotificacoes.Provider>;
}
