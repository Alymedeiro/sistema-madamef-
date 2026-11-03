// Tipos do banco no formato gerado por `supabase gen types typescript`.
// Escrito à mão (Ruling R2) a partir de supabase/migrations/ (0001–0004);
// cada migração nova atualiza este arquivo. Regenerar com o CLI quando houver
// um projeto Supabase real: `supabase gen types typescript --local`.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12"
  }
  public: {
    Tables: {
      agendamentos: {
        Row: {
          atualizado_em: string
          cliente_id: string
          criado_em: string
          criado_por: string | null
          fim: string
          google_event_id: string | null
          id: string
          inicio: string
          observacoes: string | null
          origem: Database["public"]["Enums"]["origem_agendamento"]
          pacote_vendido_id: string | null
          profissional_id: string
          servico_id: string
          status: Database["public"]["Enums"]["status_agendamento"]
          valor_previsto_centavos: number
        }
        Insert: {
          atualizado_em?: string
          cliente_id: string
          criado_em?: string
          criado_por?: string | null
          fim: string
          google_event_id?: string | null
          id?: string
          inicio: string
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["origem_agendamento"]
          pacote_vendido_id?: string | null
          profissional_id: string
          servico_id: string
          status?: Database["public"]["Enums"]["status_agendamento"]
          valor_previsto_centavos?: number
        }
        Update: {
          atualizado_em?: string
          cliente_id?: string
          criado_em?: string
          criado_por?: string | null
          fim?: string
          google_event_id?: string | null
          id?: string
          inicio?: string
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["origem_agendamento"]
          pacote_vendido_id?: string | null
          profissional_id?: string
          servico_id?: string
          status?: Database["public"]["Enums"]["status_agendamento"]
          valor_previsto_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "agendamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamentos_servico_id_fkey"
            columns: ["servico_id"]
            isOneToOne: false
            referencedRelation: "servicos"
            referencedColumns: ["id"]
          },
        ]
      }
      bloqueios_agenda: {
        Row: {
          atualizado_em: string
          colaborador_id: string
          criado_em: string
          fim: string
          id: string
          inicio: string
          motivo: string
        }
        Insert: {
          atualizado_em?: string
          colaborador_id: string
          criado_em?: string
          fim: string
          id?: string
          inicio: string
          motivo: string
        }
        Update: {
          atualizado_em?: string
          colaborador_id?: string
          criado_em?: string
          fim?: string
          id?: string
          inicio?: string
          motivo?: string
        }
        Relationships: [
          {
            foreignKeyName: "bloqueios_agenda_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      caixas: {
        Row: {
          aberto_em: string
          aberto_por: string
          atualizado_em: string
          criado_em: string
          data: string
          diferenca_centavos: number | null
          fechado_em: string | null
          fechado_por: string | null
          id: string
          valor_contado_centavos: number | null
          valor_inicial_centavos: number
        }
        // Sem escrita direta: use abrir_caixa / fechar_caixa (Insert/Update
        // ficam no formato gerado, mas o banco recusa com 42501).
        Insert: {
          aberto_em?: string
          aberto_por: string
          atualizado_em?: string
          criado_em?: string
          data: string
          diferenca_centavos?: number | null
          fechado_em?: string | null
          fechado_por?: string | null
          id?: string
          valor_contado_centavos?: number | null
          valor_inicial_centavos: number
        }
        Update: {
          aberto_em?: string
          aberto_por?: string
          atualizado_em?: string
          criado_em?: string
          data?: string
          diferenca_centavos?: number | null
          fechado_em?: string | null
          fechado_por?: string | null
          id?: string
          valor_contado_centavos?: number | null
          valor_inicial_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "caixas_aberto_por_fkey"
            columns: ["aberto_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "caixas_fechado_por_fkey"
            columns: ["fechado_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_servico: {
        Row: {
          atualizado_em: string
          criado_em: string
          id: string
          nome: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          id?: string
          nome: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          id?: string
          nome?: string
        }
        Relationships: [
        ]
      }
      clientes: {
        Row: {
          aceita_whatsapp_marketing: boolean
          aceite_lgpd_em: string
          ativo: boolean
          atualizado_em: string
          cpf: string | null
          criado_em: string
          data_nascimento: string | null
          email: string | null
          endereco: string | null
          id: string
          nome: string
          // Coluna gerada (0004): nome sem acento e em minúsculas, para busca.
          nome_busca: string | null
          observacoes: string | null
          origem: string | null
          whatsapp: string | null
        }
        Insert: {
          aceita_whatsapp_marketing?: boolean
          aceite_lgpd_em: string
          ativo?: boolean
          atualizado_em?: string
          cpf?: string | null
          criado_em?: string
          data_nascimento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          nome: string
          nome_busca?: never
          observacoes?: string | null
          origem?: string | null
          whatsapp?: string | null
        }
        Update: {
          aceita_whatsapp_marketing?: boolean
          aceite_lgpd_em?: string
          ativo?: boolean
          atualizado_em?: string
          cpf?: string | null
          criado_em?: string
          data_nascimento?: string | null
          email?: string | null
          endereco?: string | null
          id?: string
          nome?: string
          nome_busca?: never
          observacoes?: string | null
          origem?: string | null
          whatsapp?: string | null
        }
        Relationships: [
        ]
      }
      colaborador_servicos: {
        Row: {
          atualizado_em: string
          colaborador_id: string
          criado_em: string
          id: string
          servico_id: string
        }
        Insert: {
          atualizado_em?: string
          colaborador_id: string
          criado_em?: string
          id?: string
          servico_id: string
        }
        Update: {
          atualizado_em?: string
          colaborador_id?: string
          criado_em?: string
          id?: string
          servico_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "colaborador_servicos_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "colaborador_servicos_servico_id_fkey"
            columns: ["servico_id"]
            isOneToOne: false
            referencedRelation: "servicos"
            referencedColumns: ["id"]
          },
        ]
      }
      colaboradores: {
        Row: {
          ativo: boolean
          atualizado_em: string
          cor: string
          criado_em: string
          funcao: string | null
          id: string
          nome: string
          perfil: Database["public"]["Enums"]["perfil"]
          telefone: string | null
          usuario_auth_id: string | null
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          cor?: string
          criado_em?: string
          funcao?: string | null
          id?: string
          nome: string
          perfil: Database["public"]["Enums"]["perfil"]
          telefone?: string | null
          usuario_auth_id?: string | null
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          cor?: string
          criado_em?: string
          funcao?: string | null
          id?: string
          nome?: string
          perfil?: Database["public"]["Enums"]["perfil"]
          telefone?: string | null
          usuario_auth_id?: string | null
        }
        Relationships: [
        ]
      }
      configuracoes_clinica: {
        Row: {
          atualizado_em: string
          criado_em: string
          dias_cliente_sumida: number
          endereco: string | null
          horario_funcionamento: Json
          id: string
          linha_unica: boolean
          logo_url: string | null
          nome: string
          online_antecedencia_max_dias: number
          online_antecedencia_min_horas: number
          telefone: string | null
          whatsapp_janela_fim: string
          whatsapp_janela_inicio: string
          whatsapp_limite_por_hora: number
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          dias_cliente_sumida?: number
          endereco?: string | null
          horario_funcionamento?: Json
          id?: string
          linha_unica?: boolean
          logo_url?: string | null
          nome: string
          online_antecedencia_max_dias?: number
          online_antecedencia_min_horas?: number
          telefone?: string | null
          whatsapp_janela_fim?: string
          whatsapp_janela_inicio?: string
          whatsapp_limite_por_hora?: number
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          dias_cliente_sumida?: number
          endereco?: string | null
          horario_funcionamento?: Json
          id?: string
          linha_unica?: boolean
          logo_url?: string | null
          nome?: string
          online_antecedencia_max_dias?: number
          online_antecedencia_min_horas?: number
          telefone?: string | null
          whatsapp_janela_fim?: string
          whatsapp_janela_inicio?: string
          whatsapp_limite_por_hora?: number
        }
        Relationships: [
        ]
      }
      contas_receber: {
        Row: {
          atualizado_em: string
          cliente_id: string
          criado_em: string
          id: string
          numero: number
          pagamento_id: string
          recebido_em: string | null
          total_parcelas: number
          valor_centavos: number
          vencimento: string
        }
        // Sem escrita direta: criadas por registrar_pagamento ('a_receber').
        Insert: {
          atualizado_em?: string
          cliente_id: string
          criado_em?: string
          id?: string
          numero: number
          pagamento_id: string
          recebido_em?: string | null
          total_parcelas: number
          valor_centavos: number
          vencimento: string
        }
        Update: {
          atualizado_em?: string
          cliente_id?: string
          criado_em?: string
          id?: string
          numero?: number
          pagamento_id?: string
          recebido_em?: string | null
          total_parcelas?: number
          valor_centavos?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "contas_receber_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_pagamento_id_fkey"
            columns: ["pagamento_id"]
            isOneToOne: false
            referencedRelation: "pagamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      jornadas: {
        Row: {
          atualizado_em: string
          colaborador_id: string
          criado_em: string
          dia_semana: number
          hora_fim: string
          hora_inicio: string
          id: string
        }
        Insert: {
          atualizado_em?: string
          colaborador_id: string
          criado_em?: string
          dia_semana: number
          hora_fim: string
          hora_inicio: string
          id?: string
        }
        Update: {
          atualizado_em?: string
          colaborador_id?: string
          criado_em?: string
          dia_semana?: number
          hora_fim?: string
          hora_inicio?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jornadas_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos: {
        Row: {
          agendamento_id: string | null
          atualizado_em: string
          caixa_id: string
          cliente_id: string
          criado_em: string
          desconto_centavos: number
          forma: Database["public"]["Enums"]["forma_pagamento"]
          id: string
          lancado_por: string
          origem: Database["public"]["Enums"]["origem_pagamento"]
          parcelas: number
          valor_centavos: number
        }
        // Sem escrita direta: use registrar_pagamento.
        Insert: {
          agendamento_id?: string | null
          atualizado_em?: string
          caixa_id: string
          cliente_id: string
          criado_em?: string
          desconto_centavos?: number
          forma: Database["public"]["Enums"]["forma_pagamento"]
          id?: string
          lancado_por: string
          origem: Database["public"]["Enums"]["origem_pagamento"]
          parcelas?: number
          valor_centavos: number
        }
        Update: {
          agendamento_id?: string | null
          atualizado_em?: string
          caixa_id?: string
          cliente_id?: string
          criado_em?: string
          desconto_centavos?: number
          forma?: Database["public"]["Enums"]["forma_pagamento"]
          id?: string
          lancado_por?: string
          origem?: Database["public"]["Enums"]["origem_pagamento"]
          parcelas?: number
          valor_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_agendamento_id_fkey"
            columns: ["agendamento_id"]
            isOneToOne: false
            referencedRelation: "agendamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_lancado_por_fkey"
            columns: ["lancado_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          estoque_atual: number
          estoque_minimo: number
          id: string
          nome: string
          preco_venda_centavos: number | null
          unidade: string
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          estoque_atual?: number
          estoque_minimo?: number
          id?: string
          nome: string
          preco_venda_centavos?: number | null
          unidade?: string
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          estoque_atual?: number
          estoque_minimo?: number
          id?: string
          nome?: string
          preco_venda_centavos?: number | null
          unidade?: string
        }
        Relationships: [
        ]
      }
      produtos_custos: {
        Row: {
          atualizado_em: string
          criado_em: string
          custo_unitario_centavos: number
          produto_id: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          custo_unitario_centavos?: number
          produto_id: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          custo_unitario_centavos?: number
          produto_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_custos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: true
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      servico_produtos: {
        Row: {
          atualizado_em: string
          criado_em: string
          id: string
          produto_id: string
          quantidade: number
          servico_id: string
        }
        Insert: {
          atualizado_em?: string
          criado_em?: string
          id?: string
          produto_id: string
          quantidade: number
          servico_id: string
        }
        Update: {
          atualizado_em?: string
          criado_em?: string
          id?: string
          produto_id?: string
          quantidade?: number
          servico_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "servico_produtos_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "servico_produtos_servico_id_fkey"
            columns: ["servico_id"]
            isOneToOne: false
            referencedRelation: "servicos"
            referencedColumns: ["id"]
          },
        ]
      }
      servicos: {
        Row: {
          ativo: boolean
          atualizado_em: string
          categoria_id: string
          criado_em: string
          descricao: string | null
          dias_retorno: number | null
          duracao_min: number
          exige_avaliacao: boolean
          id: string
          modelo_termo_id: string | null
          nome: string
          permite_online: boolean
          preco_centavos: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          categoria_id: string
          criado_em?: string
          descricao?: string | null
          dias_retorno?: number | null
          duracao_min: number
          exige_avaliacao?: boolean
          id?: string
          modelo_termo_id?: string | null
          nome: string
          permite_online?: boolean
          preco_centavos?: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          categoria_id?: string
          criado_em?: string
          descricao?: string | null
          dias_retorno?: number | null
          duracao_min?: number
          exige_avaliacao?: boolean
          id?: string
          modelo_termo_id?: string | null
          nome?: string
          permite_online?: boolean
          preco_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "servicos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_servico"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      abrir_caixa: { Args: { p_valor_inicial_centavos: number }; Returns: string }
      agendamentos_sem_pagamento: { Args: { p_data: string }; Returns: string[] }
      caixa_aberto_hoje_id: { Args: never; Returns: string | null }
      // Sem caixa visível o PostgREST pode devolver null ou um objeto com todos
      // os campos nulos (função não-SETOF de tipo composto): teste `id`.
      caixa_de_hoje: {
        Args: never
        Returns:
          | Database["public"]["Tables"]["caixas"]["Row"]
          | { [K in keyof Database["public"]["Tables"]["caixas"]["Row"]]: null }
          | null
        SetofOptions: {
          from: "*"
          to: "caixas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cliente_vinculada: { Args: { p_cliente: string }; Returns: boolean }
      colaborador_atual_id: { Args: never; Returns: string }
      // Retorna { total_por_forma: Record<forma_pagamento, number>,
      //           total_geral, dinheiro_esperado, diferenca } (centavos).
      fechar_caixa: {
        Args: { p_caixa: string; p_valor_contado_centavos: number }
        Returns: Json
      }
      normalizar_busca: { Args: { texto: string }; Returns: string }
      perfil_atual: {
        Args: never
        Returns: Database["public"]["Enums"]["perfil"]
      }
      registrar_pagamento: {
        Args: {
          p_agendamento: string | null
          p_cliente: string
          p_desconto_centavos: number
          p_forma: Database["public"]["Enums"]["forma_pagamento"]
          p_parcelas: number
          p_valor_centavos: number
          // Só para 'a_receber' (um item por parcela); ignorados nas demais.
          p_valores_parcelas: number[] | null
          p_vencimentos: string[] | null
        }
        Returns: string
      }
    }
    Enums: {
      forma_pagamento:
        | "pix"
        | "dinheiro"
        | "debito"
        | "credito"
        | "credito_parcelado"
        | "a_receber"
      origem_agendamento: "interno" | "online"
      origem_pagamento: "agendamento" | "pacote" | "venda_produto"
      perfil: "dona" | "recepcao" | "profissional"
      status_agendamento:
        | "pendente"
        | "confirmado"
        | "atendido"
        | "faltou"
        | "cancelado"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      forma_pagamento: [
        "pix",
        "dinheiro",
        "debito",
        "credito",
        "credito_parcelado",
        "a_receber",
      ],
      origem_agendamento: ["interno", "online"],
      origem_pagamento: ["agendamento", "pacote", "venda_produto"],
      perfil: ["dona", "recepcao", "profissional"],
      status_agendamento: [
        "pendente",
        "confirmado",
        "atendido",
        "faltou",
        "cancelado",
      ],
    },
  },
} as const
