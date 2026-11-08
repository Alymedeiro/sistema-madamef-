/** "expira em 15 h 20 min" até o fim da reserva; "expirado" quando já passou. */
export function tempoRestante(expiraEm: string, agora: Date): string {
  const ms = new Date(expiraEm).getTime() - agora.getTime();
  if (ms <= 0) return "expirado";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "expira em menos de 1 min";
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h === 0) return `expira em ${min} min`;
  return min === 0 ? `expira em ${h} h` : `expira em ${h} h ${min} min`;
}
