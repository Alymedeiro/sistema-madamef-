import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { criarSupabaseFalso } from "@/test/supabase-falso";
import type { Supabase } from "@/lib/ficha/acesso";

vi.mock("server-only", () => ({}));

import { arquivosDaExportacao, gerarZipExportacao, nomeArquivoExportacao } from "./exportacao";

describe("nomeArquivoExportacao", () => {
  it("usa slug sem acento e a data", () => {
    expect(nomeArquivoExportacao("Ana Lúcia de Souza", "2026-11-04")).toBe(
      "madame-fe-ana-lucia-de-souza-2026-11-04.zip",
    );
  });
  it("não deixa caracteres perigosos nem nome vazio", () => {
    expect(nomeArquivoExportacao('../../etc/"passwd"\r\n', "2026-11-04")).toBe(
      "madame-fe-etc-passwd-2026-11-04.zip",
    );
    expect(nomeArquivoExportacao("???", "2026-11-04")).toBe("madame-fe-cliente-2026-11-04.zip");
  });
});

describe("arquivosDaExportacao", () => {
  it("mapeia os arquivos do Storage para caminhos dentro do ZIP", () => {
    expect(
      arquivosDaExportacao({
        anamneses: [{ id: "A1", assinatura_path: "p1" }],
        termos: [{ id: "T1", pdf_path: "p2", assinatura_path: "p3" }],
        fotos: [{ id: "F1", path: "p4" }],
      }),
    ).toEqual([
      { noZip: "anamneses/A1-assinatura.png", noStorage: "p1" },
      { noZip: "termos/T1.pdf", noStorage: "p2" },
      { noZip: "termos/T1-assinatura.png", noStorage: "p3" },
      { noZip: "fotos/F1.jpg", noStorage: "p4" },
    ]);
  });
  it("sanitiza ids para não sair da pasta", () => {
    const [a] = arquivosDaExportacao({
      anamneses: [{ id: "../x/y", assinatura_path: "p" }],
      termos: [],
      fotos: [],
    });
    expect(a.noZip).toBe("anamneses/___x_y-assinatura.png");
  });
});

async function lerCorpo(corpo: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const partes: Uint8Array[] = [];
  const leitor = corpo.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(value);
  }
  const total = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) {
    total.set(p, i);
    i += p.length;
  }
  return total;
}

describe("gerarZipExportacao", () => {
  it("pagina cada consulta de 1000 em 1000 até uma página curta (dados.json não é truncado)", async () => {
    const f = criarSupabaseFalso();
    f.definirPadrao({ data: [], error: null });
    f.responder("rpc:registrar_acesso", { data: null, error: null });
    f.responder("clientes", { data: { id: "C1", nome: "Ana" }, error: null });
    const linhas = (n: number, de = 0) => Array.from({ length: n }, (_, i) => ({ id: `x${de + i}` }));
    // Auditoria: 1000 + 3 linhas. Agendamentos: exatamente 1000, depois página vazia.
    f.responder("auditoria", { data: linhas(1000), error: null }, { data: linhas(3, 1000), error: null });
    f.responder("agendamentos", { data: linhas(1000), error: null }, { data: [], error: null });

    const { corpo } = await gerarZipExportacao(f.cliente as unknown as Supabase, "C1");
    const zip = unzipSync(await lerCorpo(corpo));
    const dados = JSON.parse(strFromU8(zip["dados.json"]));

    expect(dados.auditoria).toHaveLength(1003);
    expect(dados.auditoria[1002]).toEqual({ id: "x1002" });
    expect(dados.agendamentos).toHaveLength(1000);
    expect(f.chamadasDe("auditoria", "range").map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(f.chamadasDe("agendamentos", "range").map((c) => c.args)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    // Página curta na primeira: uma consulta só.
    expect(f.chamadasDe("fotos", "range").map((c) => c.args)).toEqual([[0, 999]]);
  });

  it("erro numa página seguinte aborta a exportação", async () => {
    const f = criarSupabaseFalso();
    f.definirPadrao({ data: [], error: null });
    f.responder("rpc:registrar_acesso", { data: null, error: null });
    f.responder("clientes", { data: { id: "C1", nome: "Ana" }, error: null });
    f.responder(
      "auditoria",
      { data: Array.from({ length: 1000 }, (_, i) => ({ id: `a${i}` })), error: null },
      { data: null, error: { message: "timeout" } },
    );
    await expect(gerarZipExportacao(f.cliente as unknown as Supabase, "C1")).rejects.toThrow(
      "Falha ao carregar o registro de acessos: timeout",
    );
  });
});
