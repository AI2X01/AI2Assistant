import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FolderInput,
  CheckCircle2,
  Calendar,
  Sparkles,
  ArrowRight,
  Trash2,
  CheckSquare,
  Square,
} from 'lucide-react';
import { InboxLogItem, Matter, ExtractedTodo, CategoryType, PriorityType, TodoUpdateSuggestion } from '../types';
import { api } from '../services/api';
import { emit } from '@tauri-apps/api/event';

interface CategorizeModalProps {
  log: InboxLogItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  matters: Matter[];
}

export const CategorizeModal: React.FC<CategorizeModalProps> = ({
  log,
  isOpen,
  onClose,
  onSuccess,
  matters,
}) => {
  if (!isOpen || !log) return null;

  const [mode, setMode] = useState<'EXISTING' | 'CREATE_NEW'>('EXISTING');
  const [selectedMatterId, setSelectedMatterId] = useState<string>('');
  
  // 新建事项字段
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState<CategoryType>('work');
  const [newPriority, setNewPriority] = useState<PriorityType>('medium');
  const [newSummary, setNewSummary] = useState('');
  const [newRelatedContacts, setNewRelatedContacts] = useState('');

  // 事实增量
  const [factDelta, setFactDelta] = useState('');

  // 提炼待办列表
  const [todos, setTodos] = useState<ExtractedTodo[]>([]);
  const [newTodoText, setNewTodoText] = useState('');
  const [newTodoDue, setNewTodoDue] = useState('');

  // 建议关闭/更新的已有待办
  const [todoUpdates, setTodoUpdates] = useState<{ update: TodoUpdateSuggestion; selected: boolean }[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (log && isOpen) {
      setError(null);
      // 默认选择第一个活跃事项
      const activeList = matters.filter((m) => m.status === 'active');
      if (activeList.length > 0) {
        setSelectedMatterId(activeList[0].id);
      } else if (matters.length > 0) {
        setSelectedMatterId(matters[0].id);
      }

      // 基于文本初探生成推荐标题
      const firstLine = log.raw_content.split(/[\n。！？!?；;]/)[0].trim();
      setNewTitle(firstLine.length > 25 ? `${firstLine.slice(0, 23)}...` : firstLine || '新收集事项');
      setNewSummary(log.raw_content.slice(0, 80));
      const defaultContacts =
        !log.source_window_title || log.source_window_title === '微信' || log.source_window_title === '未知应用'
          ? ''
          : log.source_window_title;
      setNewRelatedContacts(defaultContacts);
      setFactDelta(`• 来自[${log.source_app}]: ${firstLine}`);
      setTodos([]);
      setTodoUpdates([]);
      setNewTodoText('');
      setNewTodoDue('');
    }
  }, [log, isOpen, matters]);

  const handleAddTodo = () => {
    if (!newTodoText.trim()) return;
    setTodos([
      ...todos,
      {
        content: newTodoText.trim(),
        due_time: newTodoDue ? newTodoDue.replace('T', ' ') + ':00' : undefined,
      },
    ]);
    setNewTodoText('');
    setNewTodoDue('');
  };

  const handleRemoveTodo = (idx: number) => {
    setTodos(todos.filter((_, i) => i !== idx));
  };

  const handleAISuggest = async () => {
    if (!log) return;
    setLoading(true);
    try {
      const parsed = await api.manualParseText(log.raw_content, log.source_app, log.source_window_title);
      if (parsed.matched_matter_id) {
        setSelectedMatterId(parsed.matched_matter_id);
        setMode('EXISTING');
      } else if (parsed.suggested_new_matter) {
        setNewTitle(parsed.suggested_new_matter.title);
        setNewCategory(parsed.suggested_new_matter.category);
        setNewPriority(parsed.suggested_new_matter.priority);
        setNewSummary(parsed.suggested_new_matter.summary);
        if (parsed.suggested_new_matter.related_contacts) {
          setNewRelatedContacts(parsed.suggested_new_matter.related_contacts);
        }
      }
      if (parsed.extracted_facts_delta) {
        setFactDelta(parsed.extracted_facts_delta);
      }
      if (parsed.extracted_todos && parsed.extracted_todos.length > 0) {
        setTodos(parsed.extracted_todos);
      }
      if (parsed.todo_updates && parsed.todo_updates.length > 0) {
        setTodoUpdates(parsed.todo_updates.map((u) => ({ update: u, selected: true })));
      }
    } catch (e) {
      console.warn('AI 解析建议失败', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'EXISTING' && !selectedMatterId) {
      setError('请选择归集的目标事项');
      return;
    }
    if (mode === 'CREATE_NEW' && !newTitle.trim()) {
      setError('请输入新建事项的标题');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const confirmedUpdates = todoUpdates
        .filter((item) => item.selected)
        .map((item) => item.update);

      await api.categorizeInboxLog({
        log_id: log.id,
        choice: mode,
        matter_id: mode === 'EXISTING' ? selectedMatterId : undefined,
        new_matter:
          mode === 'CREATE_NEW'
            ? {
                title: newTitle.trim(),
                category: newCategory,
                priority: newPriority,
                summary: newSummary.trim(),
                related_contacts: newRelatedContacts.trim(),
              }
            : undefined,
        extracted_facts_delta: factDelta.trim() ? factDelta.trim() : undefined,
        new_todos: todos,
        todo_updates: confirmedUpdates,
      });

      await emit('refresh-data');
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('归集失败', err);
      setError(err?.message || '归集操作失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const isMouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 dark:bg-black/70 backdrop-blur-sm dark:backdrop-blur-md p-4 animate-in fade-in duration-150 select-none"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-700/80 ring-1 ring-slate-900/5 dark:ring-white/10 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.3),0_10px_25px_-5px_rgba(15,23,42,0.15)] dark:shadow-[0_30px_90px_rgba(0,0,0,0.9),0_12px_36px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.08)] overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
            <div className="w-8 h-8 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <FolderInput className="w-4 h-4" />
            </div>
            <span>手工归集到事项与待办</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 主体 */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}

          {/* 原始文本卡片预览 */}
          <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span className="font-semibold text-sky-600 dark:text-sky-400">
                来源: {log.source_app || '外部应用'} {log.source_window_title ? `· ${log.source_window_title}` : ''}
              </span>
              <span>{log.created_at}</span>
            </div>
            <p className="text-xs text-slate-700 dark:text-slate-200 max-h-24 overflow-y-auto leading-relaxed whitespace-pre-wrap">
              {log.raw_content}
            </p>
          </div>

          {/* 快速 AI 辅助建议按钮 */}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleAISuggest}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 rounded-lg transition-all"
            >
              <Sparkles className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>智能辅助提炼建议</span>
            </button>
          </div>

          {/* 归集模式切换 */}
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setMode('EXISTING')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === 'EXISTING'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              归集到已有事项
            </button>
            <button
              type="button"
              onClick={() => setMode('CREATE_NEW')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === 'CREATE_NEW'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
              }`}
            >
              创建全新事项并归集
            </button>
          </div>

          {/* 1. 归集到已有事项模式 */}
          {mode === 'EXISTING' && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                目标事项 <span className="text-rose-500">*</span>
              </label>
              {matters.length > 0 ? (
                <select
                  value={selectedMatterId}
                  onChange={(e) => setSelectedMatterId(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 outline-none"
                >
                  {matters.map((m) => (
                    <option key={m.id} value={m.id}>
                      【{m.category === 'work' ? '工作' : '生活'}】{m.title} ({m.status === 'active' ? '进行中' : m.status})
                    </option>
                  ))}
                </select>
              ) : (
                <div className="text-xs text-amber-500 p-2">
                  暂无现有事项，请切换至【创建全新事项并归集】
                </div>
              )}
            </div>
          )}

          {/* 2. 新建事项模式 */}
          {mode === 'CREATE_NEW' && (
            <div className="space-y-3 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  新事项标题 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="例如：新项目或跟进事项名称"
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-sky-500"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    关联人 / 关联群聊配置
                  </label>
                  <span className="text-[10px] text-slate-400">
                    用逗号或空格隔开
                  </span>
                </div>
                <input
                  type="text"
                  value={newRelatedContacts}
                  onChange={(e) => setNewRelatedContacts(e.target.value)}
                  placeholder="例如：潮汕话标注群, 陈伟豪, 李总"
                  className="w-full px-3 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-sky-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">分类</label>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={() => setNewCategory('work')}
                      className={`flex-1 py-1 rounded-lg text-xs font-semibold border ${
                        newCategory === 'work'
                          ? 'bg-sky-50 border-sky-300 text-sky-600'
                          : 'border-slate-200 text-slate-500'
                      }`}
                    >
                      工作
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewCategory('life')}
                      className={`flex-1 py-1 rounded-lg text-xs font-semibold border ${
                        newCategory === 'life'
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-600'
                          : 'border-slate-200 text-slate-500'
                      }`}
                    >
                      生活
                    </button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">优先级</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as PriorityType)}
                    className="w-full px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 outline-none"
                  >
                    <option value="high">高优先级</option>
                    <option value="medium">中优先级</option>
                    <option value="low">低优先级</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* 增量事实沉淀 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              追加沉淀到事实摘要 (可选)
            </label>
            <textarea
              rows={2}
              value={factDelta}
              onChange={(e) => setFactDelta(e.target.value)}
              placeholder="提取的事实将自动追加并融合到事项的核心事实中..."
              className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-sky-500 resize-none"
            />
          </div>

          {/* 提取与生成待办 */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>同时生成待办事项 ({todos.length}项)</span>
            </label>

            {/* 添加待办输入行 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newTodoText}
                onChange={(e) => setNewTodoText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTodo())}
                placeholder="输入待办项任务..."
                className="flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none"
              />
              <input
                type="datetime-local"
                value={newTodoDue}
                onChange={(e) => setNewTodoDue(e.target.value)}
                className="px-2 py-1.5 text-[11px] rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 outline-none"
              />
              <button
                type="button"
                onClick={handleAddTodo}
                className="px-3 py-1.5 bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 text-xs font-semibold rounded-xl hover:bg-sky-100"
              >
                添加
              </button>
            </div>

            {/* 待办展示列表 */}
            {todos.length > 0 && (
              <div className="space-y-1.5 max-h-32 overflow-y-auto">
                {todos.map((td, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                      <span className="font-medium text-slate-800 dark:text-slate-200">{td.content}</span>
                      {td.due_time && (
                        <span className="text-[10px] text-amber-500 flex items-center gap-0.5">
                          <Calendar className="w-2.5 h-2.5" />
                          {td.due_time}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveTodo(idx)}
                      className="text-slate-400 hover:text-rose-500 p-1"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* 建议关闭/更新的已有待办 */}
            {todoUpdates.length > 0 && (
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center justify-between">
                  <span>根据上下文建议更新/关闭已有待办 ({todoUpdates.length}项)</span>
                  <span className="text-[10px] text-slate-400 font-normal">点击切换是否执行</span>
                </label>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {todoUpdates.map((item, idx) => (
                    <div
                      key={item.update.todo_id}
                      onClick={() => {
                        const copy = [...todoUpdates];
                        copy[idx].selected = !copy[idx].selected;
                        setTodoUpdates(copy);
                      }}
                      className={`flex items-center justify-between p-2 rounded-xl border text-xs cursor-pointer transition-all select-none ${
                        item.selected
                          ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700 shadow-xs'
                          : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 opacity-60'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                        {item.selected ? (
                          <CheckSquare className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <div className="truncate">
                          <span className="font-semibold text-amber-700 dark:text-amber-300 mr-1">
                            {item.update.action === 'CLOSE' ? '【关闭待办】' : '【更新待办】'}
                          </span>
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {item.update.original_content}
                          </span>
                          <span className="text-[10px] text-slate-400 ml-1.5 hidden sm:inline">
                            ({item.update.reason})
                          </span>
                        </div>
                      </div>
                      <span className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold shrink-0">
                        {item.selected ? '将执行' : '已忽略'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 底部按钮 */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-xl shadow-sm shadow-sky-600/20 active:scale-95 transition-all"
            >
              <ArrowRight className="w-3.5 h-3.5" />
              <span>{loading ? '归集中...' : '确认归集并同步'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
