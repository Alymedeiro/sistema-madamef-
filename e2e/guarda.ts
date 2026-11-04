// Guarda dura dos E2E que escrevem em um backend Supabase (função pura, testada em
// guarda.unit.ts). Os specs só rodam se o projeto de destino foi autorizado de forma
// explícita: E2E_PERMITIR_PROJETO deve ser igual ao "ref" da NEXT_PUBLIC_SUPABASE_URL
// (https://<ref>.supabase.co) ou a "local" para um stack local (127.0.0.1/localhost).
// Se E2E_BASE_URL estiver definida, E2E_BASE_URL_PERMITIDA deve ser idêntica a ela.

export type EntradaGuarda = {
  url?: string;
  anon?: string;
  service?: string;
  permitirProjeto?: string;
  baseUrl?: string;
  baseUrlPermitida?: string;
};

export type ResultadoGuarda = { permitido: true } | { permitido: false; motivo: string };

/** Extrai o identificador do projeto: o ref de `<ref>.supabase.co` ou "local". */
export function refDoProjeto(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.hostname === "127.0.0.1" || u.hostname === "localhost") return "local";
  const m = /^([a-z0-9]{10,})\.supabase\.co$/.exec(u.hostname);
  return u.protocol === "https:" && m ? m[1] : null;
}

export function avaliarGuarda(e: EntradaGuarda): ResultadoGuarda {
  const faltando = [
    ["NEXT_PUBLIC_SUPABASE_URL", e.url],
    ["NEXT_PUBLIC_SUPABASE_ANON_KEY", e.anon],
    ["SUPABASE_SERVICE_ROLE_KEY", e.service],
  ]
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (faltando.length > 0) {
    return { permitido: false, motivo: `defina ${faltando.join(", ")} (projeto Supabase de teste)` };
  }
  const ref = refDoProjeto(e.url!);
  if (!ref) {
    return {
      permitido: false,
      motivo: `NEXT_PUBLIC_SUPABASE_URL (${e.url}) não é https://<ref>.supabase.co nem um stack local`,
    };
  }
  if (!e.permitirProjeto) {
    return {
      permitido: false,
      motivo: `defina E2E_PERMITIR_PROJETO=${ref} para autorizar escritas nesse projeto (use só o projeto de TESTES)`,
    };
  }
  if (e.permitirProjeto !== ref) {
    return {
      permitido: false,
      motivo: `E2E_PERMITIR_PROJETO (${e.permitirProjeto}) não confere com o projeto da URL (${ref})`,
    };
  }
  if (e.baseUrl && e.baseUrlPermitida !== e.baseUrl) {
    return {
      permitido: false,
      motivo: `E2E_BASE_URL (${e.baseUrl}) exige E2E_BASE_URL_PERMITIDA com o mesmo valor`,
    };
  }
  return { permitido: true };
}
