import "server-only";
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import { dataNoFuso } from "@/lib/dominio/tempo";
import { registrarAcesso, type Supabase } from "@/lib/ficha/acesso";
import { BUCKET_FICHA } from "@/lib/ficha/caminhos";

export type ArquivoExportado = { noZip: string; noStorage: string };

/** Só letras, números, `_` e `-`: nada vindo do banco ou do cliente sai da pasta do ZIP. */
const seguro = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");

/** `madame-fe-<slug sem acento>-<yyyy-mm-dd>.zip`, só ASCII seguro para o cabeçalho. */
export function nomeArquivoExportacao(nome: string, hoje: string): string {
  const slug = nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `madame-fe-${slug || "cliente"}-${seguro(hoje)}.zip`;
}

export function arquivosDaExportacao(l: {
  anamneses: { id: string; assinatura_path: string }[];
  termos: { id: string; pdf_path: string; assinatura_path: string }[];
  fotos: { id: string; path: string }[];
}): ArquivoExportado[] {
  return [
    ...l.anamneses.map((a) => ({
      noZip: `anamneses/${seguro(a.id)}-assinatura.png`,
      noStorage: a.assinatura_path,
    })),
    ...l.termos.flatMap((t) => [
      { noZip: `termos/${seguro(t.id)}.pdf`, noStorage: t.pdf_path },
      { noZip: `termos/${seguro(t.id)}-assinatura.png`, noStorage: t.assinatura_path },
    ]),
    ...l.fotos.map((f) => ({ noZip: `fotos/${seguro(f.id)}.jpg`, noStorage: f.path })),
  ];
}

function ler<T>(res: { data: T[] | null; error: { message: string } | null }, o: string): T[] {
  if (res.error) throw new Error(`Falha ao carregar ${o}: ${res.error.message}`);
  return res.data ?? [];
}

/**
 * ZIP com os dados da cliente (`dados.json`) e seus arquivos. Só para a dona
 * (a rota checa). Audita antes de ler qualquer coisa; se a auditoria falhar,
 * nada é lido nem entregue. Os arquivos são baixados um por vez conforme o
 * consumidor puxa o corpo, então a memória fica em torno de um arquivo (≤ 5 MB).
 * `armazenamento` é o cliente que baixa do Storage (a rota passa o de serviço).
 */
export async function gerarZipExportacao(
  supabase: Supabase,
  clienteId: string,
  armazenamento: Pick<Supabase, "storage"> = supabase,
  agora: Date = new Date(),
): Promise<{ nome: string; corpo: ReadableStream<Uint8Array> }> {
  await registrarAcesso(supabase, { entidade: "exportacao", clienteId });

  const [cli, ag, an, te, fo, ev, pa, co, pg, cr, au] = await Promise.all([
    supabase.from("clientes").select("*").eq("id", clienteId).maybeSingle(),
    supabase.from("agendamentos").select("*").eq("cliente_id", clienteId).order("inicio"),
    supabase
      .from("anamneses")
      .select("*, modelos_anamnese(perguntas)")
      .eq("cliente_id", clienteId)
      .order("preenchida_em"),
    supabase
      .from("termos_assinados")
      .select("*, modelos_termo(titulo, texto)")
      .eq("cliente_id", clienteId)
      .order("assinado_em"),
    supabase.from("fotos").select("*").eq("cliente_id", clienteId).order("tirada_em"),
    supabase.from("evolucoes").select("*").eq("cliente_id", clienteId).order("criado_em"),
    supabase.from("pacotes_vendidos").select("*").eq("cliente_id", clienteId).order("vendido_em"),
    supabase.from("cobrancas").select("*").eq("cliente_id", clienteId).order("lancada_em"),
    supabase.from("pagamentos").select("*").eq("cliente_id", clienteId).order("criado_em"),
    supabase
      .from("contas_receber")
      .select("*")
      .eq("cliente_id", clienteId)
      .order("vencimento")
      .order("numero"),
    // Registro de acessos à ficha (inclui o desta exportação, gravado acima).
    supabase.from("auditoria").select("*").eq("cliente_id", clienteId).order("ocorrido_em"),
  ]);
  if (cli.error) throw new Error(`Falha ao carregar a cliente: ${cli.error.message}`);
  if (!cli.data) throw new Error("Cliente não encontrada");
  const cliente = cli.data;
  const agendamentos = ler(ag, "os agendamentos");
  const anamneses = ler(an, "as anamneses");
  const termos = ler(te, "os termos");
  const fotos = ler(fo, "as fotos");
  const evolucoes = ler(ev, "as evoluções");
  const pacotes = ler(pa, "os pacotes");
  const cobrancas = ler(co, "as cobranças");
  const partes = ler(pg, "os pagamentos");
  const contasReceber = ler(cr, "as contas a receber");
  const auditoria = ler(au, "o registro de acessos");

  const um = <T,>(v: T | T[] | null | undefined): T | null =>
    Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  const arquivos = arquivosDaExportacao({ anamneses, termos, fotos });
  const indisponiveis: string[] = [];

  const montarDados = () => ({
    exportado_em: agora.toISOString(),
    cliente,
    agendamentos,
    anamneses: anamneses.map(({ modelos_anamnese, ...a }) => ({
      ...a,
      perguntas: um(modelos_anamnese)?.perguntas ?? [],
    })),
    termos: termos.map(({ modelos_termo, ...t }) => ({
      ...t,
      titulo: um(modelos_termo)?.titulo ?? null,
      texto_do_termo: um(modelos_termo)?.texto ?? null,
    })),
    fotos,
    evolucoes,
    pacotes,
    cobrancas: cobrancas.map((c) => ({
      ...c,
      partes: partes.filter((p) => p.cobranca_id === c.id),
    })),
    contas_receber: contasReceber,
    auditoria,
    arquivos_indisponiveis: indisponiveis,
  });

  // Passos do ZIP: um arquivo por vez; `dados.json` por último, já sabendo o que falhou.
  const passos: (() => Promise<void>)[] = [];
  const pendentes: Uint8Array[] = [];
  let terminou = false;
  let falha: Error | null = null;
  const zip = new Zip((err, chunk, final) => {
    if (err) falha = err;
    else pendentes.push(chunk);
    if (final) terminou = true;
  });
  for (const a of arquivos) {
    passos.push(async () => {
      let bytes: Uint8Array | null = null;
      try {
        const { data, error } = await armazenamento.storage
          .from(BUCKET_FICHA)
          .download(a.noStorage);
        if (!error && data) bytes = new Uint8Array(await data.arrayBuffer());
      } catch {
        bytes = null;
      }
      if (!bytes) {
        indisponiveis.push(a.noZip);
        return;
      }
      const f = new ZipPassThrough(a.noZip);
      zip.add(f);
      f.push(bytes, true);
    });
  }
  passos.push(async () => {
    const f = new ZipDeflate("dados.json", { level: 6 });
    zip.add(f);
    f.push(strToU8(JSON.stringify(montarDados(), null, 2)), true);
    zip.end();
  });

  const corpo = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (pendentes.length === 0 && !terminou && passos.length > 0) {
          await passos.shift()!();
        }
        if (falha) throw falha;
        while (pendentes.length > 0) controller.enqueue(pendentes.shift()!);
        if (terminou && pendentes.length === 0) controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  return { nome: nomeArquivoExportacao(cliente.nome, dataNoFuso(agora)), corpo };
}
