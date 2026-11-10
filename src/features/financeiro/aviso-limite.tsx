import { avisoDoLimite } from "@/lib/dominio/financeiro";

/** "Mostrando as 500 primeiras — refine o filtro." quando a lista veio cheia. */
export function AvisoLimite({ linhas }: { linhas: number }) {
  const aviso = avisoDoLimite(linhas);
  if (!aviso) return null;
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {aviso}
    </p>
  );
}
