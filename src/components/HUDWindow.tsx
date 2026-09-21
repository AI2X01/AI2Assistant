import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  CheckCircle2,
  X,
  ArrowRight,
  Clock,
  AlertCircle,
  Bell,
  ChevronLeft,
  Check,
  Undo2,
} from 'lucide-react';
import { AIParseResult, CapturedContext, TodoItem, TodoUpdateSuggestion } from '../types';
import { api } from '../services/api';
import { listen, emit } from '@tauri-apps/api/event';

function formatTargetTime(date: Date): string {
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}-${m}-${d} ${h}:${min}:${s}`;
}

function getDefaultCustomTime(): string {
  const d = new Date(Date.now() + 15 * 60 * 1000);
  const pad = (n: number) => (n < 10 ? '0' + n : String(n));
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const HUDWindow: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [parseResult, setParseResult] = useState<AIParseResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [undoneMap, setUndoneMap] = useState<Record<string, boolean>>({});

  // 待办到期提醒状态
  const [reminderTodos, setReminderTodos] = useState<TodoItem[]>([]);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [customSnoozeTime, setCustomSnoozeTime] = useState<string>(getDefaultCustomTime);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const currentReminder = reminderTodos[0];

  // 动态同步物理窗口尺寸：极简胶囊 (capsule: 360x76) vs 决策面板 (expanded: 380x240) vs 待办提醒 (reminder: 380x260)
  useEffect(() => {
    if (currentReminder) {
      api.resizeHudWindow('reminder');
    } else if (parseResult?.action === 'AMBIGUOUS' || parseResult?.action === 'CREATE_NEW') {
      api.resizeHudWindow('expanded');
    } else {
      api.resizeHudWindow('capsule');
    }
  }, [currentReminder, parseResult]);

  // 监听待办提醒事件
  useEffect(() => {
    const unlistenReminder = listen<TodoItem>('todo-reminder', (event) => {
      if (!event.payload) return;
      setReminderTodos((prev) => {
        if (prev.some((t) => t.id === event.payload.id)) {
          return prev;
        }
        return [...prev, event.payload];
      });
      setCountdown(null);
    });

    return () => {
      unlistenReminder.then((fn) => fn());
    };
  }, []);

  // 监听后端发起的抓取事件与上下文
  useEffect(() => {
    const unlistenStart = listen('capture-start', () => {
      api.resizeHudWindow('capsule');
      setLoading(true);
      setParseResult(null);
      setErrorMessage(null);
      setCountdown(null);
    });

    const unlistenContext = listen<CapturedContext>('captured-context', async (event) => {
      await handleProcessCaptured(event.payload);
    });

    const unlistenError = listen<string>('capture-error', (event) => {
      api.resizeHudWindow('capsule');
      setLoading(false);
      setParseResult(null);
      setErrorMessage(event.payload || '未检测到选中文本，请先划选文字');
      setCountdown(2);
    });

    const unlistenAuto = listen('start-auto-capture', async () => {
      await handleTriggerCapture();
    });

    return () => {
      unlistenStart.then((fn) => fn());
      unlistenContext.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenAuto.then((fn) => fn());
    };
  }, []);

  // 键盘快捷盲操 (待办提醒快捷完成/推迟，划选数字键选择、Enter 新建、Esc 忽略)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (currentReminder) {
          handleDismissReminder(currentReminder);
        } else {
          handleClose();
        }
      } else if (currentReminder) {
        if (!isSnoozing && e.key === 'Enter') {
          handleAcknowledge(currentReminder);
        }
      } else if (parseResult?.action === 'AMBIGUOUS') {
        const num = parseInt(e.key, 10);
        const candidates = parseResult.candidate_matters || [];
        if (!isNaN(num) && num >= 1 && num <= candidates.length) {
          handleConfirmExisting(candidates[num - 1].id);
        } else if (num === candidates.length + 1 || e.key === 'Enter') {
          handleConfirmCreateNew();
        }
      } else if (parseResult?.action === 'CREATE_NEW' && e.key === 'Enter') {
        handleConfirmCreateNew();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [parseResult, currentReminder, isSnoozing, reminderTodos]);

  // 自动倒计时淡出机制（鼠标悬停或有待办提醒时暂停倒计时）
  useEffect(() => {
    if (currentReminder) return; // 有到期待办提醒时绝不自动淡出
    if (countdown === null) return;
    if (countdown <= 0) {
      handleClose();
      return;
    }
    if (isHovered) return; // 鼠标悬停时暂停倒计时

    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown, isHovered, currentReminder]);

  // 空闲防卡死兜底：如果没有任何内容且未在 loading，2秒后自动销毁关闭
  useEffect(() => {
    if (currentReminder) return;
    if (!loading && !parseResult && !errorMessage) {
      const idleTimer = setTimeout(() => {
        handleClose();
      }, 2000);
      return () => clearTimeout(idleTimer);
    }
  }, [loading, parseResult, errorMessage, currentReminder]);

  // 窗口失焦时平滑自动关闭（用户在其他程序点击，无感收起）
  useEffect(() => {
    const handleBlur = () => {
      if (currentReminder) return; // 有待办提醒时失焦不关闭
      if (!isHovered) {
        setTimeout(() => {
          handleClose();
        }, 1200);
      }
    };

    window.addEventListener('blur', handleBlur);
    return () => window.removeEventListener('blur', handleBlur);
  }, [isHovered, currentReminder]);

  // 待办操作：知道了（置为完成）
  const handleAcknowledge = async (todo: TodoItem) => {
    setActionFeedback('已标记为完成！');
    try {
      await api.toggleTodoStatus(todo.id, true);
      await emit('refresh-data');
    } catch (e) {
      console.error('完成待办失败', e);
    }
    setTimeout(() => {
      setReminderTodos((prev) => prev.filter((t) => t.id !== todo.id));
      setIsSnoozing(false);
      setActionFeedback(null);
      if (reminderTodos.length <= 1 && !parseResult) {
        handleClose();
      }
    }, 600);
  };

  // 待办操作：快捷推迟指定分钟
  const handleSnoozeMinutes = async (todo: TodoItem, minutes: number) => {
    const target = new Date(Date.now() + minutes * 60 * 1000);
    const targetStr = formatTargetTime(target);
    const label = minutes >= 60 ? `${minutes / 60}小时后` : `${minutes}分钟后`;
    setActionFeedback(`已推迟至 ${label} 再次提醒`);
    try {
      await api.updateTodoReminder(todo.id, targetStr);
      await emit('refresh-data');
    } catch (e) {
      console.error('推迟待办失败', e);
    }
    setTimeout(() => {
      setReminderTodos((prev) => prev.filter((t) => t.id !== todo.id));
      setIsSnoozing(false);
      setActionFeedback(null);
      if (reminderTodos.length <= 1 && !parseResult) {
        handleClose();
      }
    }, 700);
  };

  // 待办操作：自定义推迟时间
  const handleCustomSnooze = async (todo: TodoItem) => {
    if (!customSnoozeTime) return;
    const targetStr = customSnoozeTime.replace('T', ' ') + (customSnoozeTime.length === 16 ? ':00' : '');
    const display = customSnoozeTime.split('T')[1] || customSnoozeTime;
    setActionFeedback(`已推迟至 ${display} 再次提醒`);
    try {
      await api.updateTodoReminder(todo.id, targetStr);
      await emit('refresh-data');
    } catch (e) {
      console.error('自定义推迟待办失败', e);
    }
    setTimeout(() => {
      setReminderTodos((prev) => prev.filter((t) => t.id !== todo.id));
      setIsSnoozing(false);
      setActionFeedback(null);
      if (reminderTodos.length <= 1 && !parseResult) {
        handleClose();
      }
    }, 700);
  };

  // 跳过或稍后处理当前提醒
  const handleDismissReminder = (todo: TodoItem) => {
    setReminderTodos((prev) => prev.filter((t) => t.id !== todo.id));
    setIsSnoozing(false);
    setActionFeedback(null);
    if (reminderTodos.length <= 1 && !parseResult) {
      handleClose();
    }
  };

  const handleProcessCaptured = async (captured: CapturedContext) => {
    setLoading(true);
    setParseResult(null);
    setErrorMessage(null);
    setCountdown(null);
    try {
      const res = await api.processCapturedContext(captured);
      setParseResult(res);

      if (res.action === 'MATCH_EXISTING') {
        // 极简胶囊成功态：若有待办关闭更新给4秒，普通沉淀2秒极速淡出，最大限度不打扰
        setCountdown(res.todo_updates && res.todo_updates.length > 0 ? 4 : 2);
      } else {
        setCountdown(8);
      }
    } catch (e: any) {
      console.warn('解析失败', e);
      const msg = typeof e === 'string' ? e : e?.message || '解析失败，请重试';
      setErrorMessage(msg);
      setCountdown(2);
    } finally {
      setLoading(false);
    }
  };

  const handleTriggerCapture = async () => {
    setLoading(true);
    setParseResult(null);
    setErrorMessage(null);
    setCountdown(null);
    try {
      const res = await api.triggerCaptureAndAnalyze();
      setParseResult(res);

      if (res.action === 'MATCH_EXISTING') {
        setCountdown(res.todo_updates && res.todo_updates.length > 0 ? 4 : 2);
      } else {
        setCountdown(8);
      }
    } catch (e: any) {
      console.warn('抓取解析提示', e);
      const msg = typeof e === 'string' ? e : e?.message || '未检测到划选文本';
      setErrorMessage(msg);
      setCountdown(2);
    } finally {
      setLoading(false);
    }
  };

  const handleUndoUpdate = async (update: TodoUpdateSuggestion) => {
    try {
      await api.undoTodoUpdate(update.todo_id, update.action, update.original_content);
      setUndoneMap((prev) => ({ ...prev, [update.todo_id]: true }));
      await emit('refresh-data');
    } catch (err) {
      console.error('撤销待办变更失败', err);
    }
  };

  const handleConfirmExisting = async (matterId: string) => {
    if (!parseResult) return;
    await api.confirmRouteDecision({
      choice: 'EXISTING',
      matter_id: matterId,
      raw_snippet: parseResult.raw_snippet,
      source_app: parseResult.source_app,
      source_window: parseResult.source_window,
      extracted_facts_delta: parseResult.extracted_facts_delta,
      extracted_todos: parseResult.extracted_todos,
      todo_updates: parseResult.todo_updates,
      log_id: parseResult.log_id,
    });
    handleClose();
  };

  const handleConfirmCreateNew = async () => {
    if (!parseResult) return;
    await api.confirmRouteDecision({
      choice: 'CREATE_NEW',
      new_matter: parseResult.suggested_new_matter,
      raw_snippet: parseResult.raw_snippet,
      source_app: parseResult.source_app,
      source_window: parseResult.source_window,
      extracted_facts_delta: parseResult.extracted_facts_delta,
      extracted_todos: parseResult.extracted_todos,
      log_id: parseResult.log_id,
    });
    handleClose();
  };

  const handleClose = async () => {
    setParseResult(null);
    setErrorMessage(null);
    setCountdown(null);
    await api.hideHudWindow();
  };

  // 是否为需要展开面板的交互模式（待办提醒 或 歧义多选项）
  const isExpandedMode = !!currentReminder || parseResult?.action === 'AMBIGUOUS' || parseResult?.action === 'CREATE_NEW';

  return (
    <div
      className="w-full h-full p-1.5 select-none bg-transparent flex flex-col justify-end"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 待办到期提醒卡片（仅当有到期提醒时展示） */}
      {currentReminder ? (
        <div className="w-full h-full rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-amber-400/50 dark:border-amber-500/40 ring-1 ring-amber-500/20 dark:ring-white/15 shadow-[0_15px_35px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.85)] p-3.5 flex flex-col justify-between text-slate-800 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5">
              <div className="w-5 h-5 rounded-md bg-amber-500/15 flex items-center justify-center text-amber-500">
                <Bell className="w-3 h-3 animate-pulse" />
              </div>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">待办到期提醒</span>
              {reminderTodos.length > 1 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-semibold">
                  1/{reminderTodos.length}
                </span>
              )}
            </div>
            <button
              onClick={() => handleDismissReminder(currentReminder)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="稍后处理 (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {actionFeedback ? (
            <div className="my-auto py-4 text-center space-y-1 animate-in zoom-in-95 duration-150">
              <div className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <Check className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{actionFeedback}</p>
            </div>
          ) : isSnoozing ? (
            <div className="flex-1 flex flex-col justify-between py-1.5 min-h-0 space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                  重新设定提醒时间：
                </span>
                <button
                  onClick={() => setIsSnoozing(false)}
                  className="text-[11px] text-sky-600 hover:text-sky-700 dark:text-sky-400 flex items-center gap-0.5 cursor-pointer"
                >
                  <ChevronLeft className="w-3 h-3" />
                  返回
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {[15, 30, 60].map((min) => (
                  <button
                    key={min}
                    onClick={() => handleSnoozeMinutes(currentReminder, min)}
                    className="py-1.5 px-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950 hover:text-sky-600 dark:hover:text-sky-400 border border-slate-200 dark:border-slate-700 active:scale-95 transition-all text-center cursor-pointer"
                  >
                    {min >= 60 ? '1小时后' : `${min}分钟后`}
                  </button>
                ))}
              </div>

              <div className="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5">
                <input
                  type="datetime-local"
                  value={customSnoozeTime}
                  onChange={(e) => setCustomSnoozeTime(e.target.value)}
                  className="flex-1 px-1.5 py-0.5 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none"
                />
                <button
                  onClick={() => handleCustomSnooze(currentReminder)}
                  className="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-semibold active:scale-95 transition-all cursor-pointer shrink-0"
                >
                  确定
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-between py-1.5 min-h-0 space-y-1.5">
              <div className="space-y-1">
                {currentReminder.matter_title && (
                  <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-semibold bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200/60 dark:border-sky-800/60 truncate max-w-full">
                    {currentReminder.matter_title}
                  </span>
                )}
                <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 leading-snug line-clamp-2 select-text">
                    {currentReminder.content}
                  </p>
                  <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                    <Clock className="w-2.5 h-2.5" />
                    <span>{currentReminder.reminder_time || currentReminder.due_time || '当前'}</span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 pt-0.5">
                <button
                  onClick={() => {
                    setCustomSnoozeTime(getDefaultCustomTime());
                    setIsSnoozing(true);
                  }}
                  className="px-2.5 py-1.5 rounded-xl text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 active:scale-95 transition-all flex items-center gap-1 cursor-pointer"
                >
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span>推迟</span>
                </button>

                <button
                  onClick={() => handleAcknowledge(currentReminder)}
                  className="flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-sm active:scale-95 transition-all flex items-center justify-center gap-1 cursor-pointer"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>知道了 (完成)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : isExpandedMode ? (
        /* 交互选择展开面板（仅在 AMBIGUOUS 歧义多选项 或 CREATE_NEW 时展示，高度紧凑） */
        <div className="w-full h-full rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-sky-400/40 dark:border-sky-500/40 ring-1 ring-sky-500/20 dark:ring-white/15 shadow-[0_15px_35px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.85)] p-3 flex flex-col justify-between text-slate-800 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150">
          <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
            <span className="text-xs font-bold text-sky-600 dark:text-sky-400">
              请选择要归集的目标事项：
            </span>
            <button
              onClick={handleClose}
              className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
              title="忽略 (Esc)"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {parseResult?.action === 'AMBIGUOUS' ? (
            <div className="flex-1 overflow-y-auto space-y-1 py-1.5 min-h-0">
              {parseResult.candidate_matters.map((c, idx) => (
                <button
                  key={c.id}
                  onClick={() => handleConfirmExisting(c.id)}
                  className="w-full flex items-center justify-between p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800 hover:bg-sky-50 hover:text-sky-600 transition-all border border-slate-200/80 dark:border-slate-700/80 cursor-pointer text-left text-xs"
                >
                  <span className="font-medium truncate flex-1 mr-1.5">
                    <span className="font-bold text-sky-600 mr-1">[{idx + 1}]</span>
                    【{c.title}】
                  </span>
                  <span className="text-[10px] text-slate-400 shrink-0">
                    {Math.round(c.confidence * 100)}%
                  </span>
                </button>
              ))}

              <button
                onClick={handleConfirmCreateNew}
                className="w-full flex items-center justify-between p-1.5 rounded-lg bg-sky-50/80 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-semibold border border-sky-200 dark:border-sky-800 cursor-pointer text-left text-xs"
              >
                <span className="truncate flex-1 mr-1.5">
                  <span className="font-bold mr-1">[{parseResult.candidate_matters.length + 1}]</span>
                  + 新建: "{parseResult.suggested_new_matter?.title || '新事项'}"
                </span>
                <ArrowRight className="w-3 h-3 shrink-0" />
              </button>
            </div>
          ) : (
            <div className="flex-1 flex flex-col justify-center py-2 space-y-2 text-xs">
              <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <span className="text-[10px] text-slate-400 block">建议新建事项：</span>
                <span className="font-bold text-slate-900 dark:text-white block mt-0.5">
                  【{parseResult?.suggested_new_matter?.title}】
                </span>
              </div>
              <div className="flex items-center justify-end gap-2 pt-0.5">
                <button
                  onClick={handleClose}
                  className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                >
                  取消 (Esc)
                </button>
                <button
                  onClick={handleConfirmCreateNew}
                  className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded text-xs font-semibold cursor-pointer"
                >
                  确认新建 (Enter)
                </button>
              </div>
            </div>
          )}

          <div className="pt-1 text-[10px] text-slate-400 text-center border-t border-slate-100 dark:border-slate-800">
            按数字键或 [Enter] 快速选择，按 [Esc] 忽略
          </div>
        </div>
      ) : (
        /* === 极简灵动微胶囊模式 (Minimal Floating Capsule) —— 覆盖 95% 热键发送场景 === */
        <div className="w-full h-full rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-slate-200/90 dark:border-slate-700/80 ring-1 ring-slate-900/5 dark:ring-white/10 shadow-[0_12px_30px_rgba(0,0,0,0.18)] dark:shadow-[0_15px_35px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)] flex items-center px-3 py-1.5 text-slate-800 dark:text-slate-100 animate-in fade-in slide-in-from-bottom-1 duration-150 overflow-hidden">
          {/* 1. 感知分析中 (Loading Pill) */}
          {loading && (
            <div className="w-full flex items-center justify-between gap-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="relative flex items-center justify-center w-5 h-5 shrink-0">
                  <div className="absolute inset-0 rounded-full border-2 border-sky-400/30 border-t-sky-500 animate-spin" />
                  <Sparkles className="w-2.5 h-2.5 text-sky-500 animate-pulse" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate leading-tight">
                    智能归集中...
                  </span>
                  <span className="text-[10px] text-slate-400 truncate leading-tight mt-0.5">
                    正在分析语义与匹配事项
                  </span>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                title="取消 (Esc)"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 2. 未划选文字或异常 (Warning / Error Pill) */}
          {!loading && errorMessage && (
            <div className="w-full flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-5 h-5 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-3.5 h-3.5" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate leading-tight">
                    {errorMessage}
                  </span>
                  <span className="text-[10px] text-slate-400 truncate leading-tight mt-0.5">
                    请先鼠标选中文本，再按快捷键
                  </span>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 3. 高置信度自动归集成功 (Success Capsule - 核心体验) */}
          {!loading && !errorMessage && parseResult && parseResult.action === 'MATCH_EXISTING' && (
            <div className="w-full flex items-center justify-between gap-2">
              {/* 左侧绿勾图标 */}
              <div className="w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-4 h-4" />
              </div>

              {/* 中间信息：首行显示已归集事项，次行显示待办核销/提取或事实 */}
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <div className="flex items-center gap-1 truncate leading-tight">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    已归集至 <span className="text-sky-600 dark:text-sky-400 font-extrabold">【{parseResult.matched_matter_title}】</span>
                  </span>
                </div>

                {/* 次行精炼信息 */}
                <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {parseResult.todo_updates && parseResult.todo_updates.length > 0 ? (
                    <div className="flex items-center gap-1.5 truncate w-full">
                      <span className={`truncate font-medium ${undoneMap[parseResult.todo_updates[0].todo_id] ? 'line-through text-slate-400' : 'text-amber-600 dark:text-amber-400'}`}>
                        {parseResult.todo_updates[0].action === 'CLOSE' ? '已核销: ' : '已更新: '}
                        {parseResult.todo_updates[0].original_content}
                      </span>
                      <button
                        onClick={() => handleUndoUpdate(parseResult.todo_updates![0])}
                        disabled={!!undoneMap[parseResult.todo_updates[0].todo_id]}
                        className={`ml-auto px-1.5 py-0.2 rounded text-[10px] font-bold flex items-center gap-0.5 shrink-0 transition-all cursor-pointer ${
                          undoneMap[parseResult.todo_updates[0].todo_id]
                            ? 'text-slate-400 bg-slate-100 dark:bg-slate-800 cursor-not-allowed'
                            : 'text-amber-700 dark:text-amber-300 bg-amber-100/90 dark:bg-amber-950/80 hover:bg-amber-200 dark:hover:bg-amber-900 shadow-2xs active:scale-95'
                        }`}
                        title="撤销此待办的关闭/变更"
                      >
                        <Undo2 className="w-2.5 h-2.5" />
                        <span>{undoneMap[parseResult.todo_updates[0].todo_id] ? '已撤销' : '撤销'}</span>
                      </button>
                    </div>
                  ) : parseResult.extracted_todos.length > 0 ? (
                    <span className="truncate text-slate-600 dark:text-slate-300">
                      <Clock className="w-2.5 h-2.5 inline mr-1 text-sky-500" />
                      待办: {parseResult.extracted_todos[0].content}
                    </span>
                  ) : (
                    <span className="truncate text-emerald-600 dark:text-emerald-400">
                      ✓ 核心事实与碎片日志已入库
                    </span>
                  )}
                </div>
              </div>

              {/* 右侧倒计时指示与快速关闭 */}
              <div className="flex items-center gap-1 shrink-0 pl-1.5 border-l border-slate-100 dark:border-slate-800/80">
                {countdown !== null && (
                  <span
                    className="text-[10px] font-medium text-slate-400 px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800/70"
                    title={isHovered ? '鼠标悬浮暂停计时' : `${countdown}s 后自动淡出`}
                  >
                    {isHovered ? '暂停' : `${countdown}s`}
                  </span>
                )}
                <button
                  onClick={handleClose}
                  className="p-1 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  title="关闭 (Esc)"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}

          {/* 4. 等待就绪兜底 */}
          {!loading && !errorMessage && !parseResult && (
            <div className="w-full flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded-full border-2 border-sky-400/40 border-t-sky-500 animate-spin shrink-0" />
                <span className="text-xs text-slate-500">正在感知上下文...</span>
              </div>
              <button onClick={handleClose} className="p-1 text-slate-400">
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
