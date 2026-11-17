import { describe, expect, it } from "vitest";
import { erroDasPerguntas } from "./anamnese";
import {
  caracteresUteis,
  extrairPerguntas,
  juntarComProxima,
  perguntasDaImportacao,
  separarPergunta,
  textoDosItensPdf,
  type PerguntaImportada,
} from "./anamnese-importar";

const incluidas = (itens: PerguntaImportada[]) => itens.filter((i) => i.incluir);

// Ficha 1: numerada, ( ) Sim ( ) Não, "Se sim, qual?" na linha seguinte, data, cabeçalho e
// rodapé repetidos em todas as páginas, números de página e linhas de sublinhado.
const FICHA_NUMERADA = `
Madame Fê Clinic - Estética Avançada
FICHA DE ANAMNESE FACIAL
DADOS PESSOAIS
1. Nome completo: ______________________________
2. Data de nascimento: __/__/____
3) Profissão:
Página 1 de 3

Madame Fê Clinic - Estética Avançada
HISTÓRICO DE SAÚDE
4. Está grávida ou amamentando? ( ) Sim ( ) Não
5. Faz uso de algum medicamento? ( ) Sim ( ) Não
Se sim, qual? _______________________
6. Tem alergia a algum cosmético,
medicamento ou alimento? [ ] sim [ ] não
______________________________________
Página 2 de 3

Madame Fê Clinic - Estética Avançada
7. Data da última aplicação de toxina botulínica:
8. Qual é a sua principal queixa?
Declaro que as informações acima são verdadeiras e que não omiti nenhuma
condição de saúde.
Assinatura: _____________________________
Página 3 de 3
Madame Fê Clinic - Estética Avançada
`;

// Ficha 2: múltipla escolha (inline e uma opção por linha), "Sim ( ) Não ( )", S/N, ☐.
const FICHA_OPCOES = `
ANAMNESE CORPORAL
Tipo de pele: ( ) Oleosa ( ) Seca ( ) Mista ( ) Normal
Quais procedimentos você já realizou?
☐ Drenagem linfática
☐ Massagem modeladora
☐ Criolipólise
Fuma? Sim ( ) Não ( )
Pratica atividade física? S/N
Possui marca-passo ou prótese metálica?
( ) Sim ( ) Não
Funcionamento intestinal: ( ) Regular ( ) Preso ( ) Solto
`;

// Ficha 3: sem numeração, quebras de linha no meio da frase, a) b), campo "dd/mm/aaaa",
// itens separados por "01 -", linha "1/2" e termo de responsabilidade.
const FICHA_QUEBRADA = `
Ficha de Avaliação - Depilação a Laser
01 - Você já fez depilação a laser
anteriormente em outra clínica?
02 - Usa ácidos ou retinoides na pele? ( ) Sim ( ) Não Quais? ____
a) Data da última exposição ao sol: ___/___/______
b) Tem tendência a manchas ou queloides?
( ) Sim ( ) Não
Especifique: ____________
1/2
Observações:
TERMO DE RESPONSABILIDADE
Estou ciente dos riscos do procedimento e autorizo sua realização.
`;

describe("extrairPerguntas — ficha numerada", () => {
  const itens = extrairPerguntas(FICHA_NUMERADA);
  const textos = incluidas(itens).map((i) => i.texto);

  it("remove numeração, cabeçalho repetido, número de página e sublinhados", () => {
    expect(textos).toEqual([
      "Nome completo",
      "Data de nascimento",
      "Profissão",
      "Está grávida ou amamentando?",
      "Faz uso de algum medicamento? Se sim, qual?",
      "Tem alergia a algum cosmético, medicamento ou alimento?",
      "Data da última aplicação de toxina botulínica",
      "Qual é a sua principal queixa?",
    ]);
    const todos = itens.map((i) => i.texto).join("\n");
    expect(todos).not.toContain("Madame Fê Clinic - Estética Avançada");
    expect(todos).not.toMatch(/Página \d/);
    expect(todos).not.toContain("___");
  });

  it("detecta os tipos", () => {
    const tipo = (t: string) => itens.find((i) => i.texto.startsWith(t))?.tipo;
    expect(tipo("Nome completo")).toBe("texto");
    expect(tipo("Data de nascimento")).toBe("data");
    expect(tipo("Profissão")).toBe("texto");
    expect(tipo("Está grávida")).toBe("sim_nao");
    expect(tipo("Faz uso de algum medicamento")).toBe("sim_nao_detalhe");
    expect(tipo("Tem alergia")).toBe("sim_nao");
    expect(tipo("Data da última")).toBe("data");
    expect(tipo("Qual é a sua principal queixa")).toBe("texto");
  });

  it("títulos de seção, declaração e assinatura entram desmarcados", () => {
    const fora = itens.filter((i) => !i.incluir).map((i) => i.texto);
    expect(fora).toContain("FICHA DE ANAMNESE FACIAL");
    expect(fora).toContain("DADOS PESSOAIS");
    expect(fora).toContain("HISTÓRICO DE SAÚDE");
    expect(fora.some((t) => t.startsWith("Declaro que") && t.endsWith("condição de saúde."))).toBe(true);
    expect(fora.some((t) => t.startsWith("Assinatura"))).toBe(true);
  });
});

describe("extrairPerguntas — opções", () => {
  const itens = incluidas(extrairPerguntas(FICHA_OPCOES));
  const achar = (t: string) => itens.find((i) => i.texto.startsWith(t));

  it("múltipla inline e uma por linha", () => {
    expect(achar("Tipo de pele")).toMatchObject({
      tipo: "multipla",
      opcoes: ["Oleosa", "Seca", "Mista", "Normal"],
    });
    expect(achar("Quais procedimentos")).toMatchObject({
      tipo: "multipla",
      opcoes: ["Drenagem linfática", "Massagem modeladora", "Criolipólise"],
    });
    expect(achar("Funcionamento intestinal")).toMatchObject({
      tipo: "multipla",
      opcoes: ["Regular", "Preso", "Solto"],
    });
  });

  it("sim/não nas variações", () => {
    expect(achar("Fuma")).toMatchObject({ texto: "Fuma?", tipo: "sim_nao" });
    expect(achar("Pratica atividade física")).toMatchObject({
      texto: "Pratica atividade física?",
      tipo: "sim_nao",
    });
    expect(achar("Possui marca-passo")).toMatchObject({ tipo: "sim_nao" });
    expect(achar("Fuma")?.opcoes).toBeUndefined();
  });

  it("não cria perguntas a partir das linhas de opção", () => {
    expect(itens).toHaveLength(6);
    expect(extrairPerguntas(FICHA_OPCOES)[0]).toMatchObject({
      texto: "ANAMNESE CORPORAL",
      incluir: false,
    });
  });
});

describe("extrairPerguntas — quebras e campos", () => {
  const itens = extrairPerguntas(FICHA_QUEBRADA);
  const dentro = incluidas(itens);

  it("junta a frase quebrada e remove '01 -', 'a)' e '1/2'", () => {
    expect(dentro.map((i) => i.texto)).toEqual([
      "Você já fez depilação a laser anteriormente em outra clínica?",
      "Usa ácidos ou retinoides na pele? Quais?",
      "Data da última exposição ao sol",
      "Tem tendência a manchas ou queloides? Especifique",
      "Observações",
    ]);
  });

  it("tipos com detalhe e data", () => {
    expect(dentro.map((i) => i.tipo)).toEqual([
      "texto",
      "sim_nao_detalhe",
      "data",
      "sim_nao_detalhe",
      "texto",
    ]);
  });

  it("termo fica desmarcado e o cabeçalho único não é pergunta incluída", () => {
    const fora = itens.filter((i) => !i.incluir).map((i) => i.texto);
    expect(fora).toContain("TERMO DE RESPONSABILIDADE");
    expect(fora.some((t) => t.startsWith("Estou ciente"))).toBe(true);
    expect(fora).toContain("Ficha de Avaliação - Depilação a Laser");
  });

  it("obrigatória vem desmarcada", () => {
    expect(itens.every((i) => !i.obrigatoria)).toBe(true);
  });
});

describe("extrairPerguntas — bordas", () => {
  it("texto vazio", () => {
    expect(extrairPerguntas("")).toEqual([]);
    expect(extrairPerguntas("  \n\n ____ \n")).toEqual([]);
  });

  it("vários campos na mesma linha viram perguntas separadas", () => {
    const r = extrairPerguntas("Nome: ____________ Telefone: ___________\nE-mail:");
    expect(r.map((i) => i.texto)).toEqual(["Nome", "Telefone", "E-mail"]);
  });

  it("'Não sei' não é sim/não puro: vira múltipla", () => {
    const [p] = extrairPerguntas("Tem diabetes? ( ) Sim ( ) Não ( ) Não sei");
    expect(p).toMatchObject({ tipo: "multipla", opcoes: ["Sim", "Não", "Não sei"] });
  });

  it("linha que se repete com marcadores não é tomada como cabeçalho", () => {
    const r = extrairPerguntas(
      "Fuma?\n( ) Sim ( ) Não\nBebe?\n( ) Sim ( ) Não\nUsa lente?\n( ) Sim ( ) Não",
    );
    expect(r.map((i) => i.tipo)).toEqual(["sim_nao", "sim_nao", "sim_nao"]);
  });
});

describe("juntar e separar", () => {
  const base: PerguntaImportada[] = [
    { texto: "Faz uso de", tipo: "texto", incluir: true, obrigatoria: false },
    { texto: "anticoncepcional?", tipo: "sim_nao", incluir: true, obrigatoria: false },
    { texto: "Fim", tipo: "texto", incluir: true, obrigatoria: false },
  ];

  it("juntar com a próxima concatena texto e herda tipo/opções se a primeira é texto", () => {
    const r = juntarComProxima(base, 0);
    expect(r).toHaveLength(2);
    expect(r[0]).toMatchObject({ texto: "Faz uso de anticoncepcional?", tipo: "sim_nao" });
    expect(juntarComProxima(base, 2)).toBe(base);
  });

  it("juntar mantém o tipo da primeira quando já não é texto e soma as opções", () => {
    const r = juntarComProxima(
      [
        { texto: "Pele", tipo: "multipla", opcoes: ["Seca"], incluir: true },
        { texto: "", tipo: "multipla", opcoes: ["Oleosa", "Seca"], incluir: true },
      ],
      0,
    );
    expect(r).toEqual([{ texto: "Pele", tipo: "multipla", opcoes: ["Seca", "Oleosa"], incluir: true }]);
  });

  it("separar no cursor", () => {
    const r = separarPergunta(
      [{ texto: "Fuma? Bebe?", tipo: "texto", incluir: true }],
      0,
      5,
    );
    expect(r.map((i) => i.texto)).toEqual(["Fuma?", "Bebe?"]);
  });

  it("separar sem cursor útil usa a primeira quebra de linha, senão o primeiro '?'", () => {
    expect(
      separarPergunta([{ texto: "Nome\nIdade", tipo: "texto", incluir: true }], 0).map((i) => i.texto),
    ).toEqual(["Nome", "Idade"]);
    expect(
      separarPergunta([{ texto: "Fuma? Bebe?", tipo: "texto", incluir: true }], 0, 0).map(
        (i) => i.texto,
      ),
    ).toEqual(["Fuma?", "Bebe?"]);
    const unico: PerguntaImportada[] = [{ texto: "Nome", tipo: "texto", incluir: true }];
    expect(separarPergunta(unico, 0)).toBe(unico);
  });
});

describe("perguntasDaImportacao", () => {
  it("só as incluídas, ids únicos sem colidir com os existentes, e passa na validação", () => {
    const r = perguntasDaImportacao(
      [
        { texto: "Fuma?", tipo: "sim_nao", incluir: true },
        { texto: "Fuma?", tipo: "sim_nao", incluir: true, obrigatoria: true },
        { texto: "TÍTULO", tipo: "texto", incluir: false },
        { texto: "   ", tipo: "texto", incluir: true },
        { texto: "Pele", tipo: "multipla", opcoes: [" Seca ", "Oleosa", ""], incluir: true },
      ],
      ["fuma"],
    );
    expect(r.map((p) => p.id)).toEqual(["fuma_2", "fuma_3", "pele"]);
    expect(r[0]).toEqual({ id: "fuma_2", tipo: "sim_nao", texto: "Fuma?", obrigatoria: false, alerta: false });
    expect(r[1].obrigatoria).toBe(true);
    expect(r[2]).toMatchObject({ tipo: "multipla", opcoes: ["Seca", "Oleosa"] });
    expect(erroDasPerguntas(r)).toBeNull();
  });

  it("múltipla com menos de 2 opções vira texto", () => {
    const [p] = perguntasDaImportacao(
      [{ texto: "Outro", tipo: "multipla", opcoes: ["Qual"], incluir: true }],
      [],
    );
    expect(p.tipo).toBe("texto");
    expect(p.opcoes).toBeUndefined();
  });

  it("ficha completa vira modelo válido", () => {
    const r = perguntasDaImportacao(extrairPerguntas(FICHA_NUMERADA + FICHA_OPCOES), []);
    expect(erroDasPerguntas(r)).toBeNull();
    expect(new Set(r.map((p) => p.id)).size).toBe(r.length);
  });
});

describe("textoDosItensPdf", () => {
  it("agrupa itens pela altura (y), ordena por x e separa páginas", () => {
    const texto = textoDosItensPdf([
      [
        { str: "Sim", x: 200, y: 700.4 },
        { str: "1. Fuma?", x: 50, y: 700 },
        { str: "( )", x: 180, y: 699.2 },
        { str: "2. Bebe?", x: 50, y: 680 },
        { str: "", x: 0, y: 0 },
      ],
      [{ str: "3. Nome:", x: 50, y: 750 }],
    ]);
    expect(texto).toBe("1. Fuma? ( ) Sim\n2. Bebe?\n3. Nome:");
  });
});

describe("caracteresUteis", () => {
  it("ignora espaços, sublinhados e pontuação", () => {
    expect(caracteresUteis(" ___ ... \n 1/3 ")).toBe(2);
    expect(caracteresUteis("Nome completo")).toBe(12);
  });
});
