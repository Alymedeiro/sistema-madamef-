import Image from "next/image";
import { cn } from "@/lib/utils";

const TAMANHOS = {
  sm: "w-12",
  md: "w-24",
  lg: "w-48 sm:w-60",
} as const;

// Largura renderizada de cada tamanho (px), para o navegador escolher o arquivo.
const SIZES = {
  sm: "48px",
  md: "96px",
  lg: "(min-width: 640px) 240px, 192px",
} as const;

export type LogoProps = {
  tamanho?: keyof typeof TAMANHOS;
  className?: string;
  /** Texto alternativo. Use `alt=""` quando houver um título visível igual ao lado. */
  alt?: string;
};

export function Logo({
  tamanho = "md",
  className,
  alt = "Madame Fê Clinic",
}: LogoProps) {
  return (
    <Image
      src="/brand/logo-madame-fe.png"
      alt={alt}
      sizes={SIZES[tamanho]}
      width={732}
      height={730}
      priority={tamanho === "lg"}
      className={cn("h-auto", TAMANHOS[tamanho], className)}
    />
  );
}
