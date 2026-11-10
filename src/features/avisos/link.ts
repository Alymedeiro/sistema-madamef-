/**
 * Link para a conta em /financeiro. As listas começam em "Em aberto" do mês,
 * que esconde vencidas e vencimentos de outros meses; por isso o link já traz
 * o filtro que mostra a linha destacada.
 */
export function hrefConta(tipo: "pagar" | "receber", id: string, dias: number): string {
  const base = `/financeiro?aba=${tipo}&conta=${id}`;
  return dias < 0 ? `${base}&situacao=vencida` : `${base}&periodo=tudo&situacao=aberta`;
}
