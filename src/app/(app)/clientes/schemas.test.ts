import { describe, expect, it } from "vitest";
import { clienteAtualizacaoSchema, clienteSchema } from "./schemas";

const base = {
  nome: "Ana",
  whatsapp: "(11) 98765-4321",
  cpf: "529.982.247-25",
  email: "",
  dataNascimento: "",
  endereco: "",
  origem: "",
  observacoes: "",
  aceiteLgpd: true,
  aceitaWhatsappMarketing: false,
};

function erro(dados: unknown): string | undefined {
  const r = clienteSchema.safeParse(dados);
  return r.success ? undefined : r.error.issues[0].message;
}

describe("clienteSchema", () => {
  it("normaliza WhatsApp e CPF", () => {
    const r = clienteSchema.parse(base);
    expect(r.whatsapp).toBe("5511987654321");
    expect(r.cpf).toBe("52998224725");
    expect(r.email).toBeNull();
    expect(r.dataNascimento).toBeNull();
    expect(r.endereco).toBeNull();
    expect(r.origem).toBeNull();
    expect(r.observacoes).toBeNull();
    expect(r.aceiteLgpd).toBe(true);
  });

  it("todas as grafias do mesmo telefone e CPF dão o mesmo valor", () => {
    const zaps = ["(11) 98765-4321", "11987654321", "+55 11 98765-4321", "5511987654321", "(011) 98765-4321"];
    for (const w of zaps) {
      expect(clienteSchema.parse({ ...base, whatsapp: w }).whatsapp).toBe("5511987654321");
    }
    for (const c of ["529.982.247-25", "52998224725", " 529 982 247 25 "]) {
      expect(clienteSchema.parse({ ...base, cpf: c }).cpf).toBe("52998224725");
    }
  });

  it("WhatsApp e CPF são opcionais", () => {
    const r = clienteSchema.parse({ ...base, whatsapp: "", cpf: "" });
    expect(r.whatsapp).toBeNull();
    expect(r.cpf).toBeNull();
    const semCampos = clienteSchema.parse({ nome: "Ana", aceiteLgpd: true });
    expect(semCampos.whatsapp).toBeNull();
    expect(semCampos.aceitaWhatsappMarketing).toBe(false);
  });

  it("rejeita CPF inválido", () => {
    expect(erro({ ...base, cpf: "111.111.111-11" })).toBe("CPF inválido");
    expect(erro({ ...base, cpf: "529.982.247-26" })).toBe("CPF inválido");
  });

  it("exige o aceite LGPD no cadastro", () => {
    expect(erro({ ...base, aceiteLgpd: false })).toBe("É preciso o aceite da cliente (LGPD)");
    expect(erro({ ...base, aceiteLgpd: undefined })).toBe("É preciso o aceite da cliente (LGPD)");
  });

  it("rejeita WhatsApp sem DDD", () => {
    expect(erro({ ...base, whatsapp: "98765-4321" })).toBe("Informe o WhatsApp com DDD");
  });

  it("exige nome e junta espaços repetidos", () => {
    expect(erro({ ...base, nome: "   " })).toBe("Informe o nome da cliente.");
    expect(clienteSchema.parse({ ...base, nome: "  Ana   Maria " }).nome).toBe("Ana Maria");
  });

  it("origem só aceita a lista; vazio vira null", () => {
    for (const o of ["instagram", "indicacao", "google", "passou_na_frente", "outro"]) {
      expect(clienteSchema.parse({ ...base, origem: o }).origem).toBe(o);
    }
    expect(erro({ ...base, origem: "tv" })).toBe("Origem inválida.");
  });

  it("valida e-mail e data de nascimento", () => {
    expect(clienteSchema.parse({ ...base, email: " Ana@Exemplo.com " }).email).toBe("ana@exemplo.com");
    expect(erro({ ...base, email: "ana@" })).toBe("E-mail inválido.");
    expect(clienteSchema.parse({ ...base, dataNascimento: "1990-05-17" }).dataNascimento).toBe("1990-05-17");
    expect(erro({ ...base, dataNascimento: "1990-02-31" })).toBe("Data de nascimento inválida.");
    expect(erro({ ...base, dataNascimento: "17/05/1990" })).toBe("Data de nascimento inválida.");
    expect(erro({ ...base, dataNascimento: "2999-01-01" })).toBe("Data de nascimento inválida.");
  });
});

describe("clienteAtualizacaoSchema", () => {
  it("não pede nem devolve o aceite LGPD", () => {
    const { aceiteLgpd: _a, ...semAceite } = base;
    void _a;
    const r = clienteAtualizacaoSchema.parse(semAceite);
    expect("aceiteLgpd" in r).toBe(false);
    expect(r.cpf).toBe("52998224725");
    const comAceiteFalso = clienteAtualizacaoSchema.parse({ ...semAceite, aceiteLgpd: false });
    expect("aceiteLgpd" in comAceiteFalso).toBe(false);
  });
});
