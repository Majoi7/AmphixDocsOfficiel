// Contrat local de V6 : à comparer avec la base après exécution manuelle.
// Les libellés école/matière historiques peuvent être NULL ; les entités
// normalisées et leurs relations sont réservées au LOT 2.
export type ItemStatus = 'pending' | 'approved' | 'rejected';
export type UserRole = 'user' | 'admin';

export type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: UserRole;
  created_at: string | null;
  last_sign_in_at: string | null;
};

export type DocumentRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number | null;
  created_at: string | null;
  school_name: string | null;
  subject_name: string | null;
  status: ItemStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  thumbnail_path: string | null;
  page_count: number | null;
};

export type DocumentTrashState = Pick<DocumentRow, 'id' | 'deleted_at' | 'deleted_by'>;
type InsertDocument = Pick<DocumentRow, 'title' | 'file_name' | 'file_path' | 'school_name' | 'subject_name'>
  & Partial<Pick<DocumentRow, 'id' | 'user_id' | 'description' | 'file_type' | 'file_size' | 'status'>>;
type UpdateDocument = Partial<Pick<DocumentRow, 'title' | 'description' | 'status' | 'rejection_reason'>>;

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow;
        Insert: Pick<ProfileRow, 'id'> & Partial<ProfileRow>;
        Update: Pick<Partial<ProfileRow>, 'role'>;
        Relationships: [];
      };
      documents: {
        Row: DocumentRow;
        Insert: InsertDocument;
        Update: UpdateDocument;
        Relationships: [{
          foreignKeyName: 'documents_user_id_profiles_fkey';
          columns: ['user_id'];
          isOneToOne: false;
          referencedRelation: 'profiles';
          referencedColumns: ['id'];
        }];
      };
    };
    Views: { [key in never]: never };
    Functions: {
      is_admin: { Args: Record<string, never>; Returns: boolean };
      list_library_documents: {
        Args: { p_query?: string; p_trash?: boolean; p_pending?: boolean; p_offset?: number; p_ascending?: boolean };
        Returns: DocumentRow[];
        // V6 renvoie SETOF documents : PostgREST expose aussi ses relations.
        SetofOptions: { from: '*'; to: 'documents'; isOneToOne: false; isSetofReturn: true };
      };
      get_missing_document_previews: {
        Args: { p_after_id?: string | null };
        Returns: DocumentRow[];
      };
      set_document_preview: {
        Args: { p_document_id: string; p_thumbnail_path: string; p_page_count: number | null };
        Returns: DocumentRow[];
      };
      set_document_trash: {
        Args: { p_document_id: string; p_deleted: boolean };
        Returns: DocumentTrashState[];
      };
      get_legacy_upload_document: {
        Args: { p_document_id: string; p_folder_id: string | null; p_category_id: string | null };
        Returns: DocumentRow[];
      };
      finalize_legacy_upload: {
        Args: {
          p_document_id: string;
          p_title: string;
          p_description: string;
          p_file_name: string;
          p_file_path: string;
          p_file_type: string;
          p_file_size: number;
          p_folder_id: string | null;
          p_category_id: string | null;
          p_school_name: string;
          p_subject_name: string;
        };
        Returns: DocumentRow[];
      };
    };
    Enums: { [key in never]: never };
    CompositeTypes: { [key in never]: never };
  };
}
