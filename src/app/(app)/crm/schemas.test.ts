import { describe, expect, it } from "vitest";
import { converterLeadSchema, leadSchema, moverLeadSchema } from "./schemas";

const ID = "00000000-0000-4000-8000-0000000000a1";

describe("leadSchema", () => {
  it("recusa nome vazio ou só espaços", () => {
    expect(leadSchema.safeParse({ nome: "" }).success).toBe(false);
    expect(leadSchema.safeParse({ nome: "   " }).success).toBe(false);
  });

  it("normaliza o WhatsApp e transforma vazios em null", () => {
    expect(leadSchema.parse({ nome: " Ana ", whatsapp: "(41) 99999-0000" })).toEqual({
      nome: "Ana",
      whatsapp: "5541999990000",
      servicoId: null,
      origem: null,
      responsavelId: null,
      observacoes: null,
    });
    const vazio = leadSchema.parse({ nome: "Ana", whatsapp: "", servicoId: "", responsavelId: "" });
    expect(vazio.whatsapp).toBeNull();
    expect(vazio.servicoId).toBeNull();
  });

  it("recusa WhatsApp inválido com a mensagem exata", () => {
    const r = leadSchema.safeParse({ nome: "Ana", whatsapp: "123" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("Informe um WhatsApp válido.");
  });

  it("limita nome (120) e observações (2000); ids precisam ser uuid", () => {
    expect(leadSchema.safeParse({ nome: "a".repeat(121) }).success).toBe(false);
    expect(leadSchema.safeParse({ nome: "a", observacoes: "x".repeat(2001) }).success).toBe(false);
    expect(leadSchema.safeParse({ nome: "a", observacoes: "x".repeat(2000) }).success).toBe(true);
    expect(leadSchema.safeParse({ nome: "a", servicoId: "x" }).success).toBe(false);
    expect(leadSchema.safeParse({ nome: "a", servicoId: ID, responsavelId: ID }).success).toBe(true);
  });
});

describe("moverLeadSchema e converterLeadSchema", () => {
  it("etapa inválida e motivo > 200 são recusados", () => {
    expect(moverLeadSchema.safeParse({ id: ID, etapa: "x" }).success).toBe(false);
    expect(moverLeadSchema.safeParse({ id: ID, etapa: "perdido", motivo: "m".repeat(201) }).success).toBe(false);
    expect(moverLeadSchema.safeParse({ id: ID, etapa: "perdido", motivo: "m".repeat(200) }).success).toBe(true);
  });

  it("converter exige o aceite", () => {
    const r = converterLeadSchema.safeParse({ id: ID, aceiteLgpd: false, aceitaMarketing: true });
    expect(r.error?.issues[0].message).toBe("Confirme o aceite da LGPD.");
  });
});
