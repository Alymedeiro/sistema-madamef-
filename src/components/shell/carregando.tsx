import { Skeleton } from "@/components/ui/skeleton";

/** Esqueleto de página (título + blocos) mostrado enquanto a rota carrega. */
export function CarregandoPagina({ blocos = 3 }: { blocos?: number }) {
  return (
    <div aria-busy="true" className="flex min-w-0 flex-col gap-6">
      <span className="sr-only" role="status">
        Carregando…
      </span>
      <Skeleton className="h-9 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: blocos }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
