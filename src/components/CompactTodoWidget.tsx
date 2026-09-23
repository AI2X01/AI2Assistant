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
  Pin,
  PinOff,
  GripVertical,
} from 'lucide-react';
import { TodoItem, Matter, CompactDockState } from '../types';
import { api } from '../services/api';
import { listen, emit } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ConfirmModal } from './ConfirmModal';

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
  const [todoToDelete, setTodoToDelete] = useState<TodoItem | null>(null);
  const [isDeletingTodo, setIsDeletingTodo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 贴边停靠与自动抽拉状态
  const [dockState, setDockState] = useState<CompactDockState>({
    edge: 'top',
    is_hidden: false,
    is_locked: false,
  });

  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadData();
  }, [filter]);

  // 初始化获取贴边状态并监听后端广播
  useEffect(() => {
    api.getCompactDockState().then((s) => {
      setDockState(s);
    }).catch(console.warn);

    const unlistenDock = listen<CompactDockState>('compact-dock-changed', (event) => {
      setDockState(event.payload);
    });

    return () => {
      unlistenDock.then((fn) => fn());
      if (leaveTimerRef.current) {
        clearTimeout(leaveTimerRef.current);
      }
    };
  }, []);

  // 监听全应用数据更新广播
  useEffect(() => {
    const unlisten = listen('refresh-data', () => {
      loadData();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [filter]);

  // 展开输入框或开启删除确认弹窗时，告知后端处于忙碌态（防止自动收缩）
  useEffect(() => {
    if (isAdding) {
      inputRef.current?.focus();
    }
    const isBusy = isAdding || !!todoToDelete;
    api.setCompactBusy(isBusy).catch(console.warn);
  }, [isAdding, todoToDelete]);

  // 鼠标移入：触碰到露出的边框把手或展开窗体，立即滑出
  const handleMouseEnter = async () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    if (dockState.is_hidden) {
      try {
        const state = await api.compactSlideOut();
        setDockState(state);
      } catch (e) {
        console.warn('滑出展开失败', e);
      }
    }
  };

  // 鼠标移出：若贴边且未锁定、未在添加输入或二次确认中，防抖 450ms 后平滑收缩
  const handleMouseLeave = () => {
    if (dockState.edge === 'none' || dockState.is_locked || isAdding || !!todoToDelete) {
      return;
    }
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
    }
    leaveTimerRef.current = setTimeout(async () => {
      try {
        const state = await api.compactSlideIn();
        setDockState(state);
      } catch (e) {
        console.warn('贴边收起失败', e);
      }
    }, 450);
  };

  // 拖动释放检测：拖动结束后更新贴边方向
  const handleDragRelease = () => {
    setTimeout(async () => {
      try {
        const state = await api.updateCompactDockState();
        setDockState(state);
      } catch (e) {
        console.warn('更新贴边状态失败', e);
      }
    }, 80);
  };

  // 按住标题栏任意区域直接触发原生窗口拖拽
  const handleHeaderMouseDown = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, input, select')) {
      return;
    }
    if (e.button === 0) {
      try {
        await getCurrentWindow().startDragging();
      } catch (err) {
        console.warn('调用 startDragging 失败，尝试后端接口', err);
        await api.startDraggingWindow();
      }
    }
  };

  // 切换锁定常驻状态
  const handleToggleLock = async () => {
    try {
      const state = await api.toggleCompactDockLock();
      setDockState(state);
    } catch (e) {
      console.warn('切换锁定状态失败', e);
    }
  };

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

  const handleConfirmDeleteTodo = async () => {
    if (!todoToDelete) return;
    setIsDeletingTodo(true);
    try {
      await api.deleteTodo(todoToDelete.id);
      setTodoToDelete(null);
      await emit('refresh-data');
      loadData();
    } catch (e) {
      console.error('删除待办失败', e);
    } finally {
      setIsDeletingTodo(false);
    }
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
    <div
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className="relative w-full h-screen flex flex-col bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 select-none overflow-hidden border border-slate-300/80 dark:border-slate-700/80 shadow-[-15px_15px_40px_rgba(0,0,0,0.3)] dark:shadow-[-20px_20px_60px_rgba(0,0,0,0.9),0_0_0_1px_rgba(255,255,255,0.08)] transition-opacity duration-150"
    >
      {/* 贴边收起时的边缘呼吸微光把手 (露出15px精致极简，指示吸附具体位置) */}
      {dockState.is_hidden && (
        <div
          onMouseEnter={handleMouseEnter}
          className={`absolute z-50 pointer-events-auto flex items-center justify-center cursor-pointer transition-all ${
            dockState.edge === 'top'
              ? 'bottom-0 left-0 right-0 h-[15px] bg-gradient-to-r from-sky-500 via-indigo-500 to-sky-500 shadow-[0_2px_8px_rgba(14,165,233,0.6)]'
              : dockState.edge === 'right'
              ? 'left-0 top-0 bottom-0 w-[15px] bg-gradient-to-b from-sky-500 via-indigo-500 to-sky-500 shadow-[-2px_0_8px_rgba(14,165,233,0.6)]'
              : 'right-0 top-0 bottom-0 w-[15px] bg-gradient-to-b from-sky-500 via-indigo-500 to-sky-500 shadow-[2px_0_8px_rgba(14,165,233,0.6)]'
          }`}
          title="鼠标移入自动下滑展开"
        >
          <div className="w-12 h-1.5 rounded-full bg-white/80 shadow-[0_0_8px_white] animate-pulse" />
        </div>
      )}

      {/* 1. 顶部 Header 与拖拽感应区域 */}
      <div
        data-tauri-drag-region
        onMouseDown={handleHeaderMouseDown}
        onPointerUp={handleDragRelease}
        className="h-13 px-3 border-b border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between shrink-0 cursor-move select-none"
      >
        <div data-tauri-drag-region className="flex items-center gap-2 cursor-move min-w-0">
          {/* 拖动抓手手柄 */}
          <div data-tauri-drag-region className="text-slate-300 dark:text-slate-600 hover:text-slate-500 transition-colors shrink-0">
            <GripVertical className="w-4 h-4" />
          </div>

          <div data-tauri-drag-region className="w-5 h-5 rounded-md bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-xs shadow-sky-500/20 shrink-0">
            <Sparkles className="w-3 h-3" />
          </div>
          <div data-tauri-drag-region className="flex items-center gap-1.5 truncate">
            <span data-tauri-drag-region className="text-xs font-bold text-slate-900 dark:text-white tracking-tight">
              待办便签
            </span>
            <span data-tauri-drag-region className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400">
              {pendingCount}
            </span>

            {/* 贴边吸附微指示 */}
            {dockState.edge !== 'none' && (
              <span
                data-tauri-drag-region
                className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200/50 dark:border-sky-800/50"
                title="已吸附屏幕边缘，移开鼠标将自动缩回"
              >
                {dockState.edge === 'top' ? '贴顶' : dockState.edge === 'right' ? '贴右' : '贴左'}
              </span>
            )}
          </div>
        </div>

        {/* 顶部操作区 (禁止拖动区域) */}
        <div className="flex items-center gap-0.5 shrink-0 cursor-default" data-tauri-drag-region={false}>
          {/* 锁定常驻图钉 */}
          <button
            onClick={handleToggleLock}
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              dockState.is_locked
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/80 dark:text-amber-300'
                : 'text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title={dockState.is_locked ? '已锁定常驻（移开鼠标不会收起）' : '点击锁定常驻（防止贴边自动收起）'}
          >
            {dockState.is_locked ? <Pin className="w-3.5 h-3.5 fill-current" /> : <PinOff className="w-3.5 h-3.5" />}
          </button>

          {/* 新增按钮 */}
          <button
            onClick={() => setIsAdding(!isAdding)}
            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
              isAdding
                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300'
                : 'text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
            title={isAdding ? '取消添加' : '快捷新建待办'}
          >
            {isAdding ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          </button>

          {/* 刷新 */}
          <button
            onClick={loadData}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            title="刷新列表"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* 扩展恢复完整模式 Icon */}
          <button
            onClick={onExpand}
            className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 dark:text-slate-400 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all active:scale-95 cursor-pointer ml-0.5"
            title="恢复到完整桌面看板状态"
          >
            <Maximize2 className="w-3.5 h-3.5" />
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
      <div className="relative px-3 pt-2 pb-1.5 flex items-center justify-center shrink-0">
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

        <span className="absolute right-3 text-[10px] text-slate-400">
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
                    onClick={() => setTodoToDelete(todo)}
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
        <span className="flex items-center gap-1.5">
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              dockState.is_locked
                ? 'bg-amber-400'
                : dockState.edge !== 'none'
                ? 'bg-sky-400 animate-pulse'
                : 'bg-slate-300 dark:bg-slate-600'
            }`}
          />
          <span>
            {dockState.is_locked
              ? '常驻锁定中 (移开不收缩)'
              : dockState.edge !== 'none'
              ? '已贴边吸附 (移开鼠标 0.4s 自动缩回)'
              : '自由悬浮 (贴近屏幕顶部/边缘可吸附)'}
          </span>
        </span>
        <button
          onClick={onExpand}
          className="text-sky-600 dark:text-sky-400 hover:underline cursor-pointer flex items-center gap-0.5"
        >
          <Maximize2 className="w-2.5 h-2.5" />
          <span>恢复看板</span>
        </button>
      </div>

      {/* 删除待办二次确认弹窗 */}
      <ConfirmModal
        isOpen={!!todoToDelete}
        title="确认删除该待办？"
        description={
          todoToDelete
            ? `即将删除待办「${todoToDelete.content}」。删除后无法恢复，确定继续吗？`
            : ''
        }
        confirmText="确认删除"
        cancelText="取消"
        isDanger={true}
        isLoading={isDeletingTodo}
        onClose={() => setTodoToDelete(null)}
        onConfirm={handleConfirmDeleteTodo}
      />
    </div>
  );
};
