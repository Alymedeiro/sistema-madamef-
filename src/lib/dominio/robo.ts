// Robô de atendimento por menu (sem IA). Espelha os textos de
// supabase/migrations/0017_robo.sql (robo_renderizar, robo_texto_horario e o
// menu de robo_processar) para a prévia em Configurações → WhatsApp.
import { ORDEM_DIAS, horarioDoBanco } from "./intervalos";

export type TipoOpcaoRobo = "texto" | "agendar_online" | "falar_com_equipe";
export type QuandoRobo = "sempre" | "fora_do_horario";

export const ROTULO_TIPO_OPCAO: Record<TipoOpcaoRobo, string> = {
  texto: "Responder com texto",
  agendar_online: "Link de agendamento online",
  falar_com_equipe: "Falar com a equipe (pausa o robô)",
};

export const ROTULO_QUANDO: Record<QuandoRobo, string> = {
  sempre: "Sempre",
  fora_do_horario: "Só fora do horário de funcionamento",
};

export const MAX_OPCOES_ROBO = 8;

/** Iguais aos padrões de robo_config em 0017. */
export const ROBO_PADRAO = {
  boasVindas:
    "Oi, {nome}! 💕 Sou a assistente virtual da {clinica}. Escolha uma opção digitando o número:",
  naoEntendi: "Não entendi 😊 Digite o número de uma das opções ou 0 para ver o menu.",
  rodapeOpcao: "Digite 0 para voltar ao menu.",
} as const;

/** Resposta fixa da opção falar_com_equipe (0017). */
export const TEXTO_FALAR_COM_EQUIPE = "Certo! Já avisei a equipe, em breve alguém te responde. 💕";
export const TEXTO_SEM_LINK =
  "Para agendar, responda esta mensagem que a equipe te ajuda.";

export type DadosRobo = {
  nome?: string | null;
  clinica?: string | null;
  endereco?: string | null;
  horario?: string | null;
};

export type OpcaoRobo = {
  numero: number;
  rotulo: string;
  tipo: TipoOpcaoRobo;
  resposta: string | null;
  ativo: boolean;
};

const NOME_CURTO: Record<number, string> = {
  0: "dom",
  1: "seg",
  2: "ter",
  3: "qua",
  4: "qui",
  5: "sex",
  6: "sáb",
};

/**
 * horario_funcionamento por extenso, de segunda a domingo, agrupando dias
 * seguidos com os mesmos horários ("seg a sex 09:00 às 18:00; sáb 09:00 às
 * 13:00"). Nenhum dia aberto → "consulte a equipe". Igual a robo_texto_horario.
 */
export function textoHorario(horario: unknown): string {
  const porDia = horarioDoBanco(horario);
  const textos = ORDEM_DIAS.map((d) => {
    const lista = porDia[String(d) as keyof typeof porDia];
    return lista.length ? lista.map((i) => `${i.inicio} às ${i.fim}`).join(" e ") : null;
  });
  const partes: string[] = [];
  let k = 0;
  while (k < textos.length) {
    const atual = textos[k];
    let fim = k;
    while (atual !== null && fim + 1 < textos.length && textos[fim + 1] === atual) fim++;
    if (atual !== null) {
      const ini = NOME_CURTO[ORDEM_DIAS[k]];
      const ult = NOME_CURTO[ORDEM_DIAS[fim]];
      const dias = fim === k ? ini : fim === k + 1 ? `${ini} e ${ult}` : `${ini} a ${ult}`;
      partes.push(`${dias} ${atual}`);
    }
    k = fim + 1;
  }
  return partes.length ? partes.join("; ") : "consulte a equipe";
}

/**
 * Troca {nome} (primeiro nome; sem nome some junto com a vírgula e o espaço
 * antes: "Oi, {nome}!" → "Oi!"), {clinica}, {endereco} e {horario}.
 * Desconhecida fica literal. Igual a robo_renderizar.
 */
export function renderizarRobo(texto: string, dados: DadosRobo): string {
  const nome = (dados.nome ?? "").trim().split(/\s+/)[0] ?? "";
  let v = nome === "" ? texto.replace(/,?\s*\{nome\}/g, "") : texto.replaceAll("{nome}", nome);
  v = v
    .replaceAll("{clinica}", dados.clinica ?? "")
    .replaceAll("{endereco}", dados.endereco ?? "")
    .replaceAll("{horario}", dados.horario ?? "");
  return v.trim();
}

/** Boas-vindas + linha em branco + "N - rótulo" das opções ativas em ordem. */
export function montarMenu(boasVindas: string, opcoes: readonly OpcaoRobo[], dados: DadosRobo): string {
  const linhas = opcoes
    .filter((o) => o.ativo)
    .sort((a, b) => a.numero - b.numero)
    .map((o) => `${o.numero} - ${o.rotulo.trim()}`);
  const topo = renderizarRobo(boasVindas, dados);
  return linhas.length ? `${topo}\n\n${linhas.join("\n")}` : topo;
}

/** Resposta de uma opção, com o rodapé (vazio → sem rodapé). */
export function respostaOpcao(
  opcao: OpcaoRobo,
  rodape: string,
  link: string | null,
  dados: DadosRobo,
): string {
  if (opcao.tipo === "falar_com_equipe") return TEXTO_FALAR_COM_EQUIPE;
  const corpo =
    opcao.tipo === "agendar_online"
      ? link
        ? `Agende pelo link: ${link}`
        : TEXTO_SEM_LINK
      : renderizarRobo(opcao.resposta ?? "", dados);
  return rodape.trim() ? `${corpo}\n\n${renderizarRobo(rodape, dados)}` : corpo;
}
