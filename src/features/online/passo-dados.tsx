"use client";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type Dados = { nome: string; whatsapp: string; aceite: boolean };

export function PassoDados({
  dados,
  avisoPrivacidade,
  aoMudar,
}: {
  dados: Dados;
  avisoPrivacidade: string;
  aoMudar: (d: Dados) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-3 font-titulo text-lg font-semibold text-ouro-escuro">
        4. Seus dados
      </legend>
      <div className="flex flex-col gap-2">
        <Label htmlFor="agendar-nome">Nome</Label>
        <Input
          id="agendar-nome"
          autoComplete="name"
          maxLength={80}
          value={dados.nome}
          onChange={(e) => aoMudar({ ...dados, nome: e.target.value })}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="agendar-whatsapp">WhatsApp com DDD</Label>
        <Input
          id="agendar-whatsapp"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(11) 98765-4321"
          value={dados.whatsapp}
          onChange={(e) => aoMudar({ ...dados, whatsapp: e.target.value })}
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-2">
        <Label htmlFor="agendar-aceite" className="min-h-11 cursor-pointer">
          <Checkbox
            id="agendar-aceite"
            checked={dados.aceite}
            onCheckedChange={(v) => aoMudar({ ...dados, aceite: v === true })}
          />
          Li e aceito o aviso de privacidade
        </Label>
        <Dialog>
          <DialogTrigger asChild>
            <Button type="button" variant="link" className="px-1">
              Ler o aviso
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Aviso de privacidade</DialogTitle>
            <DialogDescription className="whitespace-pre-line text-foreground">
              {avisoPrivacidade}
            </DialogDescription>
          </DialogContent>
        </Dialog>
      </div>
    </fieldset>
  );
}
