import React, { useState, useEffect, useRef } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  Bookmark,
  Plus,
  RotateCw,
  Maximize2,
  Check,
  X,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { TodoItem, Matter } from '../types';
import { api } from '../services/api';
import { listen, emit } from '@tauri-apps/api/event';

interface CompactTodoWidgetProps {
  onExpand: () => void;
}

export const CompactTodoWidget: React.FC<CompactTodoWidgetProps> = ({ onExpand }) => {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [filter, setFilter] = useState<'pending' | 'all' | 'completed'>('pending');
  const [loading, setLoading] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [matters, setMatters] = useState<Matter[]>([]);
  const [selectedMatterId, setSelectedMatterId] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadData();
  }, [filter]);

  // 监听全应用数据更新广播
  useEffect(() => {
    const unlisten = listen('refresh-data', () => {
      loadData();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [filter]);

  // 展开输入框时自动聚焦
  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
  }, [isAdding]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [allTodoList, matterList] = await Promise.all([
        api.getAllTodos(filter),
        api.getMatters('active'),
      ]);
      setTodos(allTodoList);
      setMatters(matterList);
      if (matterList.length > 0 && !selectedMatterId) {
        setSelectedMatterId(matterList[0].id);
      }
    } catch (e) {
      console.warn('加载缩略待办失败', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTodo = async (todo: TodoItem) => {
    const nextCompleted = todo.status === 'pending';
    await api.toggleTodoStatus(todo.id, nextCompleted);
    await emit('refresh-data');
    loadData();
  };

  const handleToggleFocus = async (todo: TodoItem) => {
    await api.toggleTodoFocus(todo.id);
    await emit('refresh-data');
    loadData();
  };

  const handleDeleteTodo = async (id: string) => {
    await api.deleteTodo(id);
    await emit('refresh-data');
    loadData();
  };

  const handleCreateTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = newContent.trim();
    if (!content) return;

    const matterId = selectedMatterId || (matters[0] ? matters[0].id : 'default');
    try {
      await api.createTodo({
        matterId,
        content,
      });
      setNewContent('');
      setIsAdding(false);
      await emit('refresh-data');
      loadData();
    } catch (err) {
      console.error('新建待办失败', err);
    }
  };

  const pendingCount = todos.filter((t) => t.status === 'pending').length;

  return (
    <div className="w-full h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 select-none overflow-hidden border-l border-b border-slate-200/90 dark:border-slate-700/80 ring-1 ring-slate-900/5 dark:ring-white/10 shadow-[-15px_15px_40px_rgba(0,0,0,0.25)] dark:shadow-[-20px_20px_60px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.08)]">
      {/* 1. 顶部 Header 与恢复完整模式操作栏 */}
      <div className="h-13 px-3.5 border-b border-slate-200/80 dark:border-slate-800 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-sm shadow-sky-500/20 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-slate-900 dark:text-white tracking-tight">
              待办便签
            </span>
            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
              {pendingCount}待办
            </span>
          </div>
        </div>

        {/* 顶部操作区 */}
        <div className="flex items-center gap-1">
          {/* 新增按钮 */}
          <button
            onClick={() => setIsAdding(!isAdding)}
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              isAdding
                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title={isAdding ? '取消添加' : '快捷新建待办'}
          >
            {isAdding ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          </button>

          {/* 刷新 */}
          <button
            onClick={loadData}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            title="刷新列表"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* 扩展恢复完整模式 Icon */}
          <button
            onClick={onExpand}
            className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 cursor-pointer ml-0.5"
            title="恢复到完整桌面看板状态"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. 快速新建待办录入条（展开态） */}
      {isAdding && (
        <form
          onSubmit={handleCreateTodo}
          className="p-2.5 bg-sky-50/60 dark:bg-slate-800/80 border-b border-sky-100 dark:border-slate-800 space-y-2 animate-in fade-in slide-in-from-top-2 duration-150 shrink-0"
        >
          <input
            ref={inputRef}
            type="text"
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="输入待办内容，按 Enter 保存..."
            className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-sky-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-sky-500 shadow-2xs"
          />
          <div className="flex items-center justify-between gap-2">
            {matters.length > 0 ? (
              <select
                value={selectedMatterId}
                onChange={(e) => setSelectedMatterId(e.target.value)}
                className="flex-1 px-2 py-1 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 outline-none truncate"
              >
                {matters.map((m) => (
                  <option key={m.id} value={m.id}>
                    归属: {m.title}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[10px] text-slate-400">将归入默认事项</span>
            )}
            <button
              type="submit"
              disabled={!newContent.trim()}
              className="px-3 py-1 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white shadow-2xs transition-all cursor-pointer shrink-0"
            >
              保存
            </button>
          </div>
        </form>
      )}

      {/* 3. 筛选胶囊栏 */}
      <div className="px-3 pt-2 pb-1.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-1 bg-slate-200/60 dark:bg-slate-800 p-0.5 rounded-lg text-[11px] font-medium">
          <button
            onClick={() => setFilter('pending')}
            className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
              filter === 'pending'
                ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 font-bold shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            待办
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
              filter === 'all'
                ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 font-bold shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            全部
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-2 py-0.5 rounded-md transition-all cursor-pointer ${
              filter === 'completed'
                ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 font-bold shadow-2xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            已完成
          </button>
        </div>

        <span className="text-[10px] text-slate-400">
          共 {todos.length} 条
        </span>
      </div>

      {/* 4. 待办列表主体 */}
      <div className="flex-1 overflow-y-auto px-2.5 py-1 space-y-2 min-h-0">
        {todos.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-2">
            <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Check className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {filter === 'completed' ? '暂无已完成的待办' : '干得漂亮！待办已全部搞定'}
            </p>
            <p className="text-[10px] text-slate-400">
              点击右上角 [+] 可随时录入新任务
            </p>
          </div>
        ) : (
          todos.map((todo) => {
            const isCompleted = todo.status === 'completed';
            return (
              <div
                key={todo.id}
                className={`p-2.5 rounded-xl border transition-all flex items-start gap-2.5 group ${
                  isCompleted
                    ? 'bg-slate-100/60 dark:bg-slate-800/40 border-slate-200/50 dark:border-slate-800 text-slate-400 dark:text-slate-500'
                    : 'bg-white dark:bg-slate-800 border-slate-200/80 dark:border-slate-700/80 hover:border-sky-300 dark:hover:border-sky-600 shadow-2xs'
                }`}
              >
                {/* 勾选圈 */}
                <button
                  onClick={() => handleToggleTodo(todo)}
                  className="mt-0.5 text-slate-400 hover:text-emerald-500 dark:hover:text-emerald-400 transition-colors cursor-pointer shrink-0"
                  title={isCompleted ? '标记为未完成' : '标记为已完成'}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Circle className="w-4 h-4" />
                  )}
                </button>

                {/* 文本内容与元数据 */}
                <div className="flex-1 min-w-0">
                  <p
                    className={`text-xs font-semibold leading-snug break-words ${
                      isCompleted ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {todo.content}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-[10px]">
                    {todo.matter_title && (
                      <span
                        className="px-1.5 py-0.2 rounded-md bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-300 border border-sky-200/50 dark:border-sky-800/50 truncate max-w-[150px]"
                        title={todo.matter_title}
                      >
                        {todo.matter_title}
                      </span>
                    )}
                    {(todo.reminder_time || todo.due_time) && (
                      <span className="flex items-center gap-0.5 text-slate-400">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{(todo.reminder_time || todo.due_time || '').slice(5, 16)}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* 快捷操作 */}
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    onClick={() => handleToggleFocus(todo)}
                    className={`p-1 rounded-md transition-colors cursor-pointer ${
                      todo.is_focused
                        ? 'text-amber-500'
                        : 'text-slate-300 dark:text-slate-600 hover:text-amber-500 opacity-0 group-hover:opacity-100'
                    }`}
                    title={todo.is_focused ? '取消重点' : '标为重点'}
                  >
                    <Bookmark className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteTodo(todo.id)}
                    className="p-1 rounded-md text-slate-300 dark:text-slate-600 hover:text-rose-500 opacity-0 group-hover:opacity-100 transition-colors cursor-pointer"
                    title="删除待办"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 5. 底部状态与提示 */}
      <div className="h-7 px-3 border-t border-slate-200/70 dark:border-slate-800/80 bg-white/60 dark:bg-slate-900/60 flex items-center justify-between text-[10px] text-slate-400 shrink-0">
        <span>桌面右上角模式</span>
        <button
          onClick={onExpand}
          className="text-sky-600 dark:text-sky-400 hover:underline cursor-pointer flex items-center gap-0.5"
        >
          <Maximize2 className="w-2.5 h-2.5" />
          <span>恢复看板</span>
        </button>
      </div>
    </div>
  );
};
