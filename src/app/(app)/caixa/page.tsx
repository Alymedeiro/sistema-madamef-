import { redirect } from "next/navigation";

// O caixa do dia agora é uma aba do Financeiro.
export default function CaixaPage(): never {
  redirect("/financeiro?aba=caixa");
}
