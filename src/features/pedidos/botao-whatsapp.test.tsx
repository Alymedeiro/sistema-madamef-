import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BotaoWhatsApp, descricaoAviso } from "./botao-whatsapp";

const props = { link: "https://wa.me/5511987654321?text=Oi", mensagem: "Oi, Ana!" };

describe("BotaoWhatsApp (depois de aprovar/recusar o pedido)", () => {
  it("resposta na fila (envio ligado e WhatsApp válido): não mostra o botão manual", () => {
    const html = renderToStaticMarkup(<BotaoWhatsApp {...props} naFila />);
    expect(html).toContain("Mensagem enviada para a fila");
    expect(html).not.toContain("Avisar no WhatsApp");
    expect(html).not.toContain("wa.me");
    expect(descricaoAviso(true)).not.toContain("Avise");
  });

  it("sem linha na fila (envio desligado, número estrangeiro, erro): mantém o botão manual", () => {
    const html = renderToStaticMarkup(<BotaoWhatsApp {...props} naFila={false} />);
    expect(html).toContain("Avisar no WhatsApp");
    expect(html).toContain('href="https://wa.me/5511987654321?text=Oi"');
    expect(html).toContain("Oi, Ana!");
    expect(html).not.toContain("Mensagem enviada para a fila");
    expect(descricaoAviso(false)).toBe("Avise a cliente pelo WhatsApp.");
  });
});
