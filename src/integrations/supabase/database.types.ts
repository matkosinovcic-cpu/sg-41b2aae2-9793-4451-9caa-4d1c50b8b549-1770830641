 
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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      answers: {
        Row: {
          answer: boolean
          created_at: string | null
          id: string
          question_number: number
          ticket_id: string
        }
        Insert: {
          answer: boolean
          created_at?: string | null
          id?: string
          question_number: number
          ticket_id: string
        }
        Update: {
          answer?: boolean
          created_at?: string | null
          id?: string
          question_number?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answers_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      event_questions: {
        Row: {
          drawn: boolean | null
          drawn_at: string | null
          event_id: string
          id: string
          question_id: string
          question_number: number
        }
        Insert: {
          drawn?: boolean | null
          drawn_at?: string | null
          event_id: string
          id?: string
          question_id: string
          question_number: number
        }
        Update: {
          drawn?: boolean | null
          drawn_at?: string | null
          event_id?: string
          id?: string
          question_id?: string
          question_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "event_questions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_questions_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          continue_after_winner: boolean | null
          created_at: string | null
          current_drawn_number: number | null
          current_question_number: number | null
          drawn_numbers: number[] | null
          id: string
          name: string
          question_open_until: string | null
          status: string
          updated_at: string | null
          winner_ticket_id: string | null
        }
        Insert: {
          continue_after_winner?: boolean | null
          created_at?: string | null
          current_drawn_number?: number | null
          current_question_number?: number | null
          drawn_numbers?: number[] | null
          id?: string
          name: string
          question_open_until?: string | null
          status?: string
          updated_at?: string | null
          winner_ticket_id?: string | null
        }
        Update: {
          continue_after_winner?: boolean | null
          created_at?: string | null
          current_drawn_number?: number | null
          current_question_number?: number | null
          drawn_numbers?: number[] | null
          id?: string
          name?: string
          question_open_until?: string | null
          status?: string
          updated_at?: string | null
          winner_ticket_id?: string | null
        }
        Relationships: []
      }
      player_answers: {
        Row: {
          answer_yesno: string
          created_at: string | null
          event_id: string
          id: string
          is_correct: boolean
          question_id: string
          question_number: number
          session_id: string
          ticket_id: string | null
        }
        Insert: {
          answer_yesno: string
          created_at?: string | null
          event_id: string
          id?: string
          is_correct: boolean
          question_id: string
          question_number: number
          session_id: string
          ticket_id?: string | null
        }
        Update: {
          answer_yesno?: string
          created_at?: string | null
          event_id?: string
          id?: string
          is_correct?: boolean
          question_id?: string
          question_number?: number
          session_id?: string
          ticket_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_answers_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "player_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_answers_ticket_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["serial_number"]
          },
        ]
      }
      player_sessions: {
        Row: {
          created_at: string | null
          event_id: string
          id: string
          player_id: string | null
          session_token: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          player_id?: string | null
          session_token: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          id?: string
          player_id?: string | null
          session_token?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_sessions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_sessions_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
        ]
      }
      players: {
        Row: {
          created_at: string | null
          email: string
          id: string
          nickname: string
        }
        Insert: {
          created_at?: string | null
          email: string
          id?: string
          nickname: string
        }
        Update: {
          created_at?: string | null
          email?: string
          id?: string
          nickname?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      questions: {
        Row: {
          correct_answer: boolean
          created_at: string | null
          id: string
          question_type: string | null
          text: string
        }
        Insert: {
          correct_answer: boolean
          created_at?: string | null
          id?: string
          question_type?: string | null
          text: string
        }
        Update: {
          correct_answer?: boolean
          created_at?: string | null
          id?: string
          question_type?: string | null
          text?: string
        }
        Relationships: []
      }
      ticket_questions: {
        Row: {
          id: string
          question_number: number
          ticket_id: string
        }
        Insert: {
          id?: string
          question_number: number
          ticket_id: string
        }
        Update: {
          id?: string
          question_number?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticket_questions_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      tickets: {
        Row: {
          created_at: string | null
          event_id: string
          id: string
          is_winner: boolean | null
          player_id: string | null
          serial_number: string
          session_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          is_winner?: boolean | null
          player_id?: string | null
          serial_number: string
          session_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_id?: string
          id?: string
          is_winner?: boolean | null
          player_id?: string | null
          serial_number?: string
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "player_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      check_winner_tickets: {
        Args: { p_event_id: string }
        Returns: {
          ticket_id: string
          ticket_serial: string
        }[]
      }
      claim_free_tickets: {
        Args: { p_email: string; p_limit?: number; p_nickname: string }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
