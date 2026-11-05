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

/** Linhas por página: o PostgREST do Supabase devolve no máximo 1000 por consulta. */
export const PAGINA_EXPORTACAO = 1000;

/**
 * Lê todas as linhas de uma consulta, página por página (`range`), até uma
 * página curta — sem isso o PostgREST corta em 1000 e o `dados.json` sairia
 * incompleto sem aviso. A consulta deve ter ordem total (termina em `id`).
 */
async function lerTodas<T>(
  pagina: (
    de: number,
    ate: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  o: string,
): Promise<T[]> {
  const todas: T[] = [];
  for (let de = 0; ; de += PAGINA_EXPORTACAO) {
    const res = await pagina(de, de + PAGINA_EXPORTACAO - 1);
    if (res.error) throw new Error(`Falha ao carregar ${o}: ${res.error.message}`);
    const linhas = res.data ?? [];
    todas.push(...linhas);
    if (linhas.length < PAGINA_EXPORTACAO) return todas;
  }
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

  const [
    cli,
    agendamentos,
    anamneses,
    termos,
    fotos,
    evolucoes,
    pacotes,
    cobrancas,
    partes,
    contasReceber,
    auditoria,
  ] = await Promise.all([
    supabase.from("clientes").select("*").eq("id", clienteId).maybeSingle(),
    lerTodas(
      (de, ate) =>
        supabase
          .from("agendamentos")
          .select("*")
          .eq("cliente_id", clienteId)
          .order("inicio")
          .order("id")
          .range(de, ate),
      "os agendamentos",
    ),
    lerTodas(
      (de, ate) =>
        supabase
          .from("anamneses")
          .select("*, modelos_anamnese(perguntas)")
          .eq("cliente_id", clienteId)
          .order("preenchida_em")
          .order("id")
          .range(de, ate),
      "as anamneses",
    ),
    lerTodas(
      (de, ate) =>
        supabase
          .from("termos_assinados")
          .select("*, modelos_termo(titulo, texto)")
          .eq("cliente_id", clienteId)
          .order("assinado_em")
          .order("id")
          .range(de, ate),
      "os termos",
    ),
    lerTodas(
      (de, ate) =>
        supabase
          .from("fotos")
          .select("*")
          .eq("cliente_id", clienteId)
          .order("tirada_em")
          .order("id")
          .range(de, ate),
      "as fotos",
    ),
    lerTodas(
      (de, ate) =>
        supabase
          .from("evolucoes")
          .select("*")
          .eq("cliente_id", clienteId)
          .order("criado_em")
          .order("id")
          .range(de, ate),
      "as evoluções",
    ),
    lerTodas(
      (de, ate) =>
        supabase
          .from("pacotes_vendidos")
          .select("*")
          .eq("cliente_id", clienteId)
          .order("vendido_em")
          .order("id")
          .range(de, ate),
      "os pacotes",
    ),
    lerTodas(
      (de, ate) =>
        supabase
          .from("cobrancas")
          .select("*")
          .eq("cliente_id", clienteId)
          .order("lancada_em")
          .order("id")
          .range(de, ate),
      "as cobranças",
    ),
    lerTodas(
      (de, ate) =>
        supabase
          .from("pagamentos")
          .select("*")
          .eq("cliente_id", clienteId)
          .order("criado_em")
          .order("id")
          .range(de, ate),
      "os pagamentos",
    ),
    lerTodas(
      (de, ate) =>
        supabase
          .from("contas_receber")
          .select("*")
          .eq("cliente_id", clienteId)
          .order("vencimento")
          .order("numero")
          .order("id")
          .range(de, ate),
      "as contas a receber",
    ),
    // Registro de acessos à ficha (inclui o desta exportação, gravado acima).
    lerTodas(
      (de, ate) =>
        supabase
          .from("auditoria")
          .select("*")
          .eq("cliente_id", clienteId)
          .order("ocorrido_em")
          .order("id")
          .range(de, ate),
      "o registro de acessos",
    ),
  ]);
  if (cli.error) throw new Error(`Falha ao carregar a cliente: ${cli.error.message}`);
  if (!cli.data) throw new Error("Cliente não encontrada");
  const cliente = cli.data;

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
