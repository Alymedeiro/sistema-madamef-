/** Mantém somente os dígitos. */
export function limparCPF(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

/** Valida dígitos verificadores; rejeita tamanho errado e sequências repetidas. */
export function validarCPF(cpf: string): boolean {
  const d = limparCPF(cpf);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;

  const digitoVerificador = (tamanho: number): number => {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) {
      soma += Number(d[i]) * (tamanho + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return (
    digitoVerificador(9) === Number(d[9]) &&
    digitoVerificador(10) === Number(d[10])
  );
}

/** "52998224725" -> "529.982.247-25". Sem 11 dígitos, devolve só os dígitos. */
export function formatarCPF(cpf: string): string {
  const d = limparCPF(cpf);
  if (d.length !== 11) return d;
  return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}
