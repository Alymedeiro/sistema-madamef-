import { beforeEach, describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import type { Perfil } from "@/lib/dominio/permissoes";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { criarSupabaseFalso } from "@/test/supabase-falso";

let perfilAtual: Perfil = "dona";
const exigirPerfil = vi.fn(async (...perfis: Perfil[]) => {
  if (perfis.length > 0 && !perfis.includes(perfilAtual)) throw new Error("REDIRECT:/inicio");
  return { userId: "u1", colaborador: { id: "c1", nome: "Dona", perfil: perfilAtual } };
});
vi.mock("@/lib/sessao", () => ({ exigirPerfil: (...p: Perfil[]) => exigirPerfil(...p) }));
vi.mock("server-only", () => ({}));

let falso = criarSupabaseFalso();
let admin = criarSupabaseFalso();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => falso.cliente }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.cliente }));

import { GET } from "./route";

const C = "5b0c1d52-3c4e-4f6a-8b7d-1a2b3c4d5e6f";
const ok = (data: unknown) => ({ data, error: null });
const BUCKET = "storage:ficha-clinica";
const blob = () => ok(new Blob([new Uint8Array([1, 2, 3])]));

function prepararFicha() {
  falso.responder(
    "clientes",
    ok({ id: C, nome: "Ana Souza" }), // checagem da rota
    ok({ id: C, nome: "Ana Souza", cpf: "123" }), // exportação
  );
  falso.responder("agendamentos", ok([{ id: "G1", inicio: "2026-01-01T10:00:00Z" }]));
  falso.responder(
    "anamneses",
    ok([{ id: "A1", assinatura_path: "pa", modelos_anamnese: { perguntas: [{ id: "q" }] } }]),
  );
  falso.responder("termos_assinados", ok([{ id: "T1", pdf_path: "pt", assinatura_path: "ps" }]));
  falso.responder("fotos", ok([{ id: "F1", path: "pf", arquivada: true }]));
  falso.responder("evolucoes", ok([{ id: "E1", texto: "ok" }]));
  falso.responder("pacotes_vendidos", ok([{ id: "P1" }]));
  falso.responder("cobrancas", ok([{ id: "B1" }]));
  falso.responder("pagamentos", ok([{ id: "M1", cobranca_id: "B1", valor_centavos: 100 }]));
  admin.definirPadrao(ok(null));
}

const chamar = (id: string) =>
  GET(new Request("http://x/clientes/C/exportar"), { params: Promise.resolve({ id }) });

beforeEach(() => {
  perfilAtual = "dona";
  falso = criarSupabaseFalso();
  admin = criarSupabaseFalso();
  exigirPerfil.mockClear();
});

describe("GET /clientes/[id]/exportar", () => {
  it("devolve o ZIP com dados.json e os arquivos, e audita antes de ler", async () => {
    prepararFicha();
    const res = await chamar(C);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="madame-fe-ana-souza-${dataNoFuso(new Date())}.zip"`,
    );
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual([
      "anamneses/A1-assinatura.png",
      "dados.json",
      "fotos/F1.jpg",
      "termos/T1-assinatura.png",
      "termos/T1.pdf",
    ]);
    const dados = JSON.parse(strFromU8(zip["dados.json"]));
    expect(dados.cliente.nome).toBe("Ana Souza");
    expect(dados.fotos[0].arquivada).toBe(true);
    expect(dados.cobrancas[0].partes).toEqual([
      { id: "M1", cobranca_id: "B1", valor_centavos: 100 },
    ]);
    expect(dados.anamneses[0].perguntas).toEqual([{ id: "q" }]);
    expect(dados.arquivos_indisponiveis).toEqual([]);

    expect(falso.chamadasRpc("registrar_acesso")[0].args[0]).toEqual({
      p_entidade: "exportacao",
      p_entidade_id: null,
      p_cliente: C,
    });
    const idxRpc = falso.chamadas.findIndex((c) => c.tabela === "rpc:registrar_acesso");
    const idxLeituras = falso.chamadas.findIndex((c) => c.tabela === "anamneses");
    expect(idxRpc).toBeGreaterThan(-1);
    expect(idxRpc).toBeLessThan(idxLeituras);
    // Arquivos baixados com o cliente de serviço, só depois da checagem da dona.
    expect(
      admin
        .chamadasDe(BUCKET, "download")
        .map((c) => c.args[0])
        .sort(),
    ).toEqual(["pa", "pf", "ps", "pt"]);
  });

  it("arquivo que falha ao baixar sai do ZIP e entra em arquivos_indisponiveis", async () => {
    prepararFicha();
    // Ordem de download: anamnese, termo pdf, termo assinatura, foto.
    admin.responder(`${BUCKET}:download`, blob(), blob(), blob(), {
      data: null,
      error: { message: "falhou" },
    });
    const res = await chamar(C);
    const zip = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(zip["fotos/F1.jpg"]).toBeUndefined();
    expect(zip["termos/T1.pdf"]).toBeDefined();
    expect(JSON.parse(strFromU8(zip["dados.json"])).arquivos_indisponiveis).toEqual([
      "fotos/F1.jpg",
    ]);
  });

  it("falha na auditoria: nada é entregue", async () => {
    prepararFicha();
    falso.responder("rpc:registrar_acesso", {
      data: null,
      error: { message: "Acesso não autorizado" },
    });
    await expect(chamar(C)).rejects.toThrow();
    expect(admin.chamadasDe(BUCKET, "download")).toHaveLength(0);
    expect(falso.chamadasDe("anamneses")).toHaveLength(0);
  });

  it("recepção é barrada antes de qualquer consulta", async () => {
    perfilAtual = "recepcao";
    await expect(chamar(C)).rejects.toThrow("REDIRECT:/inicio");
    expect(falso.chamadas).toHaveLength(0);
  });

  it("id inválido e cliente inexistente: 404", async () => {
    expect((await chamar("abc")).status).toBe(404);
    falso.responder("clientes", ok(null));
    expect((await chamar(C)).status).toBe(404);
    expect(falso.chamadasRpc("registrar_acesso")).toHaveLength(0);
  });
});
