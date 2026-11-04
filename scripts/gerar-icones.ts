/**
 * Gera os ícones do PWA a partir do logo, recortando o monograma "mf" central
 * e centralizando-o sobre o fundo blush (#FEEDF3).
 *
 * Uso: pnpm tsx scripts/gerar-icones.ts
 * Saída: public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
 *        e src/app/icon.png (favicon, convenção do Next).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const RAIZ = path.resolve(import.meta.dirname, "..");
const LOGO = path.join(RAIZ, "public/brand/logo-madame-fe.png");
const SAIDA = path.join(RAIZ, "public/icons");
const FUNDO = { r: 0xfe, g: 0xed, b: 0xf3 };

// Região do monograma no logo de 732x730 (inclui os floreios do "m" e do "f").
const RECORTE = { left: 232, top: 216, width: 318, height: 221 };
// Os floreios laterais terminam em degradê (sem corte seco); o topo do "MADAME" fica de fora.
const DEGRADE_LATERAL = 26;

/** Recorte com o fundo do logo (rosa levemente diferente) tornado transparente. */
async function monograma(): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(LOGO)
    .extract(RECORTE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ref = [data[0], data[1], data[2]];
  for (let i = 0; i < data.length; i += 4) {
    const dist = Math.hypot(data[i] - ref[0], data[i + 1] - ref[1], data[i + 2] - ref[2]);
    const x = (i / 4) % info.width;
    const lateral = Math.min(1, x / DEGRADE_LATERAL, (info.width - 1 - x) / DEGRADE_LATERAL);
    const alfa = Math.max(0, Math.min(1, (dist - 6) / 70));
    data[i + 3] = Math.round(alfa * Math.max(0, lateral) * 255);
  }
  return { data, width: info.width, height: info.height };
}

async function icone(tamanho: number, fracao: number, arquivo: string): Promise<void> {
  const mono = await monograma();
  const largura = Math.round(tamanho * fracao);
  const recorte = await sharp(mono.data, {
    raw: { width: mono.width, height: mono.height, channels: 4 },
  })
    .resize({ width: largura })
    .png()
    .toBuffer();
  await sharp({ create: { width: tamanho, height: tamanho, channels: 3, background: FUNDO } })
    .composite([{ input: recorte, gravity: "center" }])
    .png()
    .toFile(arquivo);
  console.log("gerado", path.relative(RAIZ, arquivo));
}

async function main(): Promise<void> {
  await mkdir(SAIDA, { recursive: true });
  await icone(192, 0.8, path.join(SAIDA, "icon-192.png"));
  await icone(512, 0.8, path.join(SAIDA, "icon-512.png"));
  // Maskable: conteúdo dentro da zona segura (círculo de 80% do lado).
  await icone(512, 0.62, path.join(SAIDA, "icon-maskable-512.png"));
  await icone(180, 0.8, path.join(SAIDA, "apple-touch-icon.png"));
  await icone(256, 0.84, path.join(RAIZ, "src/app/icon.png"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
