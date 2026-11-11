// Trava em arquivo compartilhada pelos specs que mexem no caixa de hoje (caixa, cobranca,
// financeiro): só existe um caixa por dia no projeto de testes, então os três nunca podem
// rodar ao mesmo tempo (nem em viewports ou workers diferentes). Quem pega a trava deve
// devolvê-la no afterAll com o `liberar` retornado.
import { mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const TRAVA = join(tmpdir(), "e2e-caixa-de-hoje.lock");

/** Tempo máximo de espera pela trava; o beforeAll de quem a usa precisa de timeout MAIOR que isto. */
export const ESPERA_TRAVA_MS = 25 * 60_000;
export const TIMEOUT_PREPARACAO_MS = 30 * 60_000;

/**
 * Espera até `espera` ms. Se conseguir a trava depois do prazo (o chamador já desistiu),
 * devolve-a na hora e falha, para não deixar uma trava órfã.
 */
export async function adquirirTravaCaixa(espera = ESPERA_TRAVA_MS): Promise<() => Promise<void>> {
  const limite = Date.now() + espera;
  while (Date.now() < limite) {
    try {
      await mkdir(TRAVA);
      if (Date.now() > limite) {
        await rm(TRAVA, { recursive: true, force: true });
        break;
      }
      return () => rm(TRAVA, { recursive: true, force: true });
    } catch {
      // Trava velha (execução interrompida): descarta.
      const s = await stat(TRAVA).catch(() => null);
      if (s && Date.now() - s.mtimeMs > 30 * 60_000) await rm(TRAVA, { recursive: true, force: true });
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("Não foi possível obter a trava do caixa de hoje (e2e/trava-caixa.ts).");
}
