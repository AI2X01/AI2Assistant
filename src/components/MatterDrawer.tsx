import React, { useState, useEffect } from 'react';
import {
  X,
  Clock,
  Sparkles,
  CheckCircle2,
  Circle,
  Send,
  ArrowRight,
  Bookmark,
  Calendar,
} from 'lucide-react';
import { Matter, LogItem, TodoItem } from '../types';
import { api } from '../services/api';

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
  const [activeTab, setActiveTab] = useState<'timeline' | 'todos' | 'facts'>('timeline');

  // 新增输入态
  const [newLogContent, setNewLogContent] = useState('');
  const [newTodoContent, setNewTodoContent] = useState('');
  const [newTodoDue, setNewTodoDue] = useState('');
  const [factDraft, setFactDraft] = useState(matter.fact_summary || '');
  const [isEditingFact, setIsEditingFact] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);

  useEffect(() => {
    setCurrentMatter(matter);
    setFactDraft(matter.fact_summary || '');
    loadDetails(matter.id);
  }, [matter.id]);

  const loadDetails = async (id: string) => {
    try {
      const [l, t] = await Promise.all([
        api.getLogsByMatter(id),
        api.getTodosByMatter(id),
      ]);
      setLogs(l);
      setTodos(t);
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

  // 待办聚焦
  const handleToggleFocus = async (todo: TodoItem) => {
    await api.toggleTodoFocus(todo.id);
    await loadDetails(currentMatter.id);
  };

  // 日志一键转待办
  const handleLogToTodo = async (log: LogItem) => {
    await api.createTodo({
      matterId: currentMatter.id,
      content: log.raw_content,
      logId: log.id,
    });
    await loadDetails(currentMatter.id);
    onRefreshMatters();
  };

  // 保存事实摘要修改
  const handleSaveFacts = async () => {
    const updated = { ...currentMatter, fact_summary: factDraft };
    await api.updateMatter(updated);
    setCurrentMatter(updated);
    setIsEditingFact(false);
    onRefreshMatters();
  };

  // AI 智能重提炼
  const handleAISummarize = async () => {
    setIsSummarizing(true);
    try {
      // 拼接所有日志生成摘要
      const allText = logs.map((l) => l.raw_content).join('\n');
      if (allText) {
        const parsed = await api.manualParseText(allText);
        if (parsed.extracted_facts_delta) {
          const newFact = currentMatter.fact_summary
            ? `${currentMatter.fact_summary}\n${parsed.extracted_facts_delta}`
            : parsed.extracted_facts_delta;
          setFactDraft(newFact);
          const updated = { ...currentMatter, fact_summary: newFact };
          await api.updateMatter(updated);
          setCurrentMatter(updated);
        }
      }
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

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-xs transition-opacity animate-in fade-in duration-200">
      <div className="w-full max-w-xl h-full bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-300">
        {/* 抽屉头部 */}
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4">
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
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab 导航 */}
        <div className="px-6 border-b border-slate-200 dark:border-slate-800 flex items-center gap-6 text-xs font-bold">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'timeline'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            碎片日志时间轴 ({logs.length})
          </button>
          <button
            onClick={() => setActiveTab('todos')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'todos'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            事项待办清单 ({todos.filter((t) => t.status === 'pending').length}/{todos.length})
          </button>
          <button
            onClick={() => setActiveTab('facts')}
            className={`py-3 border-b-2 transition-all flex items-center gap-1.5 ${
              activeTab === 'facts'
                ? 'border-sky-600 text-sky-600 dark:text-sky-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-300'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            核心事实沉淀
          </button>
        </div>

        {/* 抽屉内容主体 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: 碎片时间轴 */}
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
                            来自: {log.source_app} {log.source_window_title ? `· ${log.source_window_title}` : ''}
                          </span>
                          <span>{log.created_at}</span>
                        </div>
                        <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                          {log.raw_content}
                        </p>
                        <div className="mt-3 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleLogToTodo(log)}
                            className="inline-flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400 hover:underline"
                          >
                            <ArrowRight className="w-3 h-3" />
                            抽取为待办
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: 关联待办清单 */}
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
                  return (
                    <div
                      key={todo.id}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                        isDone
                          ? 'bg-slate-50/50 dark:bg-slate-900/50 border-slate-100 dark:border-slate-800 opacity-60'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 shadow-xs'
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1">
                        <button
                          onClick={() => handleToggleTodo(todo)}
                          className={`shrink-0 transition-transform active:scale-90 ${
                            isDone ? 'text-emerald-500' : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          {isDone ? <CheckCircle2 className="w-4 h-4 fill-emerald-500 text-white" /> : <Circle className="w-4 h-4" />}
                        </button>
                        <div>
                          <span
                            className={`text-xs font-medium leading-tight block ${
                              isDone ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'
                            }`}
                          >
                            {todo.content}
                          </span>
                          {todo.due_time && (
                            <span className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-0.5">
                              <Clock className="w-2.5 h-2.5" />
                              截止/提醒: {todo.due_time}
                            </span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleToggleFocus(todo)}
                        className={`p-1 rounded-md transition-all ${
                          todo.is_focused
                            ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/60'
                            : 'text-slate-300 hover:text-amber-400'
                        }`}
                        title={todo.is_focused ? '取消聚焦' : '标记为核心聚焦待办'}
                      >
                        <Bookmark className="w-3.5 h-3.5 fill-current" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 3: 核心事实沉淀 */}
          {activeTab === 'facts' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                  自动融合的关键商务、财务、进度与共识
                </span>
                <button
                  onClick={handleAISummarize}
                  disabled={isSummarizing}
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 rounded-lg transition-all"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${isSummarizing ? 'animate-spin' : ''}`} />
                  {isSummarizing ? 'AI 提炼中...' : '重新提炼'}
                </button>
              </div>

              {isEditingFact ? (
                <div className="space-y-2">
                  <textarea
                    rows={8}
                    value={factDraft}
                    onChange={(e) => setFactDraft(e.target.value)}
                    className="w-full p-3 text-xs rounded-xl border border-sky-300 dark:border-sky-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 outline-none leading-relaxed"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setIsEditingFact(false)}
                      className="px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveFacts}
                      className="px-3 py-1.5 text-xs font-semibold bg-sky-600 text-white rounded-lg hover:bg-sky-500 shadow-sm"
                    >
                      保存修改
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setIsEditingFact(true)}
                  className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap cursor-pointer hover:border-sky-300 transition-all"
                  title="点击直接编辑事实摘要"
                >
                  {currentMatter.fact_summary || (
                    <span className="text-slate-400 italic">暂无沉淀事实，点击即可添加或由 AI 自动生成。</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
