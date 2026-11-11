import type { ReactNode } from "react";

/** Título e subtítulo do Financeiro (dona); `children` são os botões de ação. */
export function CabecalhoFinanceiro({ children }: { children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="font-titulo text-2xl font-semibold tracking-wide text-ouro-escuro">Financeiro</h1>
        <p className="text-sm text-muted-foreground">Atendimentos, pacotes e despesas da clínica</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
