import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BotaoConfirmarCobranca,
  ROTULO_CORTESIA,
  cobrancaPronta,
  partesDaCobranca,
} from "./confirmar-cobranca";
import { novaParte } from "./editor-partes";

const html = (props: Parameters<typeof BotaoConfirmarCobranca>[0]) =>
  renderToStaticMarkup(createElement(BotaoConfirmarCobranca, props));

describe("BotaoConfirmarCobranca", () => {
  it("total zero: 'Cortesia — confirmar sem pagamento', habilitado", () => {
    const h = html({ liquidoCentavos: 0, pronto: true, pendente: false });
    expect(h).toContain(ROTULO_CORTESIA);
    expect(ROTULO_CORTESIA).toBe("Cortesia — confirmar sem pagamento");
    expect(h).not.toContain('disabled=""');
  });

  it("total maior que zero: 'Confirmar'; desabilitado até fechar ou enquanto envia", () => {
    expect(html({ liquidoCentavos: 100, pronto: true, pendente: false })).toMatch(/>Confirmar</);
    expect(html({ liquidoCentavos: 100, pronto: false, pendente: false })).toContain('disabled=""');
    expect(html({ liquidoCentavos: 0, pronto: true, pendente: true })).toContain('disabled=""');
  });
});

describe("cobrancaPronta / partesDaCobranca", () => {
  it("cortesia: pronta sem formas e envia []", () => {
    const linhas = [novaParte("pix", 0)];
    expect(cobrancaPronta(0, linhas)).toBe(true);
    expect(partesDaCobranca(0, linhas)).toEqual([]);
  });

  it("total maior que zero: precisa fechar; envia as linhas", () => {
    const linhas = [novaParte("pix", 10000)];
    expect(cobrancaPronta(10000, linhas)).toBe(true);
    expect(cobrancaPronta(10001, linhas)).toBe(false);
    expect(cobrancaPronta(null, linhas)).toBe(false);
    expect(partesDaCobranca(10000, linhas)).toEqual([
      { forma: "pix", valor: "100,00", parcelas: 1, primeiroVencimento: undefined },
    ]);
  });
});
