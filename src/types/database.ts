
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "analysis_jobs": {
                  Row: {
                    "completed_at": string | null,"contract_id": string | null,"created_at": string,"error_code": string | null,"id": string,"model": string | null,"prompt_version": string | null,"provider": string | null,"result": Json | null,"started_at": string | null,"status": Database["public"]['Enums']["job_status"],"user_id": string
                  }
                  Insert: {
                    "completed_at"?: string | null,"contract_id"?: string | null,"created_at"?: string,"error_code"?: string | null,"id"?: string,"model"?: string | null,"prompt_version"?: string | null,"provider"?: string | null,"result"?: Json | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"user_id"?: string
                  }
                  Update: {
                    "completed_at"?: string | null,"contract_id"?: string | null,"created_at"?: string,"error_code"?: string | null,"id"?: string,"model"?: string | null,"prompt_version"?: string | null,"provider"?: string | null,"result"?: Json | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["job_status"],"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "analysis_jobs_contract_fk"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    }
                  ]
                },"contract_documents": {
                  Row: {
                    "analysis_job_id": string | null,"contract_id": string | null,"created_at": string,"id": string,"mime_type": string,"original_filename": string | null,"page_count": number | null,"size_bytes": number,"sort_order": number,"storage_path": string,"user_id": string
                  }
                  Insert: {
                    "analysis_job_id"?: string | null,"contract_id"?: string | null,"created_at"?: string,"id"?: string,"mime_type": string,"original_filename"?: string | null,"page_count"?: number | null,"size_bytes": number,"sort_order"?: number,"storage_path": string,"user_id"?: string
                  }
                  Update: {
                    "analysis_job_id"?: string | null,"contract_id"?: string | null,"created_at"?: string,"id"?: string,"mime_type"?: string,"original_filename"?: string | null,"page_count"?: number | null,"size_bytes"?: number,"sort_order"?: number,"storage_path"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contract_documents_analysis_job_id_fkey"
      columns: ["analysis_job_id"]
isOneToOne: false
      referencedRelation: "analysis_jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contract_documents_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    }
                  ]
                },"contract_events": {
                  Row: {
                    "amount": number | null,"completed_at": string | null,"contract_id": string,"created_at": string,"event_date": string,"event_type": Database["public"]['Enums']["contract_event_type"],"id": string,"is_recurring": boolean,"notification_enabled": boolean,"recurrence_rule": string | null,"source": Database["public"]['Enums']["event_source"],"title": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "amount"?: number | null,"completed_at"?: string | null,"contract_id": string,"created_at"?: string,"event_date": string,"event_type"?: Database["public"]['Enums']["contract_event_type"],"id"?: string,"is_recurring"?: boolean,"notification_enabled"?: boolean,"recurrence_rule"?: string | null,"source"?: Database["public"]['Enums']["event_source"],"title": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number | null,"completed_at"?: string | null,"contract_id"?: string,"created_at"?: string,"event_date"?: string,"event_type"?: Database["public"]['Enums']["contract_event_type"],"id"?: string,"is_recurring"?: boolean,"notification_enabled"?: boolean,"recurrence_rule"?: string | null,"source"?: Database["public"]['Enums']["event_source"],"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contract_events_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    }
                  ]
                },"contract_payments": {
                  Row: {
                    "amount": number,"contract_id": string,"created_at": string,"currency": string,"day_of_month": number | null,"ends_on": string | null,"frequency": Database["public"]['Enums']["payment_frequency"],"id": string,"is_variable": boolean,"label": string,"month_of_year": number | null,"sort_order": number,"starts_on": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "amount": number,"contract_id": string,"created_at"?: string,"currency"?: string,"day_of_month"?: number | null,"ends_on"?: string | null,"frequency": Database["public"]['Enums']["payment_frequency"],"id"?: string,"is_variable"?: boolean,"label"?: string,"month_of_year"?: number | null,"sort_order"?: number,"starts_on": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number,"contract_id"?: string,"created_at"?: string,"currency"?: string,"day_of_month"?: number | null,"ends_on"?: string | null,"frequency"?: Database["public"]['Enums']["payment_frequency"],"id"?: string,"is_variable"?: boolean,"label"?: string,"month_of_year"?: number | null,"sort_order"?: number,"starts_on"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contract_payments_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    }
                  ]
                },"contracts": {
                  Row: {
                    "ai_checks": NonNullable<Json>,"analysis_job_id": string | null,"auto_renewal": boolean,"category": Database["public"]['Enums']["contract_category"],"contract_date": string | null,"counterparty": string | null,"created_at": string,"currency": string,"deposit_amount": number | null,"early_termination_terms": string | null,"end_date": string | null,"id": string,"lifecycle": Database["public"]['Enums']["contract_lifecycle"],"lifecycle_changed_on": string | null,"memo": string | null,"notifications_enabled": boolean,"penalty_terms": string | null,"renewal_period_months": number | null,"source": Database["public"]['Enums']["contract_source"],"start_date": string | null,"termination_notice_days": number | null,"title": string,"total_amount": number | null,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "ai_checks"?: NonNullable<Json>,"analysis_job_id"?: string | null,"auto_renewal"?: boolean,"category"?: Database["public"]['Enums']["contract_category"],"contract_date"?: string | null,"counterparty"?: string | null,"created_at"?: string,"currency"?: string,"deposit_amount"?: number | null,"early_termination_terms"?: string | null,"end_date"?: string | null,"id"?: string,"lifecycle"?: Database["public"]['Enums']["contract_lifecycle"],"lifecycle_changed_on"?: string | null,"memo"?: string | null,"notifications_enabled"?: boolean,"penalty_terms"?: string | null,"renewal_period_months"?: number | null,"source"?: Database["public"]['Enums']["contract_source"],"start_date"?: string | null,"termination_notice_days"?: number | null,"title": string,"total_amount"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "ai_checks"?: NonNullable<Json>,"analysis_job_id"?: string | null,"auto_renewal"?: boolean,"category"?: Database["public"]['Enums']["contract_category"],"contract_date"?: string | null,"counterparty"?: string | null,"created_at"?: string,"currency"?: string,"deposit_amount"?: number | null,"early_termination_terms"?: string | null,"end_date"?: string | null,"id"?: string,"lifecycle"?: Database["public"]['Enums']["contract_lifecycle"],"lifecycle_changed_on"?: string | null,"memo"?: string | null,"notifications_enabled"?: boolean,"penalty_terms"?: string | null,"renewal_period_months"?: number | null,"source"?: Database["public"]['Enums']["contract_source"],"start_date"?: string | null,"termination_notice_days"?: number | null,"title"?: string,"total_amount"?: number | null,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contracts_analysis_job_id_fkey"
      columns: ["analysis_job_id"]
isOneToOne: false
      referencedRelation: "analysis_jobs"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "ai_processing_agreed_at": string | null,"created_at": string,"display_name": string | null,"id": string,"onboarding_completed_at": string | null,"privacy_agreed_at": string | null,"push_preview_enabled": boolean,"terms_agreed_at": string | null,"timezone": string,"updated_at": string
                  }
                  Insert: {
                    "ai_processing_agreed_at"?: string | null,"created_at"?: string,"display_name"?: string | null,"id": string,"onboarding_completed_at"?: string | null,"privacy_agreed_at"?: string | null,"push_preview_enabled"?: boolean,"terms_agreed_at"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "ai_processing_agreed_at"?: string | null,"created_at"?: string,"display_name"?: string | null,"id"?: string,"onboarding_completed_at"?: string | null,"privacy_agreed_at"?: string | null,"push_preview_enabled"?: boolean,"terms_agreed_at"?: string | null,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "owns_contract":
{ Args: { "cid": string }; Returns: boolean
                           },
"save_contract":
{ Args: { "p_ai_checks"?: Json,"p_contract": Json,"p_contract_id"?: string,"p_document_ids"?: (string)[],"p_payment"?: Json }; Returns: string
                           }
          }
          Enums: {
            "contract_category": "real_estate"|"vehicle"|"insurance"|"telecom"|"rental"|"finance"|"employment"|"business"|"membership"|"subscription"|"other","contract_event_type": "payment"|"contract_start"|"contract_end"|"renewal"|"termination_notice"|"custom","contract_lifecycle": "active"|"ended"|"cancelled","contract_source": "upload"|"manual","event_source": "system"|"ai"|"user","job_status": "queued"|"processing"|"succeeded"|"failed"|"expired","payment_frequency": "one_time"|"monthly"|"bimonthly"|"quarterly"|"semiannual"|"yearly"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "contract_category": ["real_estate", "vehicle", "insurance", "telecom", "rental", "finance", "employment", "business", "membership", "subscription", "other"],"contract_event_type": ["payment", "contract_start", "contract_end", "renewal", "termination_notice", "custom"],"contract_lifecycle": ["active", "ended", "cancelled"],"contract_source": ["upload", "manual"],"event_source": ["system", "ai", "user"],"job_status": ["queued", "processing", "succeeded", "failed", "expired"],"payment_frequency": ["one_time", "monthly", "bimonthly", "quarterly", "semiannual", "yearly"]
          }
        }
} as const
