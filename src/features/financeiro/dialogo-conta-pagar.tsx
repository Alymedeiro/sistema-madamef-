"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { criarContaFixa, criarContaPagar, editarContaPagar } from "@/app/(app)/financeiro/actions";
import { CATEGORIAS_CONTA, ROTULO_CATEGORIA, type CategoriaDespesa } from "@/lib/dominio/financeiro";
import { centavosParaCampo } from "@/features/caixa/formato";
import { ACEITA_ANEXO, MENSAGEM_ANEXO_RECUSADO, enviarAnexo, extensaoDoAnexo } from "./anexo";
import { Campo, MensagemErro } from "./formulario";

export type ContaEditavel = {
  id: string;
  descricao: string;
  categoria: CategoriaDespesa;
  fornecedor: string | null;
  valorCentavos: number;
  vencimento: string;
  anexoPath: string | null;
};

/**
 * Montar só quando aberto (o estado do formulário nasce dos props).
 * nova: conta avulsa ou fixa · despesa: anexo obrigatório · editar: conta em aberto. */
export type ModoConta = "nova" | "despesa" | "editar";

const TITULO: Record<ModoConta, string> = {
  nova: "Nova conta a pagar",
  despesa: "Despesa com foto/PDF",
  editar: "Editar conta",
};

const DIAS = Array.from({ length: 31 }, (_, i) => i + 1);

type Valores = {
  descricao: string;
  categoria: string;
  fornecedor: string;
  valor: string;
  vencimento: string;
  repete: boolean;
  dia: number;
  removerAnexo: boolean;
};

function iniciais(conta: ContaEditavel | undefined, hoje: string): Valores {
  return {
    descricao: conta?.descricao ?? "",
    categoria: conta?.categoria ?? "",
    fornecedor: conta?.fornecedor ?? "",
    valor: conta ? centavosParaCampo(conta.valorCentavos) : "",
    vencimento: conta?.vencimento ?? hoje,
    repete: false,
    dia: Number(hoje.slice(8, 10)),
    removerAnexo: false,
  };
}

export function DialogoContaPagar({
  modo,
  onFechar,
  hoje,
  conta,
}: {
  modo: ModoConta;
  onFechar: () => void;
  hoje: string;
  conta?: ContaEditavel;
}) {
  const id = useId();
  const router = useRouter();
  const [v, setV] = useState<Valores>(() => iniciais(conta, hoje));
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const repete = modo === "nova" && v.repete;
  const mudar = <K extends keyof Valores>(k: K, valor: Valores[K]) => setV((x) => ({ ...x, [k]: valor }));

  function escolher(lista: FileList | null) {
    const a = lista?.[0] ?? null;
    if (a && !extensaoDoAnexo(a)) {
      setArquivo(null);
      setErro(MENSAGEM_ANEXO_RECUSADO);
      return;
    }
    setErro(null);
    setArquivo(a);
  }

  function salvar() {
    setErro(null);
    if (modo === "despesa" && !arquivo) {
      setErro("Escolha a foto ou o PDF da despesa.");
      return;
    }
    iniciar(async () => {
      const campos = {
        descricao: v.descricao,
        categoria: v.categoria as (typeof CATEGORIAS_CONTA)[number],
        fornecedor: v.fornecedor,
        valor: v.valor,
      };
      let r;
      if (repete) {
        r = await criarContaFixa({ ...campos, dia: v.dia, inicio: hoje });
      } else {
        let anexoPath: string | null = v.removerAnexo ? null : (conta?.anexoPath ?? null);
        if (arquivo) {
          try {
            anexoPath = await enviarAnexo(arquivo);
          } catch (e) {
            setErro(e instanceof Error ? e.message : MENSAGEM_ANEXO_RECUSADO);
            return;
          }
        }
        const dados = { ...campos, vencimento: v.vencimento, anexoPath };
        r = modo === "editar" && conta ? await editarContaPagar({ ...dados, contaId: conta.id }) : await criarContaPagar(dados);
      }
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      toast.success(repete ? "Conta fixa criada." : modo === "editar" ? "Conta atualizada." : "Conta lançada.");
      onFechar();
      router.refresh();
    });
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{TITULO[modo]}</DialogTitle>
          <DialogDescription>
            {modo === "despesa" ? "Anexe a foto do recibo ou o PDF da nota." : "Valores em reais, ex.: 1.234,56"}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <Campo id={`${id}-descricao`} rotulo="Descrição">
            <Input id={`${id}-descricao`} value={v.descricao} maxLength={120} required onChange={(e) => mudar("descricao", e.target.value)} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo id={`${id}-categoria`} rotulo="Categoria">
              <Select id={`${id}-categoria`} value={v.categoria} required onChange={(e) => mudar("categoria", e.target.value)}>
                <option value="" disabled>
                  Escolha
                </option>
                {CATEGORIAS_CONTA.map((c) => (
                  <option key={c} value={c}>
                    {ROTULO_CATEGORIA[c]}
                  </option>
                ))}
              </Select>
            </Campo>
            <Campo id={`${id}-valor`} rotulo="Valor (R$)">
              <Input id={`${id}-valor`} inputMode="decimal" placeholder="0,00" value={v.valor} required onChange={(e) => mudar("valor", e.target.value)} />
            </Campo>
          </div>
          <Campo id={`${id}-fornecedor`} rotulo="Fornecedor (opcional)">
            <Input id={`${id}-fornecedor`} value={v.fornecedor} maxLength={120} onChange={(e) => mudar("fornecedor", e.target.value)} />
          </Campo>

          {modo === "nova" && (
            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input type="checkbox" className="size-5" checked={v.repete} onChange={(e) => mudar("repete", e.target.checked)} />
              Repete todo mês
            </label>
          )}

          {repete ? (
            <Campo id={`${id}-dia`} rotulo="Vence todo mês no dia">
              <Select id={`${id}-dia`} value={String(v.dia)} onChange={(e) => mudar("dia", Number(e.target.value))}>
                {DIAS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </Campo>
          ) : (
            <>
              <Campo id={`${id}-vencimento`} rotulo="Vencimento">
                <Input id={`${id}-vencimento`} type="date" value={v.vencimento} required onChange={(e) => mudar("vencimento", e.target.value)} />
              </Campo>
              <Campo id={`${id}-anexo`} rotulo={modo === "despesa" ? "Foto ou PDF" : "Anexo (opcional)"}>
                <Input id={`${id}-anexo`} type="file" accept={ACEITA_ANEXO} onChange={(e) => escolher(e.target.files)} />
              </Campo>
              {modo === "editar" && conta?.anexoPath && !arquivo && (
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input type="checkbox" className="size-5" checked={v.removerAnexo} onChange={(e) => mudar("removerAnexo", e.target.checked)} />
                  Remover o anexo atual
                </label>
              )}
            </>
          )}

          <MensagemErro erro={erro} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onFechar} disabled={pendente}>
              Voltar
            </Button>
            <Button type="submit" disabled={pendente}>
              {pendente ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
