export type CategoryType = 'work' | 'life';
export type PriorityType = 'high' | 'medium' | 'low';
export type StatusType = 'active' | 'pending' | 'completed' | 'archived';
export type TodoStatusType = 'pending' | 'completed';

export interface Matter {
  id: string;
  title: string;
  overview: string;
  fact_summary: string;
  category: CategoryType;
  priority: PriorityType;
  importance: number;
  status: StatusType;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
  pending_todos_count?: number;
  total_todos_count?: number;
  latest_log_snippet?: string;
  latest_log_time?: string;
}

export interface LogItem {
  id: string;
  matter_id: string;
  raw_content: string;
  source_app: string;
  source_window_title: string;
  created_at: string;
}

export interface TodoItem {
  id: string;
  matter_id: string;
  log_id?: string;
  content: string;
  due_time?: string;
  reminder_time?: string;
  is_reminder_sent: boolean;
  status: TodoStatusType;
  is_focused: boolean;
  created_at: string;
  completed_at?: string;
  matter_title?: string;
}

export interface AppConfig {
  api_base_url: string;
  api_key: string;
  model_name: string;
  capture_shortcut: string;
  main_window_shortcut: string;
  auto_archive_confidence: number;
}

export interface ExtractedTodo {
  content: string;
  due_time?: string;
}

export interface SuggestedMatter {
  title: string;
  category: CategoryType;
  priority: PriorityType;
  summary: string;
}

export interface CandidateMatter {
  id: string;
  title: string;
  confidence: number;
}

export interface AIParseResult {
  action: 'MATCH_EXISTING' | 'AMBIGUOUS' | 'CREATE_NEW' | 'IGNORE';
  confidence: number;
  matched_matter_id?: string;
  matched_matter_title?: string;
  candidate_matters: CandidateMatter[];
  suggested_new_matter?: SuggestedMatter;
  extracted_facts_delta?: string;
  extracted_todos: ExtractedTodo[];
  raw_snippet: string;
  source_app: string;
  source_window: string;
}

export interface ConfirmRoutePayload {
  choice: 'EXISTING' | 'CREATE_NEW' | 'DISCARD';
  matter_id?: string;
  new_matter?: SuggestedMatter;
  raw_snippet: string;
  source_app: string;
  source_window: string;
  extracted_facts_delta?: string;
  extracted_todos: ExtractedTodo[];
}
