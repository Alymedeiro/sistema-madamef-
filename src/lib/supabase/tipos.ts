// Tipos do banco no formato gerado por `supabase gen types typescript`.
// Escrito à mão (Ruling R2) a partir de supabase/migrations/ (0001–0010);
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
            foreignKeyName: "agendamentos_pacote_vendido_id_fkey"
            columns: ["pacote_vendido_id"]
            isOneToOne: false
            referencedRelation: "pacotes_vendidos"
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
      anamneses: {
        Row: {
          assinatura_path: string
          atualizado_em: string
          cliente_id: string
          criado_em: string
          id: string
          modelo_id: string
          modelo_versao: number
          preenchida_em: string
          preenchida_por: string
          respostas: Json
        }
        Insert: {
          assinatura_path: string
          atualizado_em?: string
          cliente_id: string
          criado_em?: string
          id?: string
          modelo_id: string
          modelo_versao: number
          preenchida_em?: string
          preenchida_por?: string
          respostas: Json
        }
        Update: {
          assinatura_path?: string
          atualizado_em?: string
          cliente_id?: string
          criado_em?: string
          id?: string
          modelo_id?: string
          modelo_versao?: number
          preenchida_em?: string
          preenchida_por?: string
          respostas?: Json
        }
        Relationships: [
          {
            foreignKeyName: "anamneses_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anamneses_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "modelos_anamnese"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "anamneses_preenchida_por_fkey"
            columns: ["preenchida_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      auditoria: {
        Row: {
          acao: Database["public"]["Enums"]["acao_auditoria"]
          atualizado_em: string
          cliente_id: string | null
          colaborador_id: string | null
          criado_em: string
          entidade: string
          entidade_id: string | null
          id: string
          ocorrido_em: string
        }
        Insert: {
          acao: Database["public"]["Enums"]["acao_auditoria"]
          atualizado_em?: string
          cliente_id?: string | null
          colaborador_id?: string | null
          criado_em?: string
          entidade: string
          entidade_id?: string | null
          id?: string
          ocorrido_em?: string
        }
        Update: {
          acao?: Database["public"]["Enums"]["acao_auditoria"]
          atualizado_em?: string
          cliente_id?: string | null
          colaborador_id?: string | null
          criado_em?: string
          entidade?: string
          entidade_id?: string | null
          id?: string
          ocorrido_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "auditoria_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auditoria_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      // 0010: avisos de vencimento lidos (o aviso é calculado na leitura).
      // Chave 1–120. Dona lê só os próprios; escrita só por marcar_avisos_lidos.
      avisos_lidos: {
        Row: {
          chave: string
          colaborador_id: string
          lido_em: string
        }
        Insert: {
          chave: string
          colaborador_id: string
          lido_em?: string
        }
        Update: {
          chave?: string
          colaborador_id?: string
          lido_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "avisos_lidos_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
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
      cobrancas: {
        Row: {
          agendamento_id: string | null
          caixa_id: string
          cliente_id: string
          desconto_centavos: number
          id: string
          lancada_em: string
          lancada_por: string
          origem: Database["public"]["Enums"]["origem_pagamento"]
          pacote_vendido_id: string | null
          valor_bruto_centavos: number
        }
        // Sem escrita direta: use registrar_cobranca / vender_pacote / registrar_pagamento.
        Insert: {
          agendamento_id?: string | null
          caixa_id: string
          cliente_id: string
          desconto_centavos?: number
          id?: string
          lancada_em?: string
          lancada_por: string
          origem: Database["public"]["Enums"]["origem_pagamento"]
          pacote_vendido_id?: string | null
          valor_bruto_centavos: number
        }
        Update: {
          agendamento_id?: string | null
          caixa_id?: string
          cliente_id?: string
          desconto_centavos?: number
          id?: string
          lancada_em?: string
          lancada_por?: string
          origem?: Database["public"]["Enums"]["origem_pagamento"]
          pacote_vendido_id?: string | null
          valor_bruto_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "cobrancas_agendamento_id_fkey"
            columns: ["agendamento_id"]
            isOneToOne: true
            referencedRelation: "agendamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_lancada_por_fkey"
            columns: ["lancada_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cobrancas_pacote_vendido_id_fkey"
            columns: ["pacote_vendido_id"]
            isOneToOne: true
            referencedRelation: "pacotes_vendidos"
            referencedColumns: ["id"]
          },
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
          online_ativo: boolean
          online_aviso_privacidade: string
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
          online_ativo?: boolean
          online_aviso_privacidade?: string
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
          online_ativo?: boolean
          online_aviso_privacidade?: string
          telefone?: string | null
          whatsapp_janela_fim?: string
          whatsapp_janela_inicio?: string
          whatsapp_limite_por_hora?: number
        }
        Relationships: [
        ]
      }
      // 0010: só a dona lê; sem escrita direta (criar_conta_fixa /
      // desativar_conta_fixa). inicio = 1º dia do mês; categoria nunca 'vale'.
      contas_fixas: {
        Row: {
          ativa: boolean
          atualizado_em: string
          categoria: Database["public"]["Enums"]["categoria_despesa"]
          criado_em: string
          criado_por: string
          descricao: string
          dia_vencimento: number
          fornecedor: string | null
          id: string
          inicio: string
          valor_centavos: number
        }
        Insert: {
          ativa?: boolean
          atualizado_em?: string
          categoria: Database["public"]["Enums"]["categoria_despesa"]
          criado_em?: string
          criado_por: string
          descricao: string
          dia_vencimento: number
          fornecedor?: string | null
          id?: string
          inicio: string
          valor_centavos: number
        }
        Update: {
          ativa?: boolean
          atualizado_em?: string
          categoria?: Database["public"]["Enums"]["categoria_despesa"]
          criado_em?: string
          criado_por?: string
          descricao?: string
          dia_vencimento?: number
          fornecedor?: string | null
          id?: string
          inicio?: string
          valor_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "contas_fixas_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      // 0010: só a dona lê; sem escrita direta (criar_conta_pagar /
      // editar_conta_pagar / pagar_conta / cancelar_conta_pagar / lancar_vale /
      // gerar_contas_fixas). Paga ⇔ pago_em e forma; cancelada ⇔ campos de
      // cancelamento; vale ⇔ colaborador_id. anexo_path no bucket `financeiro`.
      contas_pagar: {
        Row: {
          anexo_path: string | null
          atualizado_em: string
          cancelada_em: string | null
          cancelada_motivo: string | null
          cancelada_por: string | null
          categoria: Database["public"]["Enums"]["categoria_despesa"]
          colaborador_id: string | null
          competencia: string | null
          conta_fixa_id: string | null
          criado_em: string
          descricao: string
          // Nunca 'a_receber'.
          forma: Database["public"]["Enums"]["forma_pagamento"] | null
          fornecedor: string | null
          id: string
          lancada_por: string
          pago_em: string | null
          status: Database["public"]["Enums"]["status_conta"]
          valor_centavos: number
          vencimento: string
        }
        Insert: {
          anexo_path?: string | null
          atualizado_em?: string
          cancelada_em?: string | null
          cancelada_motivo?: string | null
          cancelada_por?: string | null
          categoria: Database["public"]["Enums"]["categoria_despesa"]
          colaborador_id?: string | null
          competencia?: string | null
          conta_fixa_id?: string | null
          criado_em?: string
          descricao: string
          forma?: Database["public"]["Enums"]["forma_pagamento"] | null
          fornecedor?: string | null
          id?: string
          lancada_por: string
          pago_em?: string | null
          status?: Database["public"]["Enums"]["status_conta"]
          valor_centavos: number
          vencimento: string
        }
        Update: {
          anexo_path?: string | null
          atualizado_em?: string
          cancelada_em?: string | null
          cancelada_motivo?: string | null
          cancelada_por?: string | null
          categoria?: Database["public"]["Enums"]["categoria_despesa"]
          colaborador_id?: string | null
          competencia?: string | null
          conta_fixa_id?: string | null
          criado_em?: string
          descricao?: string
          forma?: Database["public"]["Enums"]["forma_pagamento"] | null
          fornecedor?: string | null
          id?: string
          lancada_por?: string
          pago_em?: string | null
          status?: Database["public"]["Enums"]["status_conta"]
          valor_centavos?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "contas_pagar_cancelada_por_fkey"
            columns: ["cancelada_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_conta_fixa_id_fkey"
            columns: ["conta_fixa_id"]
            isOneToOne: false
            referencedRelation: "contas_fixas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_pagar_lancada_por_fkey"
            columns: ["lancada_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      // 0003 + 0010. Sem escrita direta: parcelas de registrar_pagamento /
      // registrar_cobranca ('a_receber'; origem_manual false) ou manuais da dona
      // (criar_conta_receber: origem_manual, pagamento_id null, descricao, 1/1).
      // Baixa por receber_parcela (recebido_em); cancelar_conta_receber.
      // Recepção lê só as em aberto com vencimento <= hoje e as recebidas no
      // caixa de hoje aberto.
      contas_receber: {
        Row: {
          atualizado_em: string
          cancelada_em: string | null
          cancelada_motivo: string | null
          cancelada_por: string | null
          cliente_id: string
          criado_em: string
          descricao: string | null
          id: string
          lancada_por: string | null
          numero: number
          origem_manual: boolean
          pagamento_id: string | null
          recebido_em: string | null
          total_parcelas: number
          valor_centavos: number
          vencimento: string
        }
        Insert: {
          atualizado_em?: string
          cancelada_em?: string | null
          cancelada_motivo?: string | null
          cancelada_por?: string | null
          cliente_id: string
          criado_em?: string
          descricao?: string | null
          id?: string
          lancada_por?: string | null
          numero: number
          origem_manual?: boolean
          pagamento_id?: string | null
          recebido_em?: string | null
          total_parcelas: number
          valor_centavos: number
          vencimento: string
        }
        Update: {
          atualizado_em?: string
          cancelada_em?: string | null
          cancelada_motivo?: string | null
          cancelada_por?: string | null
          cliente_id?: string
          criado_em?: string
          descricao?: string | null
          id?: string
          lancada_por?: string | null
          numero?: number
          origem_manual?: boolean
          pagamento_id?: string | null
          recebido_em?: string | null
          total_parcelas?: number
          valor_centavos?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "contas_receber_cancelada_por_fkey"
            columns: ["cancelada_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contas_receber_lancada_por_fkey"
            columns: ["lancada_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
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
      evolucoes: {
        Row: {
          agendamento_id: string
          atualizado_em: string
          cliente_id: string
          criado_em: string
          id: string
          profissional_id: string
          texto: string
        }
        Insert: {
          agendamento_id: string
          atualizado_em?: string
          cliente_id: string
          criado_em?: string
          id?: string
          profissional_id?: string
          texto: string
        }
        Update: {
          agendamento_id?: string
          atualizado_em?: string
          cliente_id?: string
          criado_em?: string
          id?: string
          profissional_id?: string
          texto?: string
        }
        Relationships: [
          {
            foreignKeyName: "evolucoes_agendamento_id_fkey"
            columns: ["agendamento_id"]
            isOneToOne: false
            referencedRelation: "agendamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolucoes_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "evolucoes_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      fotos: {
        Row: {
          agendamento_id: string | null
          arquivada: boolean
          atualizado_em: string
          cliente_id: string
          criado_em: string
          enviada_por: string
          id: string
          path: string
          servico_id: string | null
          tipo: Database["public"]["Enums"]["tipo_foto"]
          tirada_em: string
        }
        Insert: {
          agendamento_id?: string | null
          arquivada?: boolean
          atualizado_em?: string
          cliente_id: string
          criado_em?: string
          enviada_por?: string
          id?: string
          path: string
          servico_id?: string | null
          tipo: Database["public"]["Enums"]["tipo_foto"]
          tirada_em?: string
        }
        Update: {
          agendamento_id?: string | null
          arquivada?: boolean
          atualizado_em?: string
          cliente_id?: string
          criado_em?: string
          enviada_por?: string
          id?: string
          path?: string
          servico_id?: string | null
          tipo?: Database["public"]["Enums"]["tipo_foto"]
          tirada_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "fotos_agendamento_id_fkey"
            columns: ["agendamento_id"]
            isOneToOne: false
            referencedRelation: "agendamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fotos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fotos_enviada_por_fkey"
            columns: ["enviada_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fotos_servico_id_fkey"
            columns: ["servico_id"]
            isOneToOne: false
            referencedRelation: "servicos"
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
      modelos_anamnese: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          criado_por: string | null
          id: string
          perguntas: Json
          titulo: string
          versao: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          perguntas: Json
          titulo: string
          versao: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          id?: string
          perguntas?: Json
          titulo?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "modelos_anamnese_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      modelos_termo: {
        Row: {
          ativo: boolean
          atualizado_em: string
          criado_em: string
          criado_por: string | null
          grupo_id: string
          id: string
          texto: string
          titulo: string
          versao: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          grupo_id?: string
          id?: string
          texto: string
          titulo: string
          versao: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          criado_em?: string
          criado_por?: string | null
          grupo_id?: string
          id?: string
          texto?: string
          titulo?: string
          versao?: number
        }
        Relationships: [
          {
            foreignKeyName: "modelos_termo_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      pacotes_vendidos: {
        Row: {
          atualizado_em: string
          cancelado_em: string | null
          cancelado_por: string | null
          cliente_id: string
          id: string
          servico_id: string
          sessoes_usadas: number
          status: Database["public"]["Enums"]["status_pacote"]
          total_sessoes: number
          validade: string | null
          valor_total_centavos: number
          vendido_em: string
          vendido_por: string | null
        }
        // Sem escrita direta: use vender_pacote / cancelar_pacote / expirar_pacotes; sessões pelo status do agendamento.
        Insert: {
          atualizado_em?: string
          cancelado_em?: string | null
          cancelado_por?: string | null
          cliente_id: string
          id?: string
          servico_id: string
          sessoes_usadas?: number
          status?: Database["public"]["Enums"]["status_pacote"]
          total_sessoes: number
          validade?: string | null
          valor_total_centavos: number
          vendido_em?: string
          vendido_por?: string | null
        }
        Update: {
          atualizado_em?: string
          cancelado_em?: string | null
          cancelado_por?: string | null
          cliente_id?: string
          id?: string
          servico_id?: string
          sessoes_usadas?: number
          status?: Database["public"]["Enums"]["status_pacote"]
          total_sessoes?: number
          validade?: string | null
          valor_total_centavos?: number
          vendido_em?: string
          vendido_por?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pacotes_vendidos_cancelado_por_fkey"
            columns: ["cancelado_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pacotes_vendidos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pacotes_vendidos_servico_id_fkey"
            columns: ["servico_id"]
            isOneToOne: false
            referencedRelation: "servicos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pacotes_vendidos_vendido_por_fkey"
            columns: ["vendido_por"]
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
          cobranca_id: string
          criado_em: string
          desconto_centavos: number
          forma: Database["public"]["Enums"]["forma_pagamento"]
          id: string
          lancado_por: string
          origem: Database["public"]["Enums"]["origem_pagamento"]
          parcelas: number
          valor_centavos: number
        }
        // Sem escrita direta: use registrar_pagamento / registrar_cobranca.
        // 0007: uma linha por parte da cobrança (desconto na cobrança).
        Insert: {
          agendamento_id?: string | null
          atualizado_em?: string
          caixa_id: string
          cliente_id: string
          cobranca_id: string
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
          cobranca_id?: string
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
            foreignKeyName: "pagamentos_cobranca_id_fkey"
            columns: ["cobranca_id"]
            isOneToOne: false
            referencedRelation: "cobrancas"
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
      // 0009: anon sem acesso; dona e recepção leem; profissional usa
      // pedidos_online_da_agenda (sem whatsapp). nome/whatsapp nulos após a
      // limpeza LGPD (dados_apagados_em).
      pedidos_online: {
        Row: {
          aceite_privacidade_em: string
          agendamento_id: string | null
          atualizado_em: string
          avaliacao: boolean
          criado_em: string
          dados_apagados_em: string | null
          decidido_em: string | null
          decidido_por: string | null
          fim: string
          id: string
          inicio: string
          // Zerado depois de 1 dia (apagar_dados_pedidos_antigos).
          ip_hash: string | null
          motivo_recusa: string | null
          nome: string | null
          profissional_escolhida_id: string | null
          profissional_id: string
          servico_id: string
          status: Database["public"]["Enums"]["status_pedido_online"]
          whatsapp: string | null
        }
        // Sem escrita direta: use criar_pedido_online / aprovar_pedido_online /
        // recusar_pedido_online / expirar_pedidos_online.
        Insert: {
          aceite_privacidade_em: string
          agendamento_id?: string | null
          atualizado_em?: string
          avaliacao?: boolean
          criado_em?: string
          dados_apagados_em?: string | null
          decidido_em?: string | null
          decidido_por?: string | null
          fim: string
          id?: string
          inicio: string
          ip_hash?: string | null
          motivo_recusa?: string | null
          nome?: string | null
          profissional_escolhida_id?: string | null
          profissional_id: string
          servico_id: string
          status?: Database["public"]["Enums"]["status_pedido_online"]
          whatsapp?: string | null
        }
        Update: {
          aceite_privacidade_em?: string
          agendamento_id?: string | null
          atualizado_em?: string
          avaliacao?: boolean
          criado_em?: string
          dados_apagados_em?: string | null
          decidido_em?: string | null
          decidido_por?: string | null
          fim?: string
          id?: string
          inicio?: string
          ip_hash?: string | null
          motivo_recusa?: string | null
          nome?: string | null
          profissional_escolhida_id?: string | null
          profissional_id?: string
          servico_id?: string
          status?: Database["public"]["Enums"]["status_pedido_online"]
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_online_agendamento_id_fkey"
            columns: ["agendamento_id"]
            isOneToOne: true
            referencedRelation: "agendamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_online_decidido_por_fkey"
            columns: ["decidido_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_online_profissional_escolhida_id_fkey"
            columns: ["profissional_escolhida_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_online_profissional_id_fkey"
            columns: ["profissional_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_online_servico_id_fkey"
            columns: ["servico_id"]
            isOneToOne: false
            referencedRelation: "servicos"
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
      // 0010: uma baixa por parcela (conta_receber_id unique), no caixa de hoje
      // aberto; forma nunca 'a_receber'. Sem escrita direta (receber_parcela).
      // Dona lê todos; recepção só os do caixa de hoje aberto.
      recebimentos: {
        Row: {
          caixa_id: string
          conta_receber_id: string
          forma: Database["public"]["Enums"]["forma_pagamento"]
          id: string
          recebido_em: string
          recebido_por: string
          valor_centavos: number
        }
        Insert: {
          caixa_id: string
          conta_receber_id: string
          forma: Database["public"]["Enums"]["forma_pagamento"]
          id?: string
          recebido_em?: string
          recebido_por: string
          valor_centavos: number
        }
        Update: {
          caixa_id?: string
          conta_receber_id?: string
          forma?: Database["public"]["Enums"]["forma_pagamento"]
          id?: string
          recebido_em?: string
          recebido_por?: string
          valor_centavos?: number
        }
        Relationships: [
          {
            foreignKeyName: "recebimentos_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimentos_conta_receber_id_fkey"
            columns: ["conta_receber_id"]
            isOneToOne: true
            referencedRelation: "contas_receber"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recebimentos_recebido_por_fkey"
            columns: ["recebido_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
        ]
      }
      // 0010: PDFs exportados (aba 1–40, de <= ate). Só a dona lê; escrita só
      // por registrar_relatorio.
      relatorios_gerados: {
        Row: {
          aba: string
          ate: string
          colaborador_id: string
          de: string
          gerado_em: string
          id: string
        }
        Insert: {
          aba: string
          ate: string
          colaborador_id: string
          de: string
          gerado_em?: string
          id?: string
        }
        Update: {
          aba?: string
          ate?: string
          colaborador_id?: string
          de?: string
          gerado_em?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "relatorios_gerados_colaborador_id_fkey"
            columns: ["colaborador_id"]
            isOneToOne: false
            referencedRelation: "colaboradores"
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
          {
            foreignKeyName: "servicos_modelo_termo_id_fkey"
            columns: ["modelo_termo_id"]
            isOneToOne: false
            referencedRelation: "modelos_termo"
            referencedColumns: ["id"]
          },
        ]
      }
      termos_assinados: {
        Row: {
          agendamento_id: string | null
          assinado_em: string
          assinatura_path: string
          atualizado_em: string
          cliente_id: string
          colhido_por: string
          criado_em: string
          dispositivo: string | null
          hash_sha256: string
          id: string
          modelo_termo_id: string
          modelo_versao: number
          pdf_path: string
        }
        Insert: {
          agendamento_id?: string | null
          assinado_em?: string
          assinatura_path: string
          atualizado_em?: string
          cliente_id: string
          colhido_por?: string
          criado_em?: string
          dispositivo?: string | null
          hash_sha256: string
          id?: string
          modelo_termo_id: string
          modelo_versao: number
          pdf_path: string
        }
        Update: {
          agendamento_id?: string | null
          assinado_em?: string
          assinatura_path?: string
          atualizado_em?: string
          cliente_id?: string
          colhido_por?: string
          criado_em?: string
          dispositivo?: string | null
          hash_sha256?: string
          id?: string
          modelo_termo_id?: string
          modelo_versao?: number
          pdf_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "termos_assinados_agendamento_id_fkey"
            columns: ["agendamento_id"]
            isOneToOne: false
            referencedRelation: "agendamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termos_assinados_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termos_assinados_colhido_por_fkey"
            columns: ["colhido_por"]
            isOneToOne: false
            referencedRelation: "colaboradores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "termos_assinados_modelo_termo_id_fkey"
            columns: ["modelo_termo_id"]
            isOneToOne: false
            referencedRelation: "modelos_termo"
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
      // 0006: áreas 'anamneses' | 'termos' | 'evolucoes' | 'pacotes' | 'fotos'.
      acesso_clinico: { Args: { p_cliente: string; p_area: string }; Returns: boolean }
      // 0006: atendimentos (entre os ids) com termo pendente na versão atual.
      agendamentos_com_termo_pendente: { Args: { p_ids: string[] }; Returns: string[] }
      agendamentos_sem_pagamento: { Args: { p_data: string }; Returns: string[] }
      // 0005: dias de São Paulo, inclusive; no máximo 62 dias.
      agendamentos_sem_pagamento_periodo: {
        Args: { p_de: string; p_ate: string }
        Returns: string[]
      }
      // 0005: clientes ativas com aniversário no período (RLS de clientes).
      aniversariantes_entre: {
        Args: { p_de: string; p_ate: string }
        Returns: {
          id: string
          nome: string
          data_nascimento: string
          whatsapp: string | null
          dias: number
        }[]
      }
      aniversario_no_ano: { Args: { p_nascimento: string; p_ano: number }; Returns: string }
      area_do_caminho: { Args: { p_nome: string }; Returns: string | null }
      // 0008: o objeto existe no bucket ficha-clinica (usada pelas políticas de insert).
      arquivo_ficha_existe: { Args: { p_nome: string }; Returns: boolean }
      // 0006: só a dona (demais: vazio); dias de São Paulo, no máximo 62 dias.
      atendimentos_sem_termo: { Args: { p_de: string; p_ate: string }; Returns: string[] }
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
      // 0010: as funções do financeiro são só da dona (senão P0001 "Apenas a
      // dona pode lançar contas."). Conta paga → "Esta conta já foi paga.";
      // cancelada → "Esta conta foi cancelada."; anexo fora do padrão → 23514;
      // anexo não enviado → P0001 "Anexo não encontrado. Envie o arquivo de novo."
      cancelar_conta_pagar: { Args: { p_conta: string; p_motivo: string }; Returns: undefined }
      criar_conta_fixa: {
        Args: {
          p_descricao: string
          p_categoria: Database["public"]["Enums"]["categoria_despesa"]
          p_fornecedor: string | null
          p_valor_centavos: number
          p_dia: number
          // Levado ao 1º dia do mês.
          p_inicio: string
        }
        Returns: string
      }
      criar_conta_pagar: {
        Args: {
          p_descricao: string
          p_categoria: Database["public"]["Enums"]["categoria_despesa"]
          p_fornecedor: string | null
          p_valor_centavos: number
          p_vencimento: string
          p_anexo_path: string | null
        }
        Returns: string
      }
      desativar_conta_fixa: { Args: { p_id: string }; Returns: undefined }
      // 0010: só conta em aberto; p_anexo_path null remove o anexo.
      editar_conta_pagar: {
        Args: {
          p_conta: string
          p_descricao: string
          p_categoria: Database["public"]["Enums"]["categoria_despesa"]
          p_fornecedor: string | null
          p_valor_centavos: number
          p_vencimento: string
          p_anexo_path: string | null
        }
        Returns: undefined
      }
      // 0010: competências até o mês de p_ate; idempotente; devolve quantas criou.
      gerar_contas_fixas: { Args: { p_ate: string }; Returns: number }
      // 0010: vale já pago em p_data; devolve o id da conta.
      lancar_vale: {
        Args: {
          p_colaborador: string
          p_valor_centavos: number
          p_data: string
          p_forma: Database["public"]["Enums"]["forma_pagamento"]
          p_obs: string | null
        }
        Returns: string
      }
      // 0010: p_forma nunca 'a_receber' (23514).
      pagar_conta: {
        Args: {
          p_conta: string
          p_pago_em: string
          p_forma: Database["public"]["Enums"]["forma_pagamento"]
        }
        Returns: undefined
      }
      // 0010: só a dona; conta manual 1/1; descrição 1–120 (23514).
      criar_conta_receber: {
        Args: {
          p_cliente: string
          p_descricao: string
          p_valor_centavos: number
          p_vencimento: string
        }
        Returns: string
      }
      // 0010: só a dona; só em aberto. Recebida → "Esta parcela já foi recebida.".
      cancelar_conta_receber: { Args: { p_conta: string; p_motivo: string }; Returns: undefined }
      // 0010: dona/recepção; no caixa de hoje aberto (senão "Abra o caixa do dia
      // antes de receber."); cancelada → "Esta conta foi cancelada."; já recebida
      // → "Esta parcela já foi recebida."; p_forma nunca 'a_receber' (23514).
      // Devolve o id do recebimento.
      receber_parcela: {
        Args: {
          p_conta: string
          p_forma: Database["public"]["Enums"]["forma_pagamento"]
        }
        Returns: string
      }
      // 0010 (seção 6): só a dona (senão P0001 "Acesso não autorizado").
      // Período [p_de, p_ate] em dias de São Paulo. Recebido = pagamentos
      // (valor − desconto, exceto 'a_receber') pela data do caixa + recebimentos
      // por recebido_em; Pago = contas pagas por pago_em. a_*_vencido: parte
      // de a_receber/a_pagar com vencimento < hoje. Vencidos: em aberto com
      // vencimento < hoje, qualquer período. Sempre uma linha (zeros).
      resumo_financeiro: {
        Args: { p_de: string; p_ate: string }
        Returns: {
          recebido: number
          recebido_qtd: number
          pago: number
          pago_qtd: number
          a_receber: number
          ja_recebido: number
          a_pagar: number
          ja_pago: number
          a_receber_vencido: number
          a_pagar_vencido: number
          vencidos_qtd: number
          vencidos_total: number
        }[]
      }
      // 0010: só períodos com movimento, em ordem; 'mes' → periodo = 1º dia do
      // mês. Outro p_agrupar → P0001 "Agrupamento inválido.".
      fluxo_caixa: {
        Args: { p_de: string; p_ate: string; p_agrupar: "dia" | "mes" }
        Returns: { periodo: string; entradas: number; saidas: number }[]
      }
      // 0010: entradas do período por forma, maior primeiro.
      fluxo_por_forma: {
        Args: { p_de: string; p_ate: string }
        Returns: {
          forma: Database["public"]["Enums"]["forma_pagamento"]
          total: number
        }[]
      }
      // 0010: contas pagas no período (pago_em) por categoria, maior primeiro.
      despesas_por_categoria: {
        Args: { p_de: string; p_ate: string }
        Returns: {
          categoria: Database["public"]["Enums"]["categoria_despesa"]
          total: number
        }[]
      }
      // 0010: idempotente; chave 1–120 (23514).
      marcar_avisos_lidos: { Args: { p_chaves: string[] }; Returns: undefined }
      // 0010: aba 1–40, p_de <= p_ate (23514).
      registrar_relatorio: {
        Args: { p_aba: string; p_de: string; p_ate: string }
        Returns: undefined
      }
      // 0007: só a dona; só pacote ativo.
      cancelar_pacote: { Args: { p_pacote: string }; Returns: undefined }
      cliente_do_caminho: { Args: { p_nome: string }; Returns: string | null }
      cliente_vinculada: { Args: { p_cliente: string }; Returns: boolean }
      colaborador_atual_id: { Args: never; Returns: string }
      // 0009: só service_role; p_profissional null = "qualquer uma". Devolve o
      // id do pedido; erros P0001 com as mensagens da Fase 3A.
      criar_pedido_online: {
        Args: {
          p_servico: string
          p_profissional: string | null
          p_inicio: string
          p_nome: string
          p_whatsapp: string
          p_ip_hash: string
        }
        Returns: string
      }
      // 0009: só service_role (tarefa diária); limpa nome/whatsapp de pedidos
      // não aprovados com mais de 90 dias; devolve quantos.
      apagar_dados_pedidos_antigos: { Args: never; Returns: number }
      // 0009: dona/recepção; cria o agendamento confirmado (origem online) e
      // devolve o id. Não aguardando ou vencido → P0001 "Este pedido já foi
      // respondido."; sobreposição na agenda → 23P01.
      aprovar_pedido_online: {
        Args: {
          p_pedido: string
          p_cliente: string
          p_profissional: string
          p_inicio: string
          p_fim: string
          p_valor_centavos: number
        }
        Returns: string
      }
      // 0007: ativo → expirado (validade passou, sessões restantes); devolve quantos.
      expirar_pacotes: { Args: never; Returns: number }
      // 0009: aguardando vencido (24 h) → expirado; devolve quantos.
      expirar_pedidos_online: { Args: never; Returns: number }
      // 0006: usada pela política de leitura do Storage.
      foto_arquivada: { Args: { p_path: string }; Returns: boolean }
      // Retorna { total_por_forma: Record<forma_pagamento, number>,
      //           total_geral, dinheiro_esperado, diferenca } (centavos).
      // 0010: soma pagamentos (exceto 'a_receber', sempre 0) + recebimentos.
      fechar_caixa: {
        Args: { p_caixa: string; p_valor_contado_centavos: number }
        Returns: Json
      }
      // 0009: só service_role; início a cada 15 min; p_dia "YYYY-MM-DD"
      // (São Paulo). Com p_profissional null, a primeira livre por nome.
      horarios_livres_online: {
        Args: { p_servico: string; p_profissional: string | null; p_dia: string }
        Returns: { inicio: string; profissional_id: string }[]
      }
      normalizar_busca: { Args: { texto: string }; Returns: string }
      // 0009: aguardando com criado_em <= now() - 24 h.
      pedido_vencido: {
        Args: { p: Database["public"]["Tables"]["pedidos_online"]["Row"] }
        Returns: boolean
      }
      // 0009: aguardando não vencidos que tocam [p_de, p_ate); profissional só
      // os próprios; sem whatsapp.
      pedidos_online_da_agenda: {
        Args: { p_de: string; p_ate: string }
        Returns: {
          id: string
          profissional_id: string
          servico_id: string
          inicio: string
          fim: string
          primeiro_nome: string
          avaliacao: boolean
        }[]
      }
      perfil_atual: {
        Args: never
        Returns: Database["public"]["Enums"]["perfil"]
      }
      // 0009: dona/recepção; motivo com trim (vazio → null).
      recusar_pedido_online: {
        Args: { p_pedido: string; p_motivo: string | null }
        Returns: undefined
      }
      // 0006: grava 'visualizou' na auditoria; sem acesso → P0001
      // 'Acesso não autorizado'.
      registrar_acesso: {
        Args: {
          p_entidade:
            | "anamneses"
            | "termos_assinados"
            | "fotos"
            | "evolucoes"
            | "exportacao"
          p_entidade_id: string | null
          p_cliente: string
        }
        Returns: undefined
      }
      // 0007: p_partes = 1 a 4 { forma, valor_centavos, parcelas, vencimentos?,
      // valores_parcelas? } somando bruto − desconto; devolve o id da cobrança.
      // Segunda cobrança do mesmo atendimento/pacote → 23505.
      // 0008: cortesia — p_partes = [] quando bruto − desconto = 0.
      registrar_cobranca: {
        Args: {
          p_agendamento: string | null
          p_desconto_centavos: number
          p_origem: Database["public"]["Enums"]["origem_pagamento"]
          p_pacote: string | null
          p_partes: Json
        }
        Returns: string
      }
      // 0007: atalho de uma parte; cria a cobrança e devolve o id do pagamento.
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
      // 0006: só a dona; cria nova versão ativa e devolve o id.
      salvar_modelo_anamnese: { Args: { p_titulo: string; p_perguntas: Json }; Returns: string }
      // 0006: p_anterior nulo cria termo novo (v1); senão nova versão do grupo.
      salvar_modelo_termo: {
        Args: { p_anterior: string | null; p_titulo: string; p_texto: string }
        Returns: string
      }
      // 0006: uma linha por cliente visível; sem anamnese → ultima_anamnese_em null.
      situacao_ficha: {
        Args: { p_clientes: string[] }
        Returns: {
          cliente_id: string
          ultima_anamnese_em: string | null
          tem_alerta: boolean
        }[]
      }
      // 0007: cria o pacote e a cobrança dele; devolve o id do pacote.
      // 0008: p_id opcional (gerado pela tela); repetir o id → 23505 pacotes_vendidos_pkey.
      vender_pacote: {
        Args: {
          p_cliente: string
          p_desconto_centavos: number
          p_id?: string | null
          p_partes: Json
          p_servico: string
          p_total_sessoes: number
          p_validade: string | null
          p_valor_total_centavos: number
        }
        Returns: string
      }
    }
    Enums: {
      acao_auditoria: "visualizou" | "criou" | "alterou" | "arquivou"
      categoria_despesa:
        | "aluguel"
        | "fornecedor"
        | "produto"
        | "salario"
        | "imposto"
        | "vale"
        | "outros"
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
      status_pacote: "ativo" | "concluido" | "expirado" | "cancelado"
      status_conta: "aberta" | "paga" | "cancelada"
      status_pedido_online: "aguardando" | "aprovado" | "recusado" | "expirado"
      tipo_foto: "antes" | "depois" | "evolucao"
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
      acao_auditoria: ["visualizou", "criou", "alterou", "arquivou"],
      categoria_despesa: [
        "aluguel",
        "fornecedor",
        "produto",
        "salario",
        "imposto",
        "vale",
        "outros",
      ],
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
      status_pacote: ["ativo", "concluido", "expirado", "cancelado"],
      status_conta: ["aberta", "paga", "cancelada"],
      status_pedido_online: ["aguardando", "aprovado", "recusado", "expirado"],
      tipo_foto: ["antes", "depois", "evolucao"],
    },
  },
} as const
