import type { ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { COR_STATUS } from "@/lib/dominio/status";
import { formatarNoFuso } from "@/lib/dominio/tempo";
import { cn } from "@/lib/utils";
import type { Aniversariante, IndicadoresCrmPainel, ItemAgenda } from "./dados";
import type { Alerta, PontoDia } from "./indicadores";
import { primeiroNome } from "./painel";

const LINK =
  "inline-flex min-h-11 items-center font-medium text-ouro-escuro underline-offset-4 hover:underline";

export function Quadro({
  id,
  titulo,
  falhou = false,
  className,
  children,
}: {
  id: string;
  titulo: string;
  falhou?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className={cn("flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm", className)}
    >
      <h2 id={id} className="font-titulo text-lg font-semibold text-ouro-escuro">
        {titulo}
      </h2>
      {falhou ? (
        <p role="alert" className="text-sm text-destructive">
          Não foi possível carregar este quadro. Atualize a página para tentar de novo.
        </p>
      ) : (
        children
      )}
    </section>
  );
}

export type DadosKpi = {
  chave: string;
  rotulo: string;
  /** null = o carregamento falhou. */
  valor: string | null;
  detalhe?: ReactNode;
  href?: string;
};

export function LinhaKpis({ itens }: { itens: DadosKpi[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
      {itens.map((k) => {
        const conteudo = (
          <>
            <span className="text-xs text-muted-foreground">{k.rotulo}</span>
            <span className="font-titulo text-2xl font-semibold text-ouro-escuro tabular-nums">
              {k.valor ?? "—"}
            </span>
            <span className="min-h-4 text-xs text-muted-foreground">
              {k.valor === null ? "Não carregou" : k.detalhe}
            </span>
          </>
        );
        const cls = "flex min-h-11 min-w-0 flex-col gap-1 rounded-xl border bg-card p-3 shadow-sm sm:p-4";
        return (
          <li key={k.chave} data-kpi={k.chave} className="min-w-0">
            {k.href ? (
              <Link href={k.href} className={cn(cls, "h-full hover:bg-accent")}>
                {conteudo}
              </Link>
            ) : (
              <div className={cn(cls, "h-full")}>{conteudo}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function VariacaoMes({ variacao }: { variacao: number | null }) {
  if (variacao === null) return <span>Sem comparação</span>;
  if (variacao === 0) return <span>= igual ao mês passado</span>;
  const alta = variacao > 0;
  return (
    <span className={alta ? "text-emerald-700" : "text-destructive"}>
      {alta ? "▲" : "▼"} {Math.abs(variacao)}% vs mês passado
    </span>
  );
}

const rotuloDia = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/**
 * Barras em SVG próprio. O desenho é decorativo para leitores de tela
 * (aria-hidden); os valores vão na tabela descritiva `sr-only`.
 */
export function GraficoBarras({
  pontos,
  formatar,
  destaque,
  rotulos,
  titulo,
  descricao,
}: {
  pontos: PontoDia[];
  formatar: (valor: number) => string;
  /** Dia (yyyy-MM-dd) em destaque. */
  destaque?: string;
  /** Rótulo do eixo para cada ponto (vazio = sem rótulo). */
  rotulos: string[];
  titulo: string;
  descricao: string;
}) {
  const largura = 300;
  const altura = 120;
  const base = 100;
  const max = Math.max(1, ...pontos.map((p) => p.valor));
  const passo = largura / pontos.length;
  const barra = Math.max(2, passo * 0.7);
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        role="img"
        aria-label={descricao}
        className="h-40 w-full"
        preserveAspectRatio="none"
      >
        <title>{titulo}</title>
        <line x1="0" x2={largura} y1={base} y2={base} className="stroke-border" strokeWidth="1" />
        {pontos.map((p, i) => {
          const h = p.valor > 0 ? Math.max(2, (p.valor / max) * (base - 6)) : 0;
          const x = i * passo + (passo - barra) / 2;
          const hoje = p.dia === destaque;
          return (
            <g key={p.dia}>
              <title>{`${rotuloDia(p.dia)}: ${formatar(p.valor)}`}</title>
              <rect x={x} y={base - h} width={barra} height={h} rx="1.5" className={hoje ? "fill-ouro-escuro" : "fill-ouro/60"} />
              {rotulos[i] && (
                <text x={x + barra / 2} y={altura - 6} textAnchor="middle" fontSize="9" className="fill-muted-foreground">
                  {rotulos[i]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{titulo}</caption>
        <thead>
          <tr>
            <th scope="col">Dia</th>
            <th scope="col">Valor</th>
          </tr>
        </thead>
        <tbody>
          {pontos.map((p) => (
            <tr key={p.dia}>
              <th scope="row">{rotuloDia(p.dia)}</th>
              <td>{formatar(p.valor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function AgendaHoje({ itens, proximoId }: { itens: ItemAgenda[]; proximoId: string | null }) {
  return (
    <div className="flex flex-col gap-3">
      {itens.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum atendimento hoje</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {itens.map((a) => {
            const proximo = a.id === proximoId;
            return (
              <li
                key={a.id}
                data-proximo={proximo || undefined}
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-transparent px-2 py-2 text-sm",
                  proximo && "border-ouro bg-accent",
                )}
              >
                <span className="w-12 font-medium tabular-nums">{formatarNoFuso(a.inicio, "HH:mm")}</span>
                <span className="min-w-0 flex-1">
                  {primeiroNome(a.clienteNome)} · {a.servicoNome}
                  <span className="text-muted-foreground"> · {primeiroNome(a.profissionalNome)}</span>
                  {proximo && <span className="ml-2 text-xs font-semibold text-ouro-escuro">Próximo</span>}
                </span>
                <Badge variant="outline" className={cn(COR_STATUS[a.status].fundo)}>
                  {COR_STATUS[a.status].rotulo}
                </Badge>
              </li>
            );
          })}
        </ol>
      )}
      <Link href="/agenda" className={cn(LINK, "self-start")}>
        Ver agenda
      </Link>
    </div>
  );
}

export function ListaAlertas({ alertas }: { alertas: Alerta[] }) {
  if (alertas.length === 0) {
    return <p className="text-sm text-emerald-800">✓ Tudo em dia</p>;
  }
  return (
    <ul className="flex flex-col divide-y">
      {alertas.map((a) => (
        <li key={a.id}>
          <Link href={a.href} className="flex min-h-11 items-center py-2 text-sm hover:bg-accent/50">
            {a.texto}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function BlocoCrm({
  dados,
  aniversariantes,
}: {
  dados: IndicadoresCrmPainel;
  aniversariantes: Aniversariante[] | null;
}) {
  const itens = [
    { href: "/crm?aba=retorno", rotulo: "Retornos da semana", valor: dados.retornos },
    { href: "/crm?aba=sumidas", rotulo: "Clientes sumidas", valor: dados.sumidas },
    { href: "/crm?aba=leads", rotulo: "Leads em aberto", valor: dados.leadsAbertos },
    ...(dados.convertidosMes === null
      ? []
      : [{ href: "/crm?aba=leads", rotulo: "Leads convertidos no mês", valor: dados.convertidosMes }]),
  ];
  const nomes = (aniversariantes ?? []).map((a) => primeiroNome(a.nome));
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {itens.map((i) => (
          <li key={i.rotulo} className="min-w-0">
            <Link
              href={i.href}
              className="flex min-h-11 flex-col gap-1 rounded-lg border p-3 hover:bg-accent"
            >
              <span className="font-titulo text-2xl font-semibold text-ouro-escuro tabular-nums">
                {i.valor}
              </span>
              <span className="text-xs text-muted-foreground">{i.rotulo}</span>
            </Link>
          </li>
        ))}
      </ul>
      {aniversariantes !== null && (
        <p className="text-sm">
          <span className="font-medium">Aniversariantes da semana: </span>
          {nomes.length === 0
            ? "nenhum"
            : nomes.slice(0, 5).join(", ") + (nomes.length > 5 ? ` e mais ${nomes.length - 5}` : "")}
        </p>
      )}
    </div>
  );
}

