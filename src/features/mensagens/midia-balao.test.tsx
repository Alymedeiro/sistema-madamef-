import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MidiaConversa } from "@/app/(app)/mensagens/dados";
import { MidiaBalao } from "./midia-balao";

const base: MidiaConversa = {
  tipo: "imagem",
  status: "salva",
  url: "https://assinada/2026/11/r1.jpg?token=t",
  mime: "image/jpeg",
  nome: null,
  tamanho: null,
  legenda: null,
};
const html = (m: Partial<MidiaConversa>) => renderToStaticMarkup(<MidiaBalao midia={{ ...base, ...m }} />);

describe("MidiaBalao", () => {
  it("imagem: miniatura de até 240 px que abre em tamanho grande, com a legenda", () => {
    const h = html({ legenda: "Olha só" });
    expect(h).toContain('src="https://assinada/2026/11/r1.jpg?token=t"');
    expect(h).toContain("max-w-[240px]");
    expect(h).toContain("Abrir foto em tamanho grande");
    expect(h).toContain("Olha só");
  });

  it("vídeo, áudio e documento", () => {
    expect(html({ tipo: "video" })).toMatch(/<video[^>]*controls[^>]*preload="metadata"/);
    expect(html({ tipo: "audio" })).toMatch(/<audio[^>]*controls/);
    const doc = html({ tipo: "documento", nome: "Exame.pdf", tamanho: 2048 });
    expect(doc).toContain("Exame.pdf");
    expect(doc).toContain("2 KB");
    expect(doc).toContain("download=Exame.pdf");
    expect(doc).toContain("Baixar");
  });

  it("pendente, falhou e grande demais mostram o aviso (sem mídia)", () => {
    expect(html({ status: "pendente", url: null })).toContain("Carregando mídia…");
    expect(html({ status: "falhou", url: null })).toContain("Não foi possível baixar a mídia");
    const grande = html({ tipo: "video", status: "grande_demais", url: null, legenda: "festa" });
    expect(grande).toContain("Arquivo grande demais — veja no celular");
    expect(grande).toContain("festa");
    expect(grande).not.toContain("<video");
  });
});
