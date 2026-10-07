
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
                },"contract_categories": {
                  Row: {
                    "code": string,"label": string,"sort_order": number
                  }
                  Insert: {
                    "code": string,"label": string,"sort_order"?: number
                  }
                  Update: {
                    "code"?: string,"label"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"contract_date_kind_defs": {
                  Row: {
                    "code": string,"label": string,"sort_order": number
                  }
                  Insert: {
                    "code": string,"label": string,"sort_order"?: number
                  }
                  Update: {
                    "code"?: string,"label"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"contract_dates": {
                  Row: {
                    "contract_id": string,"created_at": string,"date": string,"id": string,"kind": string,"label": string,"sort_order": number,"user_id": string
                  }
                  Insert: {
                    "contract_id": string,"created_at"?: string,"date": string,"id"?: string,"kind"?: string,"label": string,"sort_order"?: number,"user_id"?: string
                  }
                  Update: {
                    "contract_id"?: string,"created_at"?: string,"date"?: string,"id"?: string,"kind"?: string,"label"?: string,"sort_order"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contract_dates_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contract_dates_kind_fk"
      columns: ["kind"]
isOneToOne: false
      referencedRelation: "contract_date_kind_defs"
      referencedColumns: ["code"]
    }
                  ]
                },"contract_detail_fields": {
                  Row: {
                    "contract_type": string,"key": string,"options": (string)[] | null,"value_type": string
                  }
                  Insert: {
                    "contract_type": string,"key": string,"options"?: (string)[] | null,"value_type": string
                  }
                  Update: {
                    "contract_type"?: string,"key"?: string,"options"?: (string)[] | null,"value_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contract_detail_fields_contract_type_fkey"
      columns: ["contract_type"]
isOneToOne: false
      referencedRelation: "contract_type_defs"
      referencedColumns: ["code"]
    }
                  ]
                },"contract_documents": {
                  Row: {
                    "analysis_job_id": string | null,"contract_id": string | null,"created_at": string,"id": string,"mime_type": string,"original_filename": string | null,"page_count": number | null,"protected_at": string | null,"protection_detail": string | null,"protection_images_unchecked": boolean,"protection_status": string,"size_bytes": number,"sort_order": number,"storage_path": string,"user_id": string
                  }
                  Insert: {
                    "analysis_job_id"?: string | null,"contract_id"?: string | null,"created_at"?: string,"id"?: string,"mime_type": string,"original_filename"?: string | null,"page_count"?: number | null,"protected_at"?: string | null,"protection_detail"?: string | null,"protection_images_unchecked"?: boolean,"protection_status"?: string,"size_bytes": number,"sort_order"?: number,"storage_path": string,"user_id"?: string
                  }
                  Update: {
                    "analysis_job_id"?: string | null,"contract_id"?: string | null,"created_at"?: string,"id"?: string,"mime_type"?: string,"original_filename"?: string | null,"page_count"?: number | null,"protected_at"?: string | null,"protection_detail"?: string | null,"protection_images_unchecked"?: boolean,"protection_status"?: string,"size_bytes"?: number,"sort_order"?: number,"storage_path"?: string,"user_id"?: string
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
                    "amount": number,"business_day_rule": string,"components": NonNullable<Json>,"condition_note": string | null,"contract_id": string,"created_at": string,"currency": string,"day_of_month": number | null,"direction": string,"ends_on": string | null,"frequency": Database["public"]['Enums']["payment_frequency"],"id": string,"installment_count": number | null,"is_variable": boolean,"kind": string,"label": string,"month_of_year": number | null,"obligation": string,"sort_order": number,"starts_on": string,"updated_at": string,"user_id": string
                  }
                  Insert: {
                    "amount": number,"business_day_rule"?: string,"components"?: NonNullable<Json>,"condition_note"?: string | null,"contract_id": string,"created_at"?: string,"currency"?: string,"day_of_month"?: number | null,"direction"?: string,"ends_on"?: string | null,"frequency": Database["public"]['Enums']["payment_frequency"],"id"?: string,"installment_count"?: number | null,"is_variable"?: boolean,"kind"?: string,"label"?: string,"month_of_year"?: number | null,"obligation"?: string,"sort_order"?: number,"starts_on": string,"updated_at"?: string,"user_id"?: string
                  }
                  Update: {
                    "amount"?: number,"business_day_rule"?: string,"components"?: NonNullable<Json>,"condition_note"?: string | null,"contract_id"?: string,"created_at"?: string,"currency"?: string,"day_of_month"?: number | null,"direction"?: string,"ends_on"?: string | null,"frequency"?: Database["public"]['Enums']["payment_frequency"],"id"?: string,"installment_count"?: number | null,"is_variable"?: boolean,"kind"?: string,"label"?: string,"month_of_year"?: number | null,"obligation"?: string,"sort_order"?: number,"starts_on"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contract_payments_contract_id_fkey"
      columns: ["contract_id"]
isOneToOne: false
      referencedRelation: "contracts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contract_payments_kind_fk"
      columns: ["kind"]
isOneToOne: false
      referencedRelation: "payment_kind_defs"
      referencedColumns: ["code"]
    }
                  ]
                },"contract_type_defs": {
                  Row: {
                    "code": string,"label": string,"sort_order": number
                  }
                  Insert: {
                    "code": string,"label": string,"sort_order"?: number
                  }
                  Update: {
                    "code"?: string,"label"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
                  ]
                },"contracts": {
                  Row: {
                    "ai_checks": NonNullable<Json>,"analysis_job_id": string | null,"auto_renewal": boolean,"category": string,"contract_date": string | null,"contract_details": NonNullable<Json>,"contract_type": string,"counterparty": string | null,"created_at": string,"currency": string,"deposit_amount": number | null,"early_termination_terms": string | null,"end_date": string | null,"id": string,"lifecycle": Database["public"]['Enums']["contract_lifecycle"],"lifecycle_changed_on": string | null,"memo": string | null,"notifications_enabled": boolean,"penalty_terms": string | null,"renewal_period_months": number | null,"source": Database["public"]['Enums']["contract_source"],"start_date": string | null,"termination_notice_days": number | null,"title": string,"total_amount": number | null,"updated_at": string,"user_id": string,"value_sources": NonNullable<Json>
                  }
                  Insert: {
                    "ai_checks"?: NonNullable<Json>,"analysis_job_id"?: string | null,"auto_renewal"?: boolean,"category"?: string,"contract_date"?: string | null,"contract_details"?: NonNullable<Json>,"contract_type"?: string,"counterparty"?: string | null,"created_at"?: string,"currency"?: string,"deposit_amount"?: number | null,"early_termination_terms"?: string | null,"end_date"?: string | null,"id"?: string,"lifecycle"?: Database["public"]['Enums']["contract_lifecycle"],"lifecycle_changed_on"?: string | null,"memo"?: string | null,"notifications_enabled"?: boolean,"penalty_terms"?: string | null,"renewal_period_months"?: number | null,"source"?: Database["public"]['Enums']["contract_source"],"start_date"?: string | null,"termination_notice_days"?: number | null,"title": string,"total_amount"?: number | null,"updated_at"?: string,"user_id"?: string,"value_sources"?: NonNullable<Json>
                  }
                  Update: {
                    "ai_checks"?: NonNullable<Json>,"analysis_job_id"?: string | null,"auto_renewal"?: boolean,"category"?: string,"contract_date"?: string | null,"contract_details"?: NonNullable<Json>,"contract_type"?: string,"counterparty"?: string | null,"created_at"?: string,"currency"?: string,"deposit_amount"?: number | null,"early_termination_terms"?: string | null,"end_date"?: string | null,"id"?: string,"lifecycle"?: Database["public"]['Enums']["contract_lifecycle"],"lifecycle_changed_on"?: string | null,"memo"?: string | null,"notifications_enabled"?: boolean,"penalty_terms"?: string | null,"renewal_period_months"?: number | null,"source"?: Database["public"]['Enums']["contract_source"],"start_date"?: string | null,"termination_notice_days"?: number | null,"title"?: string,"total_amount"?: number | null,"updated_at"?: string,"user_id"?: string,"value_sources"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "contracts_analysis_job_id_fkey"
      columns: ["analysis_job_id"]
isOneToOne: false
      referencedRelation: "analysis_jobs"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contracts_category_fk"
      columns: ["category"]
isOneToOne: false
      referencedRelation: "contract_categories"
      referencedColumns: ["code"]
    },{
      foreignKeyName: "contracts_contract_type_fk"
      columns: ["contract_type"]
isOneToOne: false
      referencedRelation: "contract_type_defs"
      referencedColumns: ["code"]
    }
                  ]
                },"document_derivatives": {
                  Row: {
                    "created_at": string,"document_id": string,"id": string,"kind": string,"size_bytes": number | null,"storage_path": string,"user_id": string
                  }
                  Insert: {
                    "created_at"?: string,"document_id": string,"id"?: string,"kind": string,"size_bytes"?: number | null,"storage_path": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"document_id"?: string,"id"?: string,"kind"?: string,"size_bytes"?: number | null,"storage_path"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_derivatives_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "contract_documents"
      referencedColumns: ["id"]
    }
                  ]
                },"document_sensitive_regions": {
                  Row: {
                    "bbox_json": NonNullable<Json>,"confidence": string,"context_label": string | null,"created_at": string,"document_id": string,"id": string,"mask_level": number,"masked_preview": string,"page_number": number,"region_key": string,"sensitive_type": string,"source": string,"state": string,"updated_at": string,"user_confirmed": boolean,"user_id": string
                  }
                  Insert: {
                    "bbox_json": NonNullable<Json>,"confidence": string,"context_label"?: string | null,"created_at"?: string,"document_id": string,"id"?: string,"mask_level": number,"masked_preview": string,"page_number": number,"region_key": string,"sensitive_type": string,"source"?: string,"state": string,"updated_at"?: string,"user_confirmed"?: boolean,"user_id": string
                  }
                  Update: {
                    "bbox_json"?: NonNullable<Json>,"confidence"?: string,"context_label"?: string | null,"created_at"?: string,"document_id"?: string,"id"?: string,"mask_level"?: number,"masked_preview"?: string,"page_number"?: number,"region_key"?: string,"sensitive_type"?: string,"source"?: string,"state"?: string,"updated_at"?: string,"user_confirmed"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "document_sensitive_regions_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "contract_documents"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_kind_defs": {
                  Row: {
                    "code": string,"default_direction": string,"label": string,"sort_order": number
                  }
                  Insert: {
                    "code": string,"default_direction": string,"label": string,"sort_order"?: number
                  }
                  Update: {
                    "code"?: string,"default_direction"?: string,"label"?: string,"sort_order"?: number
                  }
                  Relationships: [
                    
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
{ Args: { "p_ai_checks"?: Json,"p_contract": Json,"p_contract_id"?: string,"p_dates"?: Json,"p_document_ids"?: (string)[],"p_payments"?: Json }; Returns: string
                           }
          }
          Enums: {
            "contract_event_type": "payment"|"contract_start"|"contract_end"|"renewal"|"termination_notice"|"custom","contract_lifecycle": "active"|"ended"|"cancelled","contract_source": "upload"|"manual","event_source": "system"|"ai"|"user","job_status": "queued"|"processing"|"succeeded"|"failed"|"expired","payment_frequency": "one_time"|"monthly"|"bimonthly"|"quarterly"|"semiannual"|"yearly"
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
            "contract_event_type": ["payment", "contract_start", "contract_end", "renewal", "termination_notice", "custom"],"contract_lifecycle": ["active", "ended", "cancelled"],"contract_source": ["upload", "manual"],"event_source": ["system", "ai", "user"],"job_status": ["queued", "processing", "succeeded", "failed", "expired"],"payment_frequency": ["one_time", "monthly", "bimonthly", "quarterly", "semiannual", "yearly"]
          }
        }
} as const
