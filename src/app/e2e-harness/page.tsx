import { notFound } from "next/navigation";
import { Harness } from "./harness";

// Página de apoio só dos testes de tela (sem backend). Em builds normais
// (sem NEXT_PUBLIC_E2E_HARNESS=1) a variável é substituída na compilação e a
// rota responde 404; o middleware também não a libera (ver lib/auth/rotas.ts).
export default function PaginaHarness() {
  if (process.env.NEXT_PUBLIC_E2E_HARNESS !== "1") notFound();
  return <Harness />;
}
