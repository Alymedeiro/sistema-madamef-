"use client";

import { useRef, useState } from "react";
import { FileUp, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { ROTULO_TIPO_PERGUNTA, type Pergunta, type TipoPergunta } from "@/lib/dominio/anamnese";
import {
  LIMITE_PDF_BYTES,
  LIMITE_TEXTO_IMPORTADO,
  MINIMO_CARACTERES_UTEIS,
  caracteresUteis,
  extrairPerguntas,
  juntarComProxima,
  perguntasDaImportacao,
  separarPergunta,
  type PerguntaImportada,
} from "@/lib/dominio/anamnese-importar";

export type ModoImportacao = "adicionar" | "substituir";

type ItemRevisao = PerguntaImportada & { chave?: string };

let contador = 0;
const comChaves = (itens: ItemRevisao[]): ItemRevisao[] =>
  itens.map((i) => (i.chave ? i : { ...i, chave: `imp${++contador}` }));

const SEM_TEXTO_NO_PDF =
  "Não encontramos texto neste PDF (parece uma foto ou um escaneado). Use 'Colar texto'.";
const SEM_PERGUNTAS = "Não encontramos perguntas neste texto. Confira se ele veio completo.";

const AREA_TEXTO =
  "w-full rounded-md border border-input bg-card p-3 text-base shadow-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring";

export function ImportarAnamnese({
  idsExistentes,
  totalAtual,
  onImportar,
}: {
  idsExistentes: string[];
  totalAtual: number;
  onImportar: (perguntas: Pergunta[], modo: ModoImportacao) => void;
}) {
  const inputPdf = useRef<HTMLInputElement>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [colarAberto, setColarAberto] = useState(false);
  const [textoColado, setTextoColado] = useState("");
  const [erroColar, setErroColar] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemRevisao[] | null>(null);
  const [confirmarSubstituir, setConfirmarSubstituir] = useState(false);

  function abrirRevisao(lista: PerguntaImportada[]) {
    setConfirmarSubstituir(false);
    setItens(comChaves(lista));
  }

  async function aoEscolherPdf(arquivo: File | undefined) {
    if (inputPdf.current) inputPdf.current.value = "";
    if (!arquivo) return;
    setErro(null);
    if (arquivo.type && arquivo.type !== "application/pdf") {
      setErro("Escolha um arquivo PDF.");
      return;
    }
    if (arquivo.size > LIMITE_PDF_BYTES) {
      setErro("O PDF passa de 10 MB. Use um arquivo menor ou 'Colar texto'.");
      return;
    }
    setLendo(true);
    try {
      const { textoDoPdf } = await import("./ler-pdf");
      const texto = await textoDoPdf(arquivo);
      if (caracteresUteis(texto) < MINIMO_CARACTERES_UTEIS) {
        setErro(SEM_TEXTO_NO_PDF);
        return;
      }
      const lista = extrairPerguntas(texto);
      if (lista.length === 0) setErro(SEM_PERGUNTAS);
      else abrirRevisao(lista);
    } catch {
      setErro("Não foi possível ler este PDF. Tente outro arquivo ou use 'Colar texto'.");
    } finally {
      setLendo(false);
    }
  }

  function analisarColado() {
    const lista = extrairPerguntas(textoColado.slice(0, LIMITE_TEXTO_IMPORTADO));
    if (lista.length === 0) {
      setErroColar(SEM_PERGUNTAS);
      return;
    }
    setErroColar(null);
    setColarAberto(false);
    setTextoColado("");
    abrirRevisao(lista);
  }

  function mudar(chave: string | undefined, parcial: Partial<PerguntaImportada>) {
    setItens((ls) => ls && ls.map((l) => (l.chave === chave ? { ...l, ...parcial } : l)));
  }

  function separar(i: number, chave: string | undefined) {
    const el = document.getElementById(`imp-texto-${chave}`) as HTMLTextAreaElement | null;
    setItens((ls) => ls && comChaves(separarPergunta(ls, i, el?.selectionStart ?? undefined)));
  }

  const selecionadas = itens?.filter((i) => i.incluir && i.texto.trim()).length ?? 0;

  function concluir(modo: ModoImportacao) {
    if (!itens) return;
    const perguntas = perguntasDaImportacao(itens, modo === "adicionar" ? idsExistentes : []);
    if (perguntas.length === 0) return;
    onImportar(perguntas, modo);
    setItens(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={lendo}
          onClick={() => inputPdf.current?.click()}
        >
          <FileUp aria-hidden />
          {lendo ? "Lendo o PDF…" : "Importar de PDF"}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setErroColar(null);
            setColarAberto(true);
          }}
        >
          <ClipboardPaste aria-hidden />
          Colar texto
        </Button>
        <input
          ref={inputPdf}
          type="file"
          accept="application/pdf"
          className="sr-only"
          tabIndex={-1}
          aria-label="Arquivo PDF da ficha de anamnese"
          onChange={(e) => void aoEscolherPdf(e.target.files?.[0])}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        O PDF é lido aqui no seu aparelho e não é enviado para lugar nenhum.
      </p>
      {erro ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {erro}
        </p>
      ) : null}

      <Dialog open={colarAberto} onOpenChange={setColarAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Colar texto da ficha</DialogTitle>
            <DialogDescription>
              Cole as perguntas da sua ficha. Na próxima tela você revisa tudo antes de usar.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="imp-colar">Texto</Label>
            <textarea
              id="imp-colar"
              rows={10}
              maxLength={LIMITE_TEXTO_IMPORTADO}
              value={textoColado}
              onChange={(e) => setTextoColado(e.target.value)}
              className={AREA_TEXTO}
            />
            <p className="text-right text-xs text-muted-foreground">
              {textoColado.length.toLocaleString("pt-BR")} /{" "}
              {LIMITE_TEXTO_IMPORTADO.toLocaleString("pt-BR")}
            </p>
            {erroColar ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {erroColar}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setColarAberto(false)}>
              Cancelar
            </Button>
            <Button type="button" disabled={!textoColado.trim()} onClick={analisarColado}>
              Ver perguntas
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={itens !== null} onOpenChange={(aberto) => !aberto && setItens(null)}>
        <DialogContent className="top-0 left-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-4 overflow-hidden rounded-none p-4 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[calc(100dvh-2rem)] sm:w-[calc(100%-2rem)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6">
          <DialogHeader>
            <DialogTitle>Revisar perguntas</DialogTitle>
            <DialogDescription>
              Desmarque o que não é pergunta, ajuste textos e tipos. Nada é salvo até você clicar
              em Salvar no modelo.
            </DialogDescription>
          </DialogHeader>

          <ol className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
            {(itens ?? []).map((item, i, lista) => (
              <li
                key={item.chave}
                className={`flex min-w-0 flex-col gap-3 rounded-xl border p-3 ${item.incluir ? "bg-card" : "bg-muted/40"}`}
              >
                <label className="flex min-h-11 items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={item.incluir}
                    onCheckedChange={(v) => mudar(item.chave, { incluir: v === true })}
                  />
                  Incluir a pergunta {i + 1}
                </label>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`imp-texto-${item.chave}`}>Texto da pergunta</Label>
                  <textarea
                    id={`imp-texto-${item.chave}`}
                    rows={2}
                    value={item.texto}
                    onChange={(e) => mudar(item.chave, { texto: e.target.value })}
                    className={AREA_TEXTO}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label htmlFor={`imp-tipo-${item.chave}`}>Tipo</Label>
                  <Select
                    id={`imp-tipo-${item.chave}`}
                    value={item.tipo}
                    onChange={(e) => mudar(item.chave, { tipo: e.target.value as TipoPergunta })}
                  >
                    {(Object.keys(ROTULO_TIPO_PERGUNTA) as TipoPergunta[]).map((t) => (
                      <option key={t} value={t}>
                        {ROTULO_TIPO_PERGUNTA[t]}
                      </option>
                    ))}
                  </Select>
                </div>
                {item.tipo === "multipla" ? (
                  <div className="flex flex-col gap-2">
                    <Label htmlFor={`imp-opcoes-${item.chave}`}>Opções (uma por linha)</Label>
                    <textarea
                      id={`imp-opcoes-${item.chave}`}
                      rows={4}
                      value={(item.opcoes ?? []).join("\n")}
                      onChange={(e) => mudar(item.chave, { opcoes: e.target.value.split("\n") })}
                      className={AREA_TEXTO}
                    />
                    {(item.opcoes ?? []).filter((o) => o.trim()).length < 2 ? (
                      <p className="text-sm text-muted-foreground">
                        Com menos de 2 opções, ela entra como texto livre.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <label className="mr-auto flex min-h-11 items-center gap-2 text-sm">
                    <Checkbox
                      checked={!!item.obrigatoria}
                      onCheckedChange={(v) => mudar(item.chave, { obrigatoria: v === true })}
                    />
                    Obrigatória
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={i === lista.length - 1}
                    onClick={() => setItens((ls) => ls && comChaves(juntarComProxima(ls, i)))}
                  >
                    Juntar com a próxima
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => separar(i, item.chave)}
                  >
                    Separar
                  </Button>
                </div>
              </li>
            ))}
          </ol>

          {confirmarSubstituir ? (
            <div
              role="alertdialog"
              aria-labelledby="imp-confirmar"
              className="flex flex-col gap-3 rounded-xl border border-destructive/40 p-3"
            >
              <p id="imp-confirmar" className="text-sm font-medium">
                Substituir as {totalAtual} perguntas atuais pelas {selecionadas} importadas? As
                anamneses já preenchidas não mudam.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => setConfirmarSubstituir(false)}>
                  Voltar
                </Button>
                <Button type="button" variant="destructive" onClick={() => concluir("substituir")}>
                  Sim, substituir
                </Button>
              </div>
            </div>
          ) : (
            <DialogFooter className="items-stretch sm:items-center">
              <span className="text-sm text-muted-foreground sm:mr-auto">
                {selecionadas} selecionada{selecionadas === 1 ? "" : "s"}
              </span>
              <Button
                type="button"
                variant="outline"
                disabled={selecionadas === 0}
                onClick={() => setConfirmarSubstituir(true)}
              >
                Substituir o modelo
              </Button>
              <Button
                type="button"
                disabled={selecionadas === 0}
                onClick={() => concluir("adicionar")}
              >
                Adicionar ao modelo
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
