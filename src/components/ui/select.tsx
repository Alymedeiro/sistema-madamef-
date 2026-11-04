import * as React from "react";
import { ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";

/** Select nativo estilizado: abre o seletor do próprio aparelho (melhor no celular). */
function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          "flex min-h-11 w-full appearance-none rounded-md border border-input bg-card py-1 pr-9 pl-3 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive md:text-sm",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
    </div>
  );
}

export { Select };
