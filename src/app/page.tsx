import { redirect } from "next/navigation";

// A raiz leva ao painel; o middleware manda quem não está logado para /login.
export default function Home() {
  redirect("/inicio");
}
