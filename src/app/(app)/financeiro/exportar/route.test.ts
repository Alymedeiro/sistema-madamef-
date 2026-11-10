import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { Perfil } from "@/lib/dominio/permissoes";
import { conteudoDoPdf } from "@/test/pdf-texto";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Fernanda", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("server-only", () => ({}));

let falso = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));

import { GET, maxDuration } from "./route";

const ok = (data: unknown) => ({ data, error: null });
const chamar = (q: string) => GET(new Request(`http://x/financeiro/exportar${q}`));
const nomeDoArquivo = (res: Response) => res.headers.get("content-disposition");

beforeEach(() => {
  // 10/11/2026 10:00 em São Paulo.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T13:00:00Z"));
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  falso.definirPadrao(ok([]));
  exigirPerfil.mockClear();
});
afterEach(() => vi.useRealTimers());

describe("GET /financeiro/exportar", () => {
  it("maxDuration de 60 s", () => {
    expect(maxDuration).toBe(60);
  });

  it("recepção recebe 403, sem nenhuma consulta", async () => {
    perfilAtual = "recepcao";
    const res = await chamar("?aba=pagar");
    expect(res.status).toBe(403);
    expect(falso.chamadas).toHaveLength(0);
  });

  it("profissional também recebe 403", async () => {
    perfilAtual = "profissional";
    expect((await chamar("")).status).toBe(403);
  });

  it("contas a pagar: registra o relatório antes de ler e devolve o PDF com nome do arquivo", async () => {
    falso.responder(
      "contas_pagar",
      ok([
        {
          id: "p1",
          descricao: "Aluguel da sala",
          categoria: "aluguel",
          fornecedor: "Imobiliária",
          valor_centavos: 250000,
          vencimento: "2026-11-15",
          status: "aberta",
          pago_em: null,
          forma: null,
          anexo_path: null,
          conta_fixa_id: null,
          colaborador: null,
        },
      ]),
    );
    const res = await chamar(
      "?aba=pagar&periodo=personalizado&de=2026-11-01&ate=2026-11-30&situacao=aberta&categoria=aluguel&busca=sala",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(nomeDoArquivo(res)).toBe('attachment; filename="financeiro-pagar-2026-11-01-2026-11-30.pdf"');
    expect(res.headers.get("cache-control")).toBe("no-store");
    const pdf = new Uint8Array(await res.arrayBuffer());
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThanOrEqual(1);

    expect(falso.chamadasRpc("registrar_relatorio").map((c) => c.args[0])).toEqual([
      { p_aba: "pagar", p_de: "2026-11-01", p_ate: "2026-11-30" },
    ]);
    const idxRegistro = falso.chamadas.findIndex((c) => c.tabela === "rpc:registrar_relatorio");
    const idxLeitura = falso.chamadas.findIndex((c) => c.tabela === "contas_pagar");
    expect(idxRegistro).toBe(0);
    expect(idxLeitura).toBeGreaterThan(idxRegistro);
    // Mesmos filtros da aba: categoria, busca e situação "Em aberto" (vencimento ≥ hoje).
    expect(falso.chamadasDe("contas_pagar", "eq").map((c) => c.args)).toContainEqual(["categoria", "aluguel"]);
    expect(falso.chamadasDe("contas_pagar", "gte").map((c) => c.args)).toContainEqual([
      "vencimento",
      "2026-11-10",
    ]);
    expect(falso.chamadasDe("contas_pagar", "or")).toHaveLength(1);
    const { texto } = await conteudoDoPdf(pdf);
    for (const esperado of ["Aluguel da sala", "Imobiliária", "R$ 2.500,00", "Situação: Em aberto", "Categoria: Aluguel", 'Busca: "sala"']) {
      expect(texto).toContain(esperado);
    }
    expect(texto).toContain("Período: 01/11/2026 a 30/11/2026\n");
  });

  it("parâmetros inválidos: aba Painel e período padrão (este mês)", async () => {
    const res = await chamar("?aba=xyz&periodo=personalizado&de=2026-12-31&ate=2026-01-01");
    expect(res.status).toBe(200);
    expect(nomeDoArquivo(res)).toBe('attachment; filename="financeiro-painel-2026-11-01-2026-11-30.pdf"');
    expect(falso.chamadasRpc("registrar_relatorio")[0].args[0]).toEqual({
      p_aba: "painel",
      p_de: "2026-11-01",
      p_ate: "2026-11-30",
    });
    expect(falso.chamadasRpc("resumo_financeiro")[0].args[0]).toEqual({
      p_de: "2026-11-01",
      p_ate: "2026-11-30",
    });
    const { texto } = await conteudoDoPdf(new Uint8Array(await res.arrayBuffer()));
    expect(texto).toContain("Relatório financeiro — Painel".replace("—", "\u0097"));
    expect(texto).toContain("Período: Novembro de 2026 (01/11/2026 a 30/11/2026)");
    expect(texto).toContain("Gerado em 10/11/2026 10:00 por Fernanda");
    expect(texto).toContain("Saldo projetado");
  });

  it("data impossível também cai no padrão", async () => {
    const res = await chamar("?aba=fluxo&periodo=personalizado&de=2026-02-30&ate=2026-03-10");
    expect(nomeDoArquivo(res)).toBe('attachment; filename="financeiro-fluxo-2026-11-01-2026-11-30.pdf"');
    expect(falso.chamadasRpc("fluxo_caixa")[0].args[0]).toEqual({
      p_de: "2026-11-01",
      p_ate: "2026-11-30",
      p_agrupar: "dia",
    });
  });

  it("aba Caixa do dia não tem PDF: exporta o Painel", async () => {
    const res = await chamar("?aba=caixa&periodo=ano");
    expect(nomeDoArquivo(res)).toBe('attachment; filename="financeiro-painel-2026-01-01-2026-12-31.pdf"');
  });

  it("contas a receber usa o período e a situação pedidos", async () => {
    const res = await chamar("?aba=receber&periodo=mes_passado&situacao=paga");
    expect(nomeDoArquivo(res)).toBe('attachment; filename="financeiro-receber-2026-10-01-2026-10-31.pdf"');
    expect(falso.chamadasDe("contas_receber", "not").map((c) => c.args)).toContainEqual([
      "recebido_em",
      "is",
      null,
    ]);
  });

  it("falha ao registrar o relatório: nada é entregue", async () => {
    falso.responder("rpc:registrar_relatorio", { data: null, error: { message: "Acesso não autorizado" } });
    await expect(chamar("?aba=pagar")).rejects.toThrow();
    expect(falso.chamadasDe("contas_pagar")).toHaveLength(0);
  });
});
