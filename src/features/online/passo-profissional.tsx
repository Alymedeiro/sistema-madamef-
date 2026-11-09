"use client";

import { estiloOpcao } from "./passo-servico";
import type { ProfissionalOnline } from "./tipos";

/** `null` = "Qualquer uma" (o banco escolhe a primeira livre). */
export function PassoProfissional({
  profissionais,
  selecionada,
  aoEscolher,
}: {
  profissionais: ProfissionalOnline[];
  selecionada: string | null | undefined;
  aoEscolher: (id: string | null) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 font-titulo text-lg font-semibold text-ouro-escuro">
        2. Com quem?
      </legend>
      <button
        type="button"
        aria-pressed={selecionada === null}
        className={estiloOpcao(selecionada === null)}
        onClick={() => aoEscolher(null)}
      >
        Qualquer uma
      </button>
      {profissionais.map((p) => (
        <button
          key={p.id}
          type="button"
          aria-pressed={selecionada === p.id}
          className={estiloOpcao(selecionada === p.id)}
          onClick={() => aoEscolher(p.id)}
        >
          {p.nome}
        </button>
      ))}
    </fieldset>
  );
}
