import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => null }));
vi.mock("@/app/(app)/mensagens/actions", () => ({ marcarRespostaLida: vi.fn(), enviarWhatsApp: vi.fn() }));

import {
  AlertaWhatsappDesconectado,
  ListaRespostasWhatsapp,
  ResumoFalhasWhatsapp,
} from "./cartoes";

describe("Início: WhatsApp", () => {
  it("alerta de desconexão; link de configurações só para a dona", () => {
    const dona = renderToStaticMarkup(<AlertaWhatsappDesconectado ehDona />);
    expect(dona).toContain("WhatsApp desconectado");
    expect(dona).toContain('href="/configuracoes#whatsapp"');
    const recepcao = renderToStaticMarkup(<AlertaWhatsappDesconectado ehDona={false} />);
    expect(recepcao).toContain("WhatsApp desconectado");
    expect(recepcao).not.toContain("/configuracoes");
  });

  it("sem chaves: título próprio, ainda com o link de configurações", () => {
    const html = renderToStaticMarkup(<AlertaWhatsappDesconectado ehDona semChaves />);
    expect(html).toContain("Chaves da Z-API não configuradas");
    expect(html).not.toContain("WhatsApp desconectado");
    expect(html).toContain('href="/configuracoes#whatsapp"');
  });

  it("falhas levam à fila filtrada", () => {
    const html = renderToStaticMarkup(<ResumoFalhasWhatsapp falhas={2} />);
    expect(html).toContain("2 mensagens falharam nos últimos 7 dias.");
    expect(html).toContain('href="/mensagens?status=falhou"');
    expect(renderToStaticMarkup(<ResumoFalhasWhatsapp falhas={1} />)).toContain("1 mensagem falhou");
  });

  it("respostas não lidas com 'Marcar como lida' e link do agendamento", () => {
    const html = renderToStaticMarkup(
      <ListaRespostasWhatsapp
        itens={[
          {
            id: "r1",
            telefone: "5511987654321",
            texto: "Posso trocar para sexta?",
            recebidaEm: "2026-11-10T13:00:00Z",
            classificacao: "para_ler",
            lidaEm: null,
            clienteId: "c1",
            clienteNome: "Ana Souza",
            agendamentoId: "a1",
            agendamentoInicio: "2026-11-12T13:00:00Z",
          },
        ]}
      />,
    );
    expect(html).toContain("Ana Souza");
    expect(html).toContain("Posso trocar para sexta?");
    expect(html).toContain("Para ler");
    expect(html).toContain("Marcar como lida");
    expect(html).toContain('href="/agenda?data=2026-11-12"');
  });
});
