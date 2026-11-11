import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O PDF do Financeiro lê o logo do disco; garante o arquivo no pacote da função.
  outputFileTracingIncludes: {
    "/financeiro/exportar": ["./public/brand/logo-madame-fe.png"],
  },
};

export default nextConfig;
