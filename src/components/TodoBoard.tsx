import React, { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  Bookmark,
  AlertTriangle,
  Calendar,
  Layers,
} from 'lucide-react';
import { TodoItem, Matter } from '../types';
import { api } from '../services/api';

interface TodoBoardProps {
  onSelectMatter: (matter: Matter) => void;
}

export const TodoBoard: React.FC<TodoBoardProps> = ({ onSelectMatter }) => {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTodos();
  }, [filter]);

  const loadTodos = async () => {
    setLoading(true);
    try {
      const list = await api.getAllTodos(filter);
      setTodos(list);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTodo = async (todo: TodoItem) => {
    const nextCompleted = todo.status === 'pending';
    await api.toggleTodoStatus(todo.id, nextCompleted);
    loadTodos();
  };

  const handleToggleFocus = async (todo: TodoItem) => {
    await api.toggleTodoFocus(todo.id);
    loadTodos();
  };

  const handleGoToMatter = async (matterId: string) => {
    const m = await api.getMatterById(matterId);
    if (m) {
      onSelectMatter(m);
    }
  };

  // 分类切片
  const focusedTodos = todos.filter((t) => t.is_focused && t.status === 'pending');
  const nowStr = new Date().toISOString().split('T')[0];

  const overdueTodos = todos.filter((t) => {
    if (t.status === 'completed' || !t.due_time) return false;
    return t.due_time < nowStr;
  });

  const todayTodos = todos.filter((t) => {
    if (t.status === 'completed' || !t.due_time) return false;
    return t.due_time.startsWith(nowStr);
  });

  const upcomingTodos = todos.filter((t) => {
    if (t.status === 'completed' || !t.due_time) return false;
    return t.due_time > nowStr && !t.due_time.startsWith(nowStr);
  });

  const noDateTodos = todos.filter((t) => t.status === 'pending' && !t.due_time);

  const completedTodos = todos.filter((t) => t.status === 'completed');

  return (
    <div className="max-w-5xl mx-auto py-8 px-6 space-y-8 select-none">
      {/* 头部与过滤 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">待办总览与聚焦</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            由外部碎片日志智能提炼，自动按时间维度切片与调度提醒
          </p>
        </div>

        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
          <button
            onClick={() => setFilter('pending')}
            className={`px-3 py-1 rounded-lg transition-all ${
              filter === 'pending' ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs' : 'text-slate-500'
            }`}
          >
            待办中
          </button>
          <button
            onClick={() => setFilter('completed')}
            className={`px-3 py-1 rounded-lg transition-all ${
              filter === 'completed' ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs' : 'text-slate-500'
            }`}
          >
            已完成
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-lg transition-all ${
              filter === 'all' ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-xs' : 'text-slate-500'
            }`}
          >
            全部
          </button>
        </div>
      </div>

      {/* 1. 今日核心聚焦 (Focus List) */}
      {focusedTodos.length > 0 && (
        <section className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-500/30 dark:border-amber-500/20 p-5 rounded-2xl shadow-xs">
          <div className="flex items-center gap-2 mb-3 text-amber-600 dark:text-amber-400 font-bold text-xs uppercase tracking-wider">
            <Bookmark className="w-4 h-4 fill-current" />
            <span>核心攻坚聚焦 (Focus Mode)</span>
          </div>

          <div className="space-y-2">
            {focusedTodos.map((todo) => (
              <div
                key={todo.id}
                className="flex items-center justify-between p-3.5 bg-white dark:bg-slate-900 rounded-xl border border-amber-200/80 dark:border-amber-900/40 shadow-xs"
              >
                <div className="flex items-center gap-3 flex-1">
                  <button
                    onClick={() => handleToggleTodo(todo)}
                    className="text-slate-400 hover:text-emerald-600 transition-all"
                  >
                    <Circle className="w-4 h-4" />
                  </button>
                  <div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{todo.content}</span>
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                      {todo.matter_title && (
                        <button
                          onClick={() => handleGoToMatter(todo.matter_id)}
                          className="text-sky-600 dark:text-sky-400 hover:underline"
                        >
                          所属事项: 【{todo.matter_title}】
                        </button>
                      )}
                      {todo.due_time && (
                        <span className="text-amber-600 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {todo.due_time}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleToggleFocus(todo)}
                  className="p-1 text-amber-500 hover:bg-amber-50 rounded-lg"
                  title="取消聚焦"
                >
                  <Bookmark className="w-4 h-4 fill-current" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 2. 待办分组流 */}
      <div className="space-y-6">
        {/* 已逾期 */}
        {overdueTodos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" />
              已逾期待办 ({overdueTodos.length})
            </h3>
            {renderTodoList(overdueTodos, handleToggleTodo, handleToggleFocus, handleGoToMatter)}
          </div>
        )}

        {/* 今天到期 */}
        {todayTodos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              今天到期 ({todayTodos.length})
            </h3>
            {renderTodoList(todayTodos, handleToggleTodo, handleToggleFocus, handleGoToMatter)}
          </div>
        )}

        {/* 未来近期 */}
        {upcomingTodos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              未来近期 ({upcomingTodos.length})
            </h3>
            {renderTodoList(upcomingTodos, handleToggleTodo, handleToggleFocus, handleGoToMatter)}
          </div>
        )}

        {/* 暂无时间 */}
        {noDateTodos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5" />
              待安排清单 ({noDateTodos.length})
            </h3>
            {renderTodoList(noDateTodos, handleToggleTodo, handleToggleFocus, handleGoToMatter)}
          </div>
        )}

        {/* 已完成 */}
        {filter !== 'pending' && completedTodos.length > 0 && (
          <div className="space-y-2 pt-4 border-t border-slate-200 dark:border-slate-800">
            <h3 className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              已完成待办 ({completedTodos.length})
            </h3>
            {renderTodoList(completedTodos, handleToggleTodo, handleToggleFocus, handleGoToMatter)}
          </div>
        )}

        {todos.length === 0 && !loading && (
          <div className="text-center py-16 text-slate-400 text-xs">
            暂无待办事项，在微信/企微中划选一段文字按 Alt+A 即可自动抽取行动项。
          </div>
        )}
      </div>
    </div>
  );
};

function renderTodoList(
  items: TodoItem[],
  onToggle: (t: TodoItem) => void,
  onFocus: (t: TodoItem) => void,
  onGoToMatter: (matterId: string) => void,
) {
  return (
    <div className="space-y-2">
      {items.map((todo) => {
        const isDone = todo.status === 'completed';
        return (
          <div
            key={todo.id}
            className={`flex items-center justify-between p-3.5 rounded-xl border transition-all ${
              isDone
                ? 'bg-slate-50/50 dark:bg-slate-900/40 border-slate-100 dark:border-slate-800 opacity-60'
                : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 shadow-xs'
            }`}
          >
            <div className="flex items-center gap-3 flex-1">
              <button
                onClick={() => onToggle(todo)}
                className={`transition-all active:scale-90 ${
                  isDone ? 'text-emerald-500' : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {isDone ? <CheckCircle2 className="w-4 h-4 fill-emerald-500 text-white" /> : <Circle className="w-4 h-4" />}
              </button>
              <div>
                <span className={`text-xs font-semibold leading-tight block ${isDone ? 'line-through text-slate-400' : 'text-slate-800 dark:text-white'}`}>
                  {todo.content}
                </span>
                <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                  {todo.matter_title && (
                    <button
                      onClick={() => onGoToMatter(todo.matter_id)}
                      className="text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      所属: 【{todo.matter_title}】
                    </button>
                  )}
                  {todo.due_time && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {todo.due_time}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <button
              onClick={() => onFocus(todo)}
              className={`p-1.5 rounded-lg transition-all ${
                todo.is_focused
                  ? 'text-amber-500 bg-amber-50 dark:bg-amber-950/60'
                  : 'text-slate-300 hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title={todo.is_focused ? '取消聚焦' : '标记为今日聚焦'}
            >
              <Bookmark className="w-3.5 h-3.5 fill-current" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
