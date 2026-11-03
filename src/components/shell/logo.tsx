import Image from "next/image";
import { cn } from "@/lib/utils";

const TAMANHOS = {
  sm: "w-12",
  md: "w-24",
  lg: "w-48 sm:w-60",
} as const;

export type LogoProps = {
  tamanho?: keyof typeof TAMANHOS;
  className?: string;
};

export function Logo({ tamanho = "md", className }: LogoProps) {
  return (
    <Image
      src="/brand/logo-madame-fe.png"
      alt="Madame Fê Clinic"
      width={732}
      height={730}
      priority={tamanho === "lg"}
      className={cn("h-auto", TAMANHOS[tamanho], className)}
    />
  );
}
