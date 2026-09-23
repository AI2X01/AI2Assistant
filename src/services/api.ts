import { invoke } from '@tauri-apps/api/core';
import {
  Matter,
  LogItem,
  InboxLogItem,
  TodoItem,
  AppConfig,
  AIParseResult,
  ConfirmRoutePayload,
  CategorizePayload,
  UncategorizePayload,
  RecategorizePayload,
  CapturedContext,
  CompactDockState,
} from '../types';

// 检测是否处于 Tauri 环境
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// 浏览器运行环境下的 Mock 数据与本地状态
let mockMatters: Matter[] = [
  {
    id: 'm_001',
    title: 'A银行系统技术架构白皮书交付',
    overview: '面向A银行核心业务系统升级重构的技术白皮书，包含性能基准与高可用设计。',
    fact_summary: '• 商务约束: 本周提交审定版本\n• 性能指标: TPS必须大于5000，P99延迟低于50ms\n• 关键对接人: 客户侧张总，架构师李工',
    category: 'work',
    priority: 'high',
    importance: 5,
    status: 'active',
    is_pinned: true,
    created_at: '2026-09-20 10:00:00',
    updated_at: '2026-09-20 23:10:00',
    pending_todos_count: 2,
    total_todos_count: 3,
    latest_log_snippet: '张总在微信群强调周三上午10点前提交白皮书终版',
    latest_log_time: '2026-09-20 23:10:00',
    latest_todo_content: '补全白皮书性能指标与基准压测数据',
    latest_todo_due_time: '2026-09-23 10:00:00',
    latest_todo_status: 'pending',
    related_contacts: 'A银行项目交付群, 张总, 架构师李工',
  },
  {
    id: 'm_002',
    title: '智能巡检系统二期传感器供应链评估',
    overview: '调研二期高精度红外与振动传感器供应商报价及交期周期。',
    fact_summary: '• 第一期硬件打样已通过高低温测试\n• 待供应商提供第二批次阶梯报价单',
    category: 'work',
    priority: 'medium',
    importance: 4,
    status: 'active',
    is_pinned: false,
    created_at: '2026-09-18 14:00:00',
    updated_at: '2026-09-19 16:30:00',
    pending_todos_count: 1,
    total_todos_count: 1,
    latest_log_snippet: '企微收到供应商技术选型参数手册',
    latest_log_time: '2026-09-19 16:30:00',
    latest_todo_content: '催促两家核心供应商在周五前提交二期红外传感器阶梯报价单',
    latest_todo_due_time: '2026-09-25 18:00:00',
    latest_todo_status: 'pending',
    related_contacts: '二期巡检硬件组, 传感器供应商交流群, Leo',
  },
  {
    id: 'm_003',
    title: '家庭宽带光纤升兆与网络拓扑升级',
    overview: '联系运营商完成FTTR全光纤入室改造与NAS局域网万兆升级。',
    fact_summary: '• 已预约下周六上午师傅上门测速',
    category: 'life',
    priority: 'low',
    importance: 2,
    status: 'active',
    is_pinned: false,
    created_at: '2026-09-17 09:00:00',
    updated_at: '2026-09-18 11:20:00',
    pending_todos_count: 1,
    total_todos_count: 1,
    latest_log_snippet: '联通短信通知套餐升级已生效',
    latest_log_time: '2026-09-18 11:20:00',
    latest_todo_content: '周六上午等待师傅上门FTTR光纤布线与测速验收',
    latest_todo_due_time: '2026-09-26 10:00:00',
    latest_todo_status: 'pending',
    related_contacts: '中国联通客户经理, 安装师傅小周, 家庭群',
  },
];

let mockLogs: LogItem[] = [
  {
    id: 'l_001',
    matter_id: 'm_001',
    raw_content: '张总：关于A银行项目，我们下周三上午10点前需要提交技术架构白皮书终版，请把性能指标章节补全。',
    source_app: '企业微信',
    source_window_title: 'A银行项目交付攻坚群',
    created_at: '2026-09-20 23:10:00',
  },
  {
    id: 'l_002',
    matter_id: 'm_001',
    raw_content: '李工：压测集群环境已经搭好了，初测TPS在5200左右，P99在38ms。',
    source_app: '微信',
    source_window_title: '架构评审小组',
    created_at: '2026-09-20 16:00:00',
  },
];

let mockTodos: TodoItem[] = [
  {
    id: 't_001',
    matter_id: 'm_001',
    content: '补全白皮书性能指标与基准压测数据',
    due_time: '2026-09-23 10:00:00',
    reminder_time: '2026-09-23 09:30:00',
    is_reminder_sent: false,
    status: 'pending',
    is_focused: true,
    created_at: '2026-09-20 23:10:00',
    matter_title: 'A银行系统技术架构白皮书交付',
  },
  {
    id: 't_002',
    matter_id: 'm_001',
    content: '向张总邮件发送技术架构正式审定版',
    due_time: '2026-09-23 17:00:00',
    reminder_time: '2026-09-23 16:30:00',
    is_reminder_sent: false,
    status: 'pending',
    is_focused: false,
    created_at: '2026-09-20 23:10:00',
    matter_title: 'A银行系统技术架构白皮书交付',
  },
];

let mockConfig: AppConfig = {
  api_base_url: 'https://api.openai.com/v1',
  api_key: '',
  model_name: 'gpt-4o-mini',
  capture_shortcut: 'Alt+A',
  main_window_shortcut: 'Alt+Shift+Space',
  auto_archive_confidence: 0.8,
  user_profile: '我是项目负责人兼质检主管，负责多语种与方言数据标注质检项目。常见团队与对接人包括张总、Leo、陈伟豪、李棠佳等。',
  theme: 'system',
};

export function normalizeTodoTime(timeStr?: string): string | undefined {
  if (!timeStr) return undefined;
  const trimmed = timeStr.trim();
  if (!trimmed) return undefined;
  if (trimmed.endsWith('23:59:59')) {
    return trimmed.replace('23:59:59', '22:00:00');
  }
  if (trimmed.endsWith('23:59:00')) {
    return trimmed.replace('23:59:00', '22:00:00');
  }
  if (trimmed.endsWith('23:59')) {
    return trimmed.replace('23:59', '22:00:00');
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed} 22:00:00`;
  }
  return trimmed;
}

export const api = {
  // 事项
  async getMatters(statusFilter?: string, categoryFilter?: string, sortBy?: string): Promise<Matter[]> {
    if (isTauri) {
      return invoke('get_matters', { statusFilter, categoryFilter, sortBy });
    }
    let list = [...mockMatters];
    if (statusFilter && statusFilter !== 'all') {
      list = list.filter((m) => m.status === statusFilter);
    }
    if (categoryFilter && categoryFilter !== 'all') {
      list = list.filter((m) => m.category === categoryFilter);
    }
    return list;
  },

  async getMatterById(id: string): Promise<Matter | null> {
    if (isTauri) {
      return invoke('get_matter_by_id', { id });
    }
    return mockMatters.find((m) => m.id === id) || null;
  },

  async createMatter(params: {
    title: string;
    overview?: string;
    fact_summary?: string;
    category: string;
    priority: string;
    importance?: number;
    related_contacts?: string;
  }): Promise<Matter> {
    if (isTauri) {
      return invoke('create_matter', params);
    }
    const newM: Matter = {
      id: 'm_' + Date.now(),
      title: params.title,
      overview: params.overview || '',
      fact_summary: params.fact_summary || '',
      category: params.category as any,
      priority: params.priority as any,
      importance: params.importance || 3,
      status: 'active',
      is_pinned: false,
      created_at: new Date().toLocaleString(),
      updated_at: new Date().toLocaleString(),
      pending_todos_count: 0,
      total_todos_count: 0,
      related_contacts: params.related_contacts || '',
    };
    mockMatters.unshift(newM);
    return newM;
  },

  async updateMatter(matter: Matter): Promise<void> {
    if (isTauri) {
      return invoke('update_matter', { matter });
    }
    const idx = mockMatters.findIndex((m) => m.id === matter.id);
    if (idx !== -1) {
      mockMatters[idx] = { ...matter, updated_at: new Date().toLocaleString() };
    }
  },

  async updateMatterStatus(id: string, status: string): Promise<void> {
    if (isTauri) {
      return invoke('update_matter_status', { id, status });
    }
    const m = mockMatters.find((item) => item.id === id);
    if (m) {
      m.status = status as any;
      m.updated_at = new Date().toLocaleString();
    }
  },

  async toggleMatterPinned(id: string): Promise<boolean> {
    if (isTauri) {
      return invoke('toggle_matter_pinned', { id });
    }
    const m = mockMatters.find((item) => item.id === id);
    if (m) {
      m.is_pinned = !m.is_pinned;
      return m.is_pinned;
    }
    return false;
  },

  async deleteMatter(id: string): Promise<void> {
    if (isTauri) {
      return invoke('delete_matter', { id });
    }
    mockMatters = mockMatters.filter((m) => m.id !== id);
  },

  // 日志
  async getLogsByMatter(matterId: string): Promise<LogItem[]> {
    if (isTauri) {
      return invoke('get_logs_by_matter', { matterId });
    }
    return mockLogs.filter((l) => l.matter_id === matterId);
  },

  async createLog(matterId?: string, rawContent: string = '', sourceApp?: string, sourceWindowTitle?: string): Promise<LogItem> {
    if (isTauri) {
      return invoke('create_log', { matterId, rawContent, sourceApp, sourceWindowTitle });
    }
    const log: LogItem = {
      id: 'l_' + Date.now(),
      matter_id: matterId,
      raw_content: rawContent,
      source_app: sourceApp || '网页录入',
      source_window_title: sourceWindowTitle || '',
      created_at: new Date().toLocaleString(),
    };
    mockLogs.unshift(log);
    return log;
  },

  async deleteLog(id: string): Promise<void> {
    if (isTauri) {
      return invoke('delete_log', { id });
    }
    mockLogs = mockLogs.filter((l) => l.id !== id);
  },

  // AI 收件箱
  async getInboxLogs(): Promise<InboxLogItem[]> {
    if (isTauri) {
      return invoke('get_inbox_logs');
    }
    return mockLogs.map((l) => {
      const targetMatter = mockMatters.find((m) => m.id === l.matter_id);
      const todos = mockTodos.filter((t) => t.log_id === l.id);
      return {
        id: l.id,
        matter_id: l.matter_id,
        matter_title: targetMatter?.title,
        raw_content: l.raw_content,
        source_app: l.source_app,
        source_window_title: l.source_window_title,
        created_at: l.created_at,
        todos,
      };
    });
  },

  async categorizeInboxLog(payload: CategorizePayload): Promise<void> {
    if (isTauri) {
      return invoke('categorize_inbox_log', { payload });
    }
    const log = mockLogs.find((l) => l.id === payload.log_id);
    if (log) {
      if (payload.choice === 'EXISTING' && payload.matter_id) {
        log.matter_id = payload.matter_id;
      } else if (payload.choice === 'CREATE_NEW' && payload.new_matter) {
        const newM = await this.createMatter({
          title: payload.new_matter.title,
          category: payload.new_matter.category,
          priority: payload.new_matter.priority,
          overview: payload.new_matter.summary,
          fact_summary: payload.extracted_facts_delta,
        });
        log.matter_id = newM.id;
      }
      for (const t of payload.new_todos) {
        await this.createTodo({
          matterId: log.matter_id!,
          content: t.content,
          dueTime: t.due_time,
          logId: log.id,
        });
      }
    }
  },

  async uncategorizeLog(payload: UncategorizePayload): Promise<void> {
    if (isTauri) {
      return invoke('uncategorize_log', { payload });
    }
    const log = mockLogs.find((l) => l.id === payload.log_id);
    if (log) {
      log.matter_id = undefined;
    }
    mockTodos = mockTodos.filter((t) => t.log_id !== payload.log_id);
  },

  async recategorizeLog(payload: RecategorizePayload): Promise<void> {
    if (isTauri) {
      return invoke('recategorize_log', { payload });
    }
    await this.uncategorizeLog({
      log_id: payload.log_id,
      matter_id: payload.old_matter_id,
      facts_delta: payload.old_facts_delta,
      todo_updates: payload.old_todo_updates,
    });
    await this.categorizeInboxLog({
      log_id: payload.log_id,
      choice: payload.choice,
      matter_id: payload.new_matter_id,
      new_matter: payload.new_matter,
      extracted_facts_delta: payload.new_facts_delta,
      new_todos: payload.new_todos,
    });
  },

  // 待办
  async getTodosByMatter(matterId: string): Promise<TodoItem[]> {
    if (isTauri) {
      return invoke('get_todos_by_matter', { matterId });
    }
    return mockTodos.filter((t) => t.matter_id === matterId);
  },

  async getAllTodos(statusFilter?: string): Promise<TodoItem[]> {
    if (isTauri) {
      return invoke('get_all_todos', { statusFilter });
    }
    let list = [...mockTodos];
    if (statusFilter && statusFilter !== 'all') {
      list = list.filter((t) => t.status === statusFilter);
    }
    return list;
  },

  async createTodo(params: {
    matterId: string;
    content: string;
    dueTime?: string;
    reminderTime?: string;
    logId?: string;
  }): Promise<TodoItem> {
    const cleanDue = normalizeTodoTime(params.dueTime);
    const cleanReminder = normalizeTodoTime(params.reminderTime) || cleanDue;
    const cleanParams = {
      ...params,
      dueTime: cleanDue,
      reminderTime: cleanReminder,
    };
    if (isTauri) {
      return invoke('create_todo', cleanParams);
    }
    const todo: TodoItem = {
      id: 't_' + Date.now(),
      matter_id: cleanParams.matterId,
      content: cleanParams.content,
      due_time: cleanParams.dueTime,
      reminder_time: cleanParams.reminderTime || cleanParams.dueTime,
      is_reminder_sent: false,
      status: 'pending',
      is_focused: false,
      created_at: new Date().toLocaleString(),
    };
    mockTodos.unshift(todo);
    return todo;
  },

  async toggleTodoStatus(id: string, completed: boolean): Promise<void> {
    if (isTauri) {
      return invoke('toggle_todo_status', { id, completed });
    }
    const t = mockTodos.find((item) => item.id === id);
    if (t) {
      t.status = completed ? 'completed' : 'pending';
      t.completed_at = completed ? new Date().toLocaleString() : undefined;
    }
  },

  async toggleTodoFocus(id: string): Promise<boolean> {
    if (isTauri) {
      return invoke('toggle_todo_focus', { id });
    }
    const t = mockTodos.find((item) => item.id === id);
    if (t) {
      t.is_focused = !t.is_focused;
      return t.is_focused;
    }
    return false;
  },

  async updateTodoReminder(id: string, reminderTime?: string): Promise<void> {
    const cleanReminder = normalizeTodoTime(reminderTime);
    if (isTauri) {
      return invoke('update_todo_reminder', { id, reminderTime: cleanReminder });
    }
    const t = mockTodos.find((item) => item.id === id);
    if (t) {
      t.reminder_time = cleanReminder;
      t.is_reminder_sent = false;
    }
  },

  async updateTodo(params: {
    id: string;
    content: string;
    dueTime?: string;
    reminderTime?: string;
  }): Promise<void> {
    const cleanDue = normalizeTodoTime(params.dueTime);
    const cleanReminder = normalizeTodoTime(params.reminderTime) || cleanDue;
    if (isTauri) {
      return invoke('update_todo', {
        id: params.id,
        content: params.content,
        dueTime: cleanDue,
        reminderTime: cleanReminder,
      });
    }
    const t = mockTodos.find((item) => item.id === params.id);
    if (t) {
      t.content = params.content;
      t.due_time = cleanDue;
      t.reminder_time = cleanReminder || cleanDue;
      t.is_reminder_sent = false;
    }
  },

  async deleteTodo(id: string): Promise<void> {
    if (isTauri) {
      return invoke('delete_todo', { id });
    }
    mockTodos = mockTodos.filter((t) => t.id !== id);
  },

  // 配置
  async getAppConfig(): Promise<AppConfig> {
    if (isTauri) {
      return invoke('get_app_config');
    }
    return mockConfig;
  },

  async saveAppConfig(config: AppConfig): Promise<void> {
    if (isTauri) {
      return invoke('save_app_config', { config });
    }
    mockConfig = { ...config };
  },

  // 划选与 AI 意图分析
  async triggerCaptureAndAnalyze(): Promise<AIParseResult> {
    if (isTauri) {
      return invoke('trigger_capture_and_analyze');
    }
    // 浏览器模拟返回
    return {
      action: 'MATCH_EXISTING',
      confidence: 0.88,
      matched_matter_id: 'm_001',
      matched_matter_title: 'A银行系统技术架构白皮书交付',
      candidate_matters: [],
      suggested_new_matter: undefined,
      extracted_facts_delta: '• 补充条款: 压测指标已确认通过5000 TPS要求',
      extracted_todos: [
        {
          content: '准备周三向张总汇报的技术架构材料',
          due_time: '2026-09-23 10:00:00',
        },
      ],
      raw_snippet: '张总在企微群强调周三上午10点前提交白皮书终版，请把性能指标章节补全。',
      source_app: '企业微信',
      source_window: 'A银行交付项目组',
    };
  },

  async processCapturedContext(captured: CapturedContext): Promise<AIParseResult> {
    if (isTauri) {
      return invoke('process_captured_context', { captured });
    }
    return this.triggerCaptureAndAnalyze();
  },

  async manualParseText(text: string, sourceApp?: string, sourceWindow?: string): Promise<AIParseResult> {
    if (isTauri) {
      return invoke('manual_parse_text', { text, sourceApp, sourceWindow });
    }
    return this.triggerCaptureAndAnalyze();
  },

  async confirmRouteDecision(payload: ConfirmRoutePayload): Promise<void> {
    if (isTauri) {
      return invoke('confirm_route_decision', { payload });
    }
    // mock 写入
    if (payload.choice === 'EXISTING' && payload.matter_id) {
      const log = await this.createLog(payload.matter_id, payload.raw_snippet, payload.source_app, payload.source_window);
      for (const t of payload.extracted_todos) {
        await this.createTodo({
          matterId: payload.matter_id,
          content: t.content,
          dueTime: t.due_time,
          logId: log.id,
        });
      }
      if (payload.todo_updates) {
        for (const u of payload.todo_updates) {
          if (u.action === 'CLOSE') {
            await this.toggleTodoStatus(u.todo_id, true);
          }
        }
      }
    }
  },

  async undoTodoUpdate(todoId: string, action: string, previousContent?: string, previousDueTime?: string): Promise<void> {
    if (isTauri) {
      return invoke('undo_todo_update', { todoId, action, previousContent, previousDueTime });
    }
    if (action === 'CLOSE') {
      const t = mockTodos.find((item) => item.id === todoId);
      if (t) {
        t.status = 'pending';
        t.completed_at = undefined;
      }
    } else if (action === 'UPDATE' && previousContent) {
      const t = mockTodos.find((item) => item.id === todoId);
      if (t) {
        t.content = previousContent;
        t.due_time = previousDueTime;
      }
    }
  },

  async summarizeMatterFacts(matterId: string): Promise<string> {
    if (isTauri) {
      return invoke('summarize_matter_facts', { matterId });
    }
    const matter = mockMatters.find((m) => m.id === matterId);
    const logs = mockLogs.filter((l) => l.matter_id === matterId);
    if (!matter) throw new Error('未找到该事项');
    if (logs.length === 0) {
      return matter.fact_summary || '• 暂无相关日志记录，尚未沉淀事实。';
    }
    const facts = logs.map((l, i) => `• 事实纪要 ${i + 1}: ${l.raw_content}`).join('\n');
    matter.fact_summary = facts;
    return facts;
  },

  async hideHudWindow(): Promise<void> {
    if (isTauri) {
      return invoke('hide_hud_window');
    }
  },

  async resizeHudWindow(mode: 'capsule' | 'expanded' | 'reminder'): Promise<void> {
    if (isTauri) {
      return invoke('resize_hud_window', { mode });
    }
  },

  async showMainWindow(): Promise<void> {
    if (isTauri) {
      return invoke('show_main_window');
    }
  },

  async enterCompactMode(): Promise<CompactDockState> {
    if (isTauri) {
      return invoke('enter_compact_mode');
    }
    return { edge: 'top', is_hidden: false, is_locked: false };
  },

  async exitCompactMode(): Promise<void> {
    if (isTauri) {
      return invoke('exit_compact_mode');
    }
  },

  async compactSlideIn(): Promise<CompactDockState> {
    if (isTauri) {
      return invoke('compact_slide_in');
    }
    return { edge: 'top', is_hidden: true, is_locked: false };
  },

  async compactSlideOut(): Promise<CompactDockState> {
    if (isTauri) {
      return invoke('compact_slide_out');
    }
    return { edge: 'top', is_hidden: false, is_locked: false };
  },

  async updateCompactDockState(): Promise<CompactDockState> {
    if (isTauri) {
      return invoke('update_compact_dock_state');
    }
    return { edge: 'top', is_hidden: false, is_locked: false };
  },

  async getCompactDockState(): Promise<CompactDockState> {
    if (isTauri) {
      return invoke('get_compact_dock_state');
    }
    return { edge: 'top', is_hidden: false, is_locked: false };
  },

  async toggleCompactDockLock(): Promise<CompactDockState> {
    if (isTauri) {
      return invoke('toggle_compact_dock_lock');
    }
    return { edge: 'top', is_hidden: false, is_locked: false };
  },

  async setCompactBusy(busy: boolean): Promise<void> {
    if (isTauri) {
      return invoke('set_compact_busy', { busy });
    }
  },

  async startDraggingWindow(): Promise<void> {
    if (isTauri) {
      return invoke('start_dragging_window');
    }
  },

  async isAutostartEnabled(): Promise<boolean> {
    if (isTauri) {
      return invoke('is_autostart_enabled');
    }
    return true;
  },

  async setAutostart(enabled: boolean): Promise<void> {
    if (isTauri) {
      return invoke('set_autostart', { enabled });
    }
  },
};
