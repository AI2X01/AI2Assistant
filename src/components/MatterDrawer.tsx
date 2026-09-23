import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Clock,
  Sparkles,
  CheckCircle2,
  Circle,
  Send,
  Bookmark,
  Calendar,
  Edit3,
  Trash2,
} from 'lucide-react';
import { Matter, LogItem, TodoItem } from '../types';
import { api, normalizeTodoTime } from '../services/api';
import { EditMatterModal } from './EditMatterModal';
import { StructuredFactsView } from './StructuredFactsView';
import { ConfirmModal } from './ConfirmModal';
import { listen } from '@tauri-apps/api/event';

interface MatterDrawerProps {
  matter: Matter | null;
  onClose: () => void;
  onRefreshMatters: () => void;
}

export const MatterDrawer: React.FC<MatterDrawerProps> = ({
  matter,
  onClose,
  onRefreshMatters,
}) => {
  if (!matter) return null;

  const [currentMatter, setCurrentMatter] = useState<Matter>(matter);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [activeTab, setActiveTab] = useState<'todos' | 'facts' | 'timeline'>('todos');

  // 新增输入态
  const [newLogContent, setNewLogContent] = useState('');
  const [newTodoContent, setNewTodoContent] = useState('');
  const [newTodoDue, setNewTodoDue] = useState('');
  const [factDraft, setFactDraft] = useState(matter.fact_summary || '');
  const [isEditingFact, setIsEditingFact] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [extractingLogId, setExtractingLogId] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // 待办删除二次确认状态
  const [todoToDelete, setTodoToDelete] = useState<TodoItem | null>(null);
  const [isDeletingTodo, setIsDeletingTodo] = useState(false);

  // 事项删除二次确认状态
  const [isDeleteMatterOpen, setIsDeleteMatterOpen] = useState(false);
  const [isDeletingMatter, setIsDeletingMatter] = useState(false);

  useEffect(() => {
    setCurrentMatter(matter);
    setFactDraft(matter.fact_summary || '');
    loadDetails(matter.id);
  }, [matter.id]);

  useEffect(() => {
    const unlisten = listen('refresh-data', () => {
      loadDetails(matter.id);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [matter.id]);

  const loadDetails = async (id: string) => {
    try {
      const [l, t, m] = await Promise.all([
        api.getLogsByMatter(id),
        api.getTodosByMatter(id),
        api.getMatterById(id),
      ]);
      setLogs(l);
      setTodos(t);
      if (m) {
        setCurrentMatter(m);
        setFactDraft((prev) => (isEditingFact ? prev : (m.fact_summary || '')));
      }
    } catch (e) {
      console.error('加载事项详情失败', e);
    }
  };

  // 添加新日志
  const handleAddLog = async () => {
    if (!newLogContent.trim()) return;
    try {
      await api.createLog(currentMatter.id, newLogContent.trim(), '手动记录', '主看板抽屉');
      setNewLogContent('');
      await loadDetails(currentMatter.id);
      onRefreshMatters();
    } catch (e) {
      console.error('添加日志失败', e);
    }
  };

  // 添加新待办
  const handleAddTodo = async () => {
    if (!newTodoContent.trim()) return;
    try {
      await api.createTodo({
        matterId: currentMatter.id,
        content: newTodoContent.trim(),
        dueTime: newTodoDue ? newTodoDue.replace('T', ' ') + ':00' : undefined,
      });
      setNewTodoContent('');
      setNewTodoDue('');
      await loadDetails(currentMatter.id);
      onRefreshMatters();
    } catch (e) {
      console.error('添加待办失败', e);
    }
  };

  // 勾选待办
  const handleToggleTodo = async (todo: TodoItem) => {
    const nextCompleted = todo.status === 'pending';
    await api.toggleTodoStatus(todo.id, nextCompleted);
    await loadDetails(currentMatter.id);
    onRefreshMatters();
  };

  // 待办编辑态
  const [editingTodoId, setEditingTodoId] = useState<string | null>(null);
  const [editTodoContent, setEditTodoContent] = useState('');
  const [editTodoDue, setEditTodoDue] = useState('');

  // 待办聚焦
  const handleToggleFocus = async (todo: TodoItem) => {
    await api.toggleTodoFocus(todo.id);
    await loadDetails(currentMatter.id);
  };

  // 开始编辑待办
  const handleStartEditTodo = (todo: TodoItem) => {
    setEditingTodoId(todo.id);
    setEditTodoContent(todo.content);
    const normalizedDue = normalizeTodoTime(todo.due_time);
    if (normalizedDue) {
      setEditTodoDue(normalizedDue.replace(' ', 'T').slice(0, 16));
    } else {
      setEditTodoDue('');
    }
  };

  // 取消编辑待办
  const handleCancelEditTodo = () => {
    setEditingTodoId(null);
    setEditTodoContent('');
    setEditTodoDue('');
  };

  // 保存待办编辑
  const handleSaveEditTodo = async (id: string) => {
    if (!editTodoContent.trim()) return;
    try {
      const dueTime = editTodoDue
        ? editTodoDue.replace('T', ' ') + (editTodoDue.length === 16 ? ':00' : '')
        : undefined;
      await api.updateTodo({
        id,
        content: editTodoContent.trim(),
        dueTime,
      });
      setEditingTodoId(null);
      await loadDetails(currentMatter.id);
      onRefreshMatters();
    } catch (e) {
      console.error('更新待办失败', e);
    }
  };

  // 请求删除待办（触发二次确认）
  const handleRequestDeleteTodo = (todo: TodoItem) => {
    setTodoToDelete(todo);
  };

  // 执行确认删除待办
  const handleConfirmDeleteTodo = async () => {
    if (!todoToDelete) return;
    setIsDeletingTodo(true);
    try {
      await api.deleteTodo(todoToDelete.id);
      if (editingTodoId === todoToDelete.id) {
        handleCancelEditTodo();
      }
      setTodoToDelete(null);
      await loadDetails(currentMatter.id);
      onRefreshMatters();
    } catch (e) {
      console.error('删除待办失败', e);
    } finally {
      setIsDeletingTodo(false);
    }
  };

  // 确认彻底删除整个事项
  const handleConfirmDeleteMatter = async () => {
    setIsDeletingMatter(true);
    try {
      await api.deleteMatter(currentMatter.id);
      setIsDeleteMatterOpen(false);
      onClose();
      onRefreshMatters();
    } catch (e) {
      console.error('删除事项失败', e);
    } finally {
      setIsDeletingMatter(false);
    }
  };

  // 从单条归集日志中智能提炼待办与更新总结建议（与“重新提炼”保持完全统一）
  const handleExtractTodosAndFacts = async (log: LogItem) => {
    setExtractingLogId(log.id);
    try {
      // 统一调用后端服务：抽取有效行动项为待办，并全面重新提炼【事项总结与推进建议】
      const result = await api.extractLogTodosAndSummarize(currentMatter.id, log.id);

      if (result.new_fact_summary) {
        setFactDraft(result.new_fact_summary);
        setCurrentMatter((prev) => ({ ...prev, fact_summary: result.new_fact_summary }));
      }

      await loadDetails(currentMatter.id);
      onRefreshMatters();

      // 若成功识别并提取出新待办，自动切换至待办清单 Tab 供用户即时检查
      if (result.added_todos_count > 0) {
        setActiveTab('todos');
      }
    } catch (e: any) {
      console.error('提炼待办与更新总结建议失败:', e);
      alert(`提炼失败: ${e?.message || e || '请检查网络或模型配置'}`);
    } finally {
      setExtractingLogId(null);
    }
  };

  // 保存事实摘要修改
  const handleSaveFacts = async () => {
    const updated = { ...currentMatter, fact_summary: factDraft };
    await api.updateMatter(updated);
    setCurrentMatter(updated);
    setIsEditingFact(false);
    onRefreshMatters();
  };

  // AI 智能重提炼核心事实
  const handleAISummarize = async () => {
    if (logs.length === 0) {
      alert('当前事项尚无任何碎片日志记录，请先在时间轴中添加日志后再提炼。');
      return;
    }
    setIsSummarizing(true);
    try {
      const summarizedFacts = await api.summarizeMatterFacts(currentMatter.id);
      if (summarizedFacts) {
        setFactDraft(summarizedFacts);
        const updated = { ...currentMatter, fact_summary: summarizedFacts };
        setCurrentMatter(updated);
        onRefreshMatters();
      }
    } catch (e: any) {
      console.error('AI 提炼事实沉淀失败:', e);
      alert(`提炼失败: ${e?.message || e || '请检查日志或网络配置'}`);
    } finally {
      setIsSummarizing(false);
    }
  };

  // 事项状态操作
  const handleStatusChange = async (newStatus: string) => {
    await api.updateMatterStatus(currentMatter.id, newStatus);
    setCurrentMatter({ ...currentMatter, status: newStatus as any });
    onRefreshMatters();
  };

  // 支持点击非抽屉遮罩区域自动收起
  const isMouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 若编辑模态框未打开，按 ESC 键收起抽屉
      if (e.key === 'Escape' && !isEditModalOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditModalOpen, onClose]);

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isMouseDownOnBackdrop.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMouseDownOnBackdrop.current && e.target === e.currentTarget) {
      onClose();
    }
    isMouseDownOnBackdrop.current = false;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/45 dark:bg-black/70 backdrop-blur-sm dark:backdrop-blur-md transition-opacity animate-in fade-in duration-200"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200/90 dark:border-slate-700/80 ring-1 ring-slate-900/5 dark:ring-white/10 shadow-[-20px_0_50px_-10px_rgba(15,23,42,0.35),-8px_0_20px_-5px_rgba(15,23,42,0.15)] dark:shadow-[-30px_0_80px_rgba(0,0,0,0.95),-10px_0_30px_rgba(0,0,0,0.8),-1px_0_0_rgba(255,255,255,0.08)] flex flex-col justify-between animate-in slide-in-from-right duration-300 relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 左竖边立体微光层次线 */}
        <div className="absolute left-0 top-0 bottom-0 w-[1px] bg-gradient-to-b from-white/90 via-white/30 to-white/70 dark:from-slate-700/60 dark:via-slate-800/30 dark:to-slate-700/50 pointer-events-none z-20" />

        {/* 抽屉头部 */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-300">
                {currentMatter.category === 'work' ? '工作事项' : '生活事项'}
              </span>
              <select
                value={currentMatter.status}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="text-xs font-semibold px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 outline-none"
              >
                <option value="active">进行中 (Active)</option>
                <option value="pending">已挂起 (Pending)</option>
                <option value="completed">已完成 (Completed)</option>
                <option value="archived">已归档 (Archived)</option>
              </select>
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white leading-tight">
              {currentMatter.title}
            </h2>

            {currentMatter.related_contacts && currentMatter.related_contacts.trim() && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                <span className="text-[11px] text-slate-400 font-medium">关联人/群:</span>
                {currentMatter.related_contacts
                  .split(/[,，、;； ]+/)
                  .filter(Boolean)
                  .map((c, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-[11px] font-medium rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50"
                    >
                      @{c}
                    </span>
                  ))}
              </div>
            )}

            {currentMatter.overview && (
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                {currentMatter.overview}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="px-2.5 py-1.5 rounded-xl text-slate-600 dark:text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-sky-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1.5 text-xs font-semibold border border-slate-200 dark:border-slate-700 cursor-pointer"
              title="编辑事项信息"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>编辑</span>
            </button>
            <button
              onClick={() => setIsDeleteMatterOpen(true)}
              className="px-2.5 py-1.5 rounded-xl text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all flex items-center gap-1 text-xs font-semibold border border-slate-200 dark:border-slate-700 cursor-pointer"
              title="彻底删除此事项"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>删除</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab 导航：调整为 待办 > 决策 > 日志 */}
        <div className="px-6 border-b border-slate-200 dark:border-slate-800 flex items-center gap-6 text-xs font-bold shrink-0">
          <button
            onClick={() => setActiveTab('todos')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'todos'
              ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            待办清单 ({todos.filter((t) => t.status === 'pending').length}/{todos.length})
          </button>
          <button
            onClick={() => setActiveTab('facts')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'facts'
              ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            总结与建议
          </button>
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 cursor-pointer ${activeTab === 'timeline'
              ? 'border-sky-600 text-sky-600 dark:text-sky-400 font-bold'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
          >
            <Clock className="w-3.5 h-3.5" />
            归集日志 ({logs.length})
          </button>
        </div>

        {/* 抽屉内容主体：按 待办 > 决策 > 日志 顺序渲染 */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-6">
          {/* TAB 1: 关联待办清单 */}
          {activeTab === 'todos' && (
            <div className="space-y-4">
              {/* 快速新增待办 */}
              <div className="bg-slate-50 dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <input
                  type="text"
                  value={newTodoContent}
                  onChange={(e) => setNewTodoContent(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddTodo()}
                  placeholder="添加新的待办项..."
                  className="w-full px-2 py-1 text-xs bg-transparent outline-none text-slate-800 dark:text-white placeholder-slate-400"
                />
                <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="datetime-local"
                      value={newTodoDue}
                      onChange={(e) => setNewTodoDue(e.target.value)}
                      className="text-[11px] bg-transparent text-slate-600 dark:text-slate-300 outline-none"
                    />
                  </div>
                  <button
                    onClick={handleAddTodo}
                    className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold"
                  >
                    添加待办
                  </button>
                </div>
              </div>

              {/* 待办列表 */}
              <div className="space-y-2">
                {todos.map((todo) => {
                  const isDone = todo.status === 'completed';
                  const isEditing = editingTodoId === todo.id;

                  if (isEditing) {
                    return (
                      <div
                        key={todo.id}
                        className="p-3 rounded-xl border border-sky-400/80 dark:border-sky-500 bg-sky-50/40 dark:bg-sky-950/20 space-y-2.5 transition-all shadow-xs"
                      >
                        <input
                          type="text"
                          value={editTodoContent}
                          onChange={(e) => setEditTodoContent(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEditTodo(todo.id);
                            if (e.key === 'Escape') handleCancelEditTodo();
                          }}
                          placeholder="待办内容..."
                          autoFocus
                          className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg outline-none focus:border-sky-500 text-slate-800 dark:text-white"
                        />
                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <div className="flex items-center gap-1.5 flex-1 min-w-0">
                            <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                            <input
                              type="datetime-local"
                              value={editTodoDue}
                              onChange={(e) => setEditTodoDue(e.target.value)}
                              className="text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded text-slate-600 dark:text-slate-300 outline-none w-full max-w-[170px]"
                            />
                            {editTodoDue && (
                              <button
                                type="button"
                                onClick={() => setEditTodoDue('')}
                                className="text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1 py-0.5"
                                title="清空截止时间"
                              >
                                清除
                              </button>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              onClick={handleCancelEditTodo}
                              className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 rounded-lg transition-all"
                            >
                              取消
                            </button>
                            <button
                              onClick={() => handleSaveEditTodo(todo.id)}
                              className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs font-semibold shadow-xs transition-all"
                            >
                              保存
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={todo.id}
                      className={`group flex items-center justify-between p-3 rounded-xl border transition-all ${isDone
                        ? 'bg-slate-50/50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 opacity-60'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 shadow-xs'
                        }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <button
                          onClick={() => handleToggleTodo(todo)}
                          className={`shrink-0 transition-transform active:scale-90 ${isDone ? 'text-emerald-500' : 'text-slate-400 hover:text-slate-600'
                            }`}
                        >
                          {isDone ? <CheckCircle2 className="w-4 h-4 fill-emerald-500 text-white" /> : <Circle className="w-4 h-4" />}
                        </button>
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onDoubleClick={() => handleStartEditTodo(todo)}
                          title="双击编辑待办"
                        >
                          <span
                            className={`text-xs font-medium leading-tight block break-words ${isDone ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'
                              }`}
                          >
                            {todo.content}
                          </span>
                          {todo.due_time && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                              <Clock className="w-2.5 h-2.5 shrink-0" />
                              截止/提醒: {normalizeTodoTime(todo.due_time)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0 ml-2">
                        {/* 编辑按钮 */}
                        <button
                          onClick={() => handleStartEditTodo(todo)}
                          className="p-1 rounded-md text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-slate-700/80 opacity-60 group-hover:opacity-100 transition-all"
                          title="编辑待办"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>

                        {/* 删除按钮 */}
                        <button
                          onClick={() => handleRequestDeleteTodo(todo)}
                          className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-slate-700/80 opacity-60 group-hover:opacity-100 transition-all cursor-pointer"
                          title="删除待办"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>

                        {/* 聚焦按钮 */}
                        <button
                          onClick={() => handleToggleFocus(todo)}
                          className={`p-1 rounded-md transition-all ${todo.is_focused
                            ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/60'
                            : 'text-slate-300 hover:text-amber-400'
                            }`}
                          title={todo.is_focused ? '取消聚焦' : '标记为核心聚焦待办'}
                        >
                          <Bookmark className="w-3.5 h-3.5 fill-current" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: 总结与建议 */}
          {activeTab === 'facts' && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800/80">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                    根据识别日志言简意赅总结，并持续提供推进建议
                  </span>
                </div>
                <button
                  onClick={handleAISummarize}
                  disabled={isSummarizing}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 rounded-lg transition-all cursor-pointer shadow-2xs active:scale-95"
                  title="根据整体日志重新提炼生成总结与建议"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isSummarizing ? 'animate-spin' : ''}`} />
                  {isSummarizing ? 'AI 提炼中...' : '重新提炼'}
                </button>
              </div>

              {isEditingFact ? (
                <div className="space-y-2.5 p-3.5 rounded-2xl bg-slate-50/90 dark:bg-slate-800/90 border border-sky-300 dark:border-sky-600/60 animate-in fade-in duration-150 shadow-xs">
                  <div className="flex flex-wrap items-center justify-between gap-1.5">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      编辑总结与建议内容：
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setFactDraft((prev) => (prev ? prev + '\n\n【事项总结】\n• 核心进展: ' : '【事项总结】\n• 核心进展: '))}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-sky-100 dark:bg-sky-950/80 text-sky-700 dark:text-sky-300 hover:bg-sky-200 cursor-pointer font-medium"
                      >
                        + 事项总结
                      </button>
                      <button
                        type="button"
                        onClick={() => setFactDraft((prev) => (prev ? prev + '\n\n【推进建议】\n• 推进动作: ' : '【推进建议】\n• 推进动作: '))}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 hover:bg-amber-200 cursor-pointer font-medium"
                      >
                        + 推进建议
                      </button>
                      <button
                        type="button"
                        onClick={() => setFactDraft((prev) => (prev ? prev + '\n• 风险提示: ' : '• 风险提示: '))}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 hover:bg-rose-200 cursor-pointer font-medium"
                      >
                        + 风险提示
                      </button>
                      <button
                        type="button"
                        onClick={() => setFactDraft((prev) => (prev ? prev + '\n• 关键指标: ' : '• 关键指标: '))}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 cursor-pointer font-medium"
                      >
                        + 关键指标
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={12}
                    value={factDraft}
                    onChange={(e) => setFactDraft(e.target.value)}
                    placeholder="【事项总结】&#10;• 核心进展: 明确当前阶段与最新共识...&#10;• 关键指标: 量化数据与商务约束...&#10;&#10;【推进建议】&#10;• 推进动作: 下一步应落实的核心行动...&#10;• 风险防范: 需核查与注意的隐患..."
                    className="w-full p-3 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 outline-none leading-relaxed focus:ring-1 focus:ring-sky-500 shadow-inner"
                  />

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-slate-400">
                      保存后将自动应用结构化视图与要素高亮
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setFactDraft(currentMatter.fact_summary || '');
                          setIsEditingFact(false);
                        }}
                        className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleSaveFacts}
                        className="px-4 py-1.5 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg shadow-sm active:scale-95 transition-all cursor-pointer"
                      >
                        保存修改
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <StructuredFactsView
                  factSummary={currentMatter.fact_summary}
                  onEdit={() => {
                    setFactDraft(currentMatter.fact_summary || '');
                    setIsEditingFact(true);
                  }}
                  onRefreshSummarize={handleAISummarize}
                  isSummarizing={isSummarizing}
                />
              )}
            </div>
          )}

          {/* TAB 3: 归集日志 */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              {/* 快速追加日志 */}
              <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800/80 p-2 rounded-xl border border-slate-200 dark:border-slate-700">
                <input
                  type="text"
                  value={newLogContent}
                  onChange={(e) => setNewLogContent(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddLog()}
                  placeholder="手动添加一条工作日志或碎片信息..."
                  className="flex-1 px-3 py-1.5 text-xs bg-transparent outline-none text-slate-800 dark:text-white placeholder-slate-400"
                />
                <button
                  onClick={handleAddLog}
                  className="p-2 rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-all shadow-sm"
                  title="发送记录"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 时间轴流 */}
              {logs.length === 0 ? (
                <div className="text-center py-12 text-slate-400 text-xs">
                  暂无日志记录，可在外部应用中划选文字并按 Alt+A 快速收集。
                </div>
              ) : (
                <div className="relative pl-6 space-y-5 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
                  {logs.map((log) => (
                    <div key={log.id} className="relative group">
                      {/* 时间轴圆点 */}
                      <div className="absolute -left-6 top-1.5 w-4 h-4 rounded-full bg-white dark:bg-slate-900 border-2 border-sky-500 flex items-center justify-center">
                        <div className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                      </div>

                      {/* 日志卡片 */}
                      <div className="bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 hover:border-sky-300 dark:hover:border-sky-800 transition-all">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                          <span className="font-semibold text-sky-600 dark:text-sky-400">
                            来自: {log.source_app} {log.source_window_title && log.source_window_title !== log.source_app ? `· ${log.source_window_title}` : ''}
                          </span>
                          <span>{log.created_at}</span>
                        </div>
                        <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                          {log.raw_content}
                        </p>
                        <div className="mt-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleExtractTodosAndFacts(log)}
                            disabled={extractingLogId === log.id}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:text-sky-700 dark:hover:text-sky-300 hover:bg-sky-50 dark:hover:bg-sky-950/50 rounded-lg transition-all cursor-pointer disabled:opacity-50"
                            title="由 AI 智能解析本条日志，抽取待办事项并更新总结与建议"
                          >
                            <Sparkles className={`w-3.5 h-3.5 ${extractingLogId === log.id ? 'animate-spin text-sky-500' : 'text-sky-500'}`} />
                            <span>{extractingLogId === log.id ? '正在提炼待办与建议...' : '提炼待办与建议'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 事项全量属性编辑模态弹窗 */}
      <EditMatterModal
        matter={currentMatter}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSuccess={(updated) => {
          setCurrentMatter(updated);
          setFactDraft(updated.fact_summary || '');
          onRefreshMatters();
        }}
      />

      {/* 待办删除二次确认弹窗 */}
      <ConfirmModal
        isOpen={!!todoToDelete}
        title="确认删除该待办事项？"
        description={
          todoToDelete ? (
            <div className="space-y-1">
              <div className="text-slate-700 dark:text-slate-200">
                待办内容：<span className="font-semibold text-rose-600 dark:text-rose-400">「{todoToDelete.content}」</span>
              </div>
              <p className="text-slate-400 text-[11px]">
                删除后将从该事项的待办清单中彻底移除，不可恢复。
              </p>
            </div>
          ) : null
        }
        confirmText="确认删除"
        danger={true}
        isLoading={isDeletingTodo}
        onConfirm={handleConfirmDeleteTodo}
        onClose={() => setTodoToDelete(null)}
      />

      {/* 事项彻底删除高危二次确认弹窗 */}
      <ConfirmModal
        isOpen={isDeleteMatterOpen}
        title={`确认彻底删除事项【${currentMatter.title}】？`}
        description={
          <div className="space-y-1.5">
            <p className="text-rose-600 dark:text-rose-400 font-semibold text-xs">
              ⚠️ 高危操作：该操作不可撤销！
            </p>
            <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
              删除此事项将同时清理该事项下的所有总结与建议、关联待办（共 {todos.length} 项）。
            </p>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              历史关联的原始碎片日志将安全保留并自动退回【待归接收件箱】。
            </p>
          </div>
        }
        confirmText="彻底删除"
        danger={true}
        isLoading={isDeletingMatter}
        onConfirm={handleConfirmDeleteMatter}
        onClose={() => setIsDeleteMatterOpen(false)}
      />
    </div>
  );
};
