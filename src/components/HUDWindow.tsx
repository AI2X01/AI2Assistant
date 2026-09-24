import React, { useState, useEffect, useRef } from 'react';
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
  ExternalLink,
  ArrowLeftRight,
  Search,
  Plus,
  ChevronDown,
  Inbox,
} from 'lucide-react';
import { AIParseResult, CapturedContext, Matter, TodoItem, TodoUpdateSuggestion } from '../types';
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

function formatDueTimeLabel(dueTimeStr: string | null | undefined): string {
  if (!dueTimeStr) return '';
  try {
    const target = new Date(dueTimeStr.replace(/-/g, '/'));
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
    const diffDays = Math.round((targetDay.getTime() - today.getTime()) / (1000 * 3600 * 24));

    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    const timePart = `${pad(target.getHours())}:${pad(target.getMinutes())}`;

    if (diffDays === 0) return `今天 ${timePart}`;
    if (diffDays === 1) return `明天 ${timePart}`;
    if (diffDays === 2) return `后天 ${timePart}`;
    return `${pad(target.getMonth() + 1)}-${pad(target.getDate())} ${timePart}`;
  } catch {
    return dueTimeStr.slice(5, 16);
  }
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

  // 人为调整归集与撤销状态
  const [isReRouting, setIsReRouting] = useState(false);
  const [isCreatingNewMode, setIsCreatingNewMode] = useState(false);
  const [activeMatters, setActiveMatters] = useState<Matter[]>([]);
  const [reRouteSearch, setReRouteSearch] = useState('');
  const [newMatterTitle, setNewMatterTitle] = useState('');

  // 待办到期提醒状态
  const [reminderTodos, setReminderTodos] = useState<TodoItem[]>([]);
  const [isSnoozing, setIsSnoozing] = useState(false);
  const [customSnoozeTime, setCustomSnoozeTime] = useState<string>(getDefaultCustomTime);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const currentReminder = reminderTodos[0];

  // 动态同步物理窗口尺寸：极简胶囊 (capsule: 380x80) vs 决策/调整面板 (expanded: 400x250) vs 待办提醒 (reminder: 400x270)
  // 保持低干扰设计原则：仅当用户主动点击“手动归集/调整”或存在“多候选事项歧义待单选”时才展开面板，未匹配事项默认以极简微胶囊展示
  const prevModeRef = useRef<string>('');
  useEffect(() => {
    let mode: 'reminder' | 'expanded' | 'capsule' = 'capsule';
    if (currentReminder) {
      mode = 'reminder';
    } else if (isReRouting || parseResult?.action === 'AMBIGUOUS') {
      mode = 'expanded';
    } else {
      mode = 'capsule';
    }

    if (prevModeRef.current !== mode) {
      prevModeRef.current = mode;
      api.resizeHudWindow(mode).catch(() => {});
    }
  }, [currentReminder, parseResult, isReRouting]);

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

  // 键盘快捷盲操 (待办提醒快捷完成/推迟，划选数字键选择、Enter 新建、Esc 忽略/返回)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (currentReminder) {
          handleDismissReminder(currentReminder);
        } else if (isReRouting) {
          handleCancelReRoute();
        } else {
          handleClose();
        }
      } else if (currentReminder) {
        if (!isSnoozing && e.key === 'Enter') {
          handleAcknowledge(currentReminder);
        }
      } else if (isReRouting) {
        if (!isCreatingNewMode) {
          const num = parseInt(e.key, 10);
          const candidates = activeMatters.filter((m) => {
            if (!reRouteSearch.trim()) return true;
            const q = reRouteSearch.toLowerCase();
            return (m.title || '').toLowerCase().includes(q) || (m.overview || '').toLowerCase().includes(q);
          });
          if (!isNaN(num) && num >= 1 && num <= candidates.length) {
            const target = candidates[num - 1];
            if (target && target.id !== parseResult?.matched_matter_id) {
              handleAssignToExisting(target.id, target.title);
            }
          }
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
  }, [parseResult, currentReminder, isSnoozing, reminderTodos, isReRouting, isCreatingNewMode, activeMatters, reRouteSearch]);

  // 自动倒计时淡出机制（鼠标悬停、调整中或有待办提醒时暂停倒计时）
  useEffect(() => {
    if (currentReminder || isReRouting) return; // 有到期待办提醒或正在调整归集时绝不自动淡出
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
  }, [countdown, isHovered, currentReminder, isReRouting]);

  // 空闲防卡死兜底：如果没有任何内容且未在 loading，300ms 后自动静默收起
  useEffect(() => {
    if (currentReminder || isReRouting) return;
    if (!loading && !parseResult && !errorMessage) {
      const idleTimer = setTimeout(() => {
        handleClose();
      }, 300);
      return () => clearTimeout(idleTimer);
    }
  }, [loading, parseResult, errorMessage, currentReminder, isReRouting]);

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

      if (res.action === 'MATCH_EXISTING' && res.matched_matter_id) {
        // 极简胶囊成功态：给予 6 秒充足时间展示归集结果与快捷操作（悬停自动暂停）
        setCountdown(6);
        await emit('refresh-data');
      } else {
        // 未匹配到事项，给用户 6 秒时间提示并支持下拉手动归集或新建（悬停时自动暂停倒计时）
        setCountdown(6);
      }
    } catch (e: any) {
      console.warn('解析失败', e);
      const msg = typeof e === 'string' ? e : e?.message || '解析失败，请重试';
      setErrorMessage(msg);
      setCountdown(3);
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

      if (res.action === 'MATCH_EXISTING' && res.matched_matter_id) {
        setCountdown(6);
        await emit('refresh-data');
      } else {
        setCountdown(6);
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
    try {
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
      await emit('refresh-data');
    } catch (err) {
      console.error('确认归集到现有事项失败', err);
    }
    handleClose();
  };

  const handleConfirmCreateNew = async () => {
    if (!parseResult) return;
    try {
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
      await emit('refresh-data');
    } catch (err) {
      console.error('确认创建全新事项并归集失败', err);
    }
    handleClose();
  };

  // 1. 跳转到主看板对应事项详情抽屉（需求 1）
  const handleJumpToMatter = async (matterId?: string) => {
    const mid = matterId || parseResult?.matched_matter_id;
    if (!mid) return;
    try {
      await api.showMainWindow();
      await emit('open-matter-detail', { matterId: mid });
      handleClose();
    } catch (err) {
      console.error('跳转到事项结果页失败', err);
    }
  };

  // 2. 撤销本次归集（需求 2）
  const handleUndoCategorize = async () => {
    if (!parseResult || !parseResult.log_id) return;
    setActionFeedback('✓ 已撤销归集，内容已退回收件箱');
    try {
      await api.uncategorizeLog({
        log_id: parseResult.log_id,
        matter_id: parseResult.matched_matter_id,
        facts_delta: parseResult.extracted_facts_delta,
        todo_updates: parseResult.todo_updates,
      });
      await emit('refresh-data');
    } catch (err) {
      console.error('撤销归集失败', err);
    }
    setTimeout(() => {
      handleClose();
    }, 1200);
  };

  // 3. 打开调整/手动选择目标面板
  const handleStartReRoute = async () => {
    setCountdown(null);
    setIsCreatingNewMode(false);
    setReRouteSearch('');
    setNewMatterTitle(parseResult?.suggested_new_matter?.title || '');
    try {
      const list = await api.getMatters('active');
      setActiveMatters(list);
    } catch (err) {
      console.error('获取活跃事项列表失败', err);
    }
    setIsReRouting(true);
  };

  // 4. 打开新建事项归集面板
  const handleStartCreateNew = async () => {
    setCountdown(null);
    setIsCreatingNewMode(true);
    setReRouteSearch('');
    setNewMatterTitle(parseResult?.suggested_new_matter?.title || '');
    try {
      const list = await api.getMatters('active');
      setActiveMatters(list);
    } catch (err) {
      console.error('获取活跃事项列表失败', err);
    }
    setIsReRouting(true);
  };

  // 5. 取消面板
  const handleCancelReRoute = () => {
    setIsReRouting(false);
    setIsCreatingNewMode(false);
    api.resizeHudWindow('capsule');
    setCountdown(4);
  };

  // 6. 确认归集/调整到已有事项（自适应未归集直接确认 vs 已归集重新迁移）
  const handleAssignToExisting = async (targetMatterId: string, targetMatterTitle: string) => {
    if (!parseResult || !parseResult.log_id) return;
    setActionFeedback(`✓ 已归集至【${targetMatterTitle}】`);
    setIsReRouting(false);
    api.resizeHudWindow('capsule');
    try {
      if (parseResult.matched_matter_id) {
        // 原本已自动归集过，先从原事项撤回，再绑定到新事项
        await api.recategorizeLog({
          log_id: parseResult.log_id,
          old_matter_id: parseResult.matched_matter_id,
          old_facts_delta: parseResult.extracted_facts_delta,
          old_todo_updates: parseResult.todo_updates,
          choice: 'EXISTING',
          new_matter_id: targetMatterId,
          new_facts_delta: parseResult.extracted_facts_delta,
          new_todos: parseResult.extracted_todos,
        });
      } else {
        // 原本未归集到任何事项，直接确认归集到所选事项
        await api.confirmRouteDecision({
          choice: 'EXISTING',
          matter_id: targetMatterId,
          raw_snippet: parseResult.raw_snippet,
          source_app: parseResult.source_app,
          source_window: parseResult.source_window,
          extracted_facts_delta: parseResult.extracted_facts_delta,
          extracted_todos: parseResult.extracted_todos,
          todo_updates: parseResult.todo_updates,
          log_id: parseResult.log_id,
        });
      }
      await emit('refresh-data');
    } catch (err) {
      console.error('归集到现有事项失败', err);
    }
    setTimeout(() => {
      handleClose();
    }, 1200);
  };

  // 7. 确认新建事项并归集（自适应未归集直接新建 vs 已归集重新新建）
  const handleAssignToCreateNew = async (customTitle?: string) => {
    if (!parseResult || !parseResult.log_id) return;
    const title = (customTitle || newMatterTitle).trim() || parseResult.suggested_new_matter?.title || '新事项';
    setActionFeedback(`✓ 已创建【${title}】并归集`);
    setIsReRouting(false);
    api.resizeHudWindow('capsule');
    try {
      if (parseResult.matched_matter_id) {
        await api.recategorizeLog({
          log_id: parseResult.log_id,
          old_matter_id: parseResult.matched_matter_id,
          old_facts_delta: parseResult.extracted_facts_delta,
          old_todo_updates: parseResult.todo_updates,
          choice: 'CREATE_NEW',
          new_matter: {
            title,
            category: parseResult.suggested_new_matter?.category || 'work',
            priority: parseResult.suggested_new_matter?.priority || 'medium',
            summary: parseResult.suggested_new_matter?.summary || '',
            related_contacts: parseResult.suggested_new_matter?.related_contacts,
          },
          new_facts_delta: parseResult.extracted_facts_delta,
          new_todos: parseResult.extracted_todos,
        });
      } else {
        await api.confirmRouteDecision({
          choice: 'CREATE_NEW',
          new_matter: {
            title,
            category: parseResult.suggested_new_matter?.category || 'work',
            priority: parseResult.suggested_new_matter?.priority || 'medium',
            summary: parseResult.suggested_new_matter?.summary || '',
            related_contacts: parseResult.suggested_new_matter?.related_contacts,
          },
          raw_snippet: parseResult.raw_snippet,
          source_app: parseResult.source_app,
          source_window: parseResult.source_window,
          extracted_facts_delta: parseResult.extracted_facts_delta,
          extracted_todos: parseResult.extracted_todos,
          log_id: parseResult.log_id,
        });
      }
      await emit('refresh-data');
    } catch (err) {
      console.error('创建全新事项并归集失败', err);
    }
    setTimeout(() => {
      handleClose();
    }, 1200);
  };

  const handleClose = async () => {
    setParseResult(null);
    setErrorMessage(null);
    setCountdown(null);
    setIsReRouting(false);
    setIsCreatingNewMode(false);
    setActionFeedback(null);
    await api.hideHudWindow();
  };

  const filteredActiveMatters = activeMatters.filter((m) => {
    if (!reRouteSearch.trim()) return true;
    const q = reRouteSearch.toLowerCase();
    return (m.title || '').toLowerCase().includes(q) || (m.overview || '').toLowerCase().includes(q);
  });

  // 是否自动识别并匹配到了高置信度目标事项
  const isAutoMatched = !!(parseResult && parseResult.action === 'MATCH_EXISTING' && parseResult.matched_matter_id);

  // 是否为需要展开面板的交互模式（待办提醒 或 歧义多选项 或 人为调整/手动归集）
  const isExpandedMode = !!currentReminder || isReRouting || parseResult?.action === 'AMBIGUOUS';

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
        /* 交互选择展开面板（调整归集目标 / AMBIGUOUS 歧义多选项 / CREATE_NEW 建议新建） */
        <div className="w-full h-full rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-sky-400/40 dark:border-sky-500/40 ring-1 ring-sky-500/20 dark:ring-white/15 shadow-[0_15px_35px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.85)] p-3 flex flex-col justify-between text-slate-800 dark:text-slate-100 animate-in fade-in zoom-in-95 duration-150">
          {/* 1. 人为调整归集目标模式 (Re-routing View) */}
          {isReRouting ? (
            <div className="flex-1 flex flex-col justify-between min-h-0">
              {/* 顶部标题栏 */}
              <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${
                    parseResult?.matched_matter_id
                      ? 'bg-sky-500/15 text-sky-600 dark:text-sky-400'
                      : 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  }`}>
                    {parseResult?.matched_matter_id ? (
                      <ArrowLeftRight className="w-3 h-3" />
                    ) : (
                      <Inbox className="w-3 h-3" />
                    )}
                  </div>
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {parseResult?.matched_matter_id ? '调整归集目标事项' : '未匹配到事项 · 手动归集'}
                  </span>
                </div>
                <button
                  onClick={handleCancelReRoute}
                  className="text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-0.5 cursor-pointer"
                  title="返回 (Esc)"
                >
                  <ChevronLeft className="w-3 h-3" />
                  返回
                </button>
              </div>

              {isCreatingNewMode ? (
                /* 快速新建事项并归集模式 */
                <div className="flex-1 flex flex-col justify-between py-2 min-h-0 space-y-2 text-xs">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        新建事项标题：
                      </span>
                      <button
                        onClick={() => setIsCreatingNewMode(false)}
                        className="text-[10px] text-sky-600 hover:text-sky-500 dark:text-sky-400 cursor-pointer"
                      >
                        ← 选择已有事项
                      </button>
                    </div>
                    <input
                      type="text"
                      value={newMatterTitle}
                      onChange={(e) => setNewMatterTitle(e.target.value)}
                      placeholder="输入新建事项标题..."
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleAssignToCreateNew();
                      }}
                    />
                    <p className="text-[10px] text-slate-400 truncate">
                      划选内容: {parseResult?.raw_snippet?.slice(0, 36) || ''}...
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <button
                      onClick={() => setIsCreatingNewMode(false)}
                      className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
                    >
                      取消
                    </button>
                    <button
                      onClick={() => handleAssignToCreateNew()}
                      disabled={!newMatterTitle.trim()}
                      className="px-3 py-1 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white rounded text-xs font-semibold cursor-pointer shadow-sm active:scale-95 transition-all"
                    >
                      确认新建并归集 (Enter)
                    </button>
                  </div>
                </div>
              ) : (
                /* 选择已有活跃事项模式 */
                <div className="flex-1 flex flex-col min-h-0 py-1.5 space-y-1.5">
                  {/* 搜索过滤框 */}
                  <div className="relative">
                    <Search className="w-3 h-3 absolute left-2 top-2 text-slate-400" />
                    <input
                      type="text"
                      value={reRouteSearch}
                      onChange={(e) => setReRouteSearch(e.target.value)}
                      placeholder="搜索目标事项或直接按数字键选择..."
                      className="w-full pl-6 pr-2 py-1 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>

                  {/* 事项列表 */}
                  <div className="flex-1 overflow-y-auto space-y-1 min-h-0 pr-0.5">
                    {filteredActiveMatters.map((m, idx) => {
                      const isCurrent = m.id === parseResult?.matched_matter_id;
                      return (
                        <button
                          key={m.id}
                          onClick={() => handleAssignToExisting(m.id, m.title)}
                          disabled={isCurrent}
                          className={`w-full flex items-center justify-between p-1.5 rounded-lg text-left text-xs transition-all ${
                            isCurrent
                              ? 'bg-sky-50/50 dark:bg-sky-950/20 text-slate-400 border border-dashed border-sky-300/40 cursor-not-allowed'
                              : 'bg-slate-50 dark:bg-slate-800 hover:bg-sky-50 hover:text-sky-600 dark:hover:bg-slate-700/80 border border-slate-200/80 dark:border-slate-700/80 cursor-pointer'
                          }`}
                        >
                          <span className="font-medium truncate flex-1 mr-1.5">
                            <span className="font-bold text-sky-600 mr-1">[{idx + 1}]</span>
                            【{m.title}】
                          </span>
                          {isCurrent ? (
                            <span className="text-[10px] text-sky-600 dark:text-sky-400 font-semibold shrink-0">
                              当前
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-400 shrink-0">
                              选择
                            </span>
                          )}
                        </button>
                      );
                    })}

                    {filteredActiveMatters.length === 0 && (
                      <div className="text-center py-3 text-xs text-slate-400">
                        暂无匹配事项
                      </div>
                    )}

                    <button
                      onClick={() => {
                        setNewMatterTitle(parseResult?.suggested_new_matter?.title || '');
                        setIsCreatingNewMode(true);
                      }}
                      className="w-full flex items-center justify-between p-1.5 rounded-lg bg-sky-50/80 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-semibold border border-sky-200 dark:border-sky-800 hover:bg-sky-100 dark:hover:bg-sky-900/60 transition-all cursor-pointer text-left text-xs mt-1"
                    >
                      <span className="truncate flex-1 mr-1.5 flex items-center gap-1">
                        <Plus className="w-3 h-3 text-sky-600" />
                        <span>+ 创建全新事项并归集</span>
                      </span>
                      <ArrowRight className="w-3 h-3 shrink-0" />
                    </button>
                  </div>

                  <div className="pt-1 text-[10px] text-slate-400 text-center border-t border-slate-100 dark:border-slate-800">
                    按数字键快速选择已有事项，按 Esc 返回
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* 原有 AMBIGUOUS 或 CREATE_NEW 建议面板 */
            <>
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
            </>
          )}
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

          {/* 3. 解析结果胶囊展示（包括：自动匹配成功胶囊 / 未匹配事项待归集胶囊） */}
          {!loading && !errorMessage && parseResult && (
            actionFeedback ? (
              <div className="w-full flex items-center justify-center gap-2 text-center py-1 animate-in zoom-in-95 duration-150">
                <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 shrink-0">
                  <Check className="w-3 h-3" />
                </div>
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                  {actionFeedback}
                </span>
              </div>
            ) : isAutoMatched ? (
              /* 分支 3.1: 自动高置信度归集成功 */
              <div className="w-full flex items-center justify-between gap-2 min-w-0">
                {/* 左侧绿勾图标 */}
                <div className="w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                </div>

                {/* 中间信息：首行显示已归集事项 + 调整/撤销快捷按钮，次行显示待办核销/提取或事实 */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center justify-between gap-1 leading-tight">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate flex items-center gap-0.5">
                      已归集至{' '}
                      <button
                        onClick={() => handleJumpToMatter()}
                        className="inline-flex items-center gap-0.5 text-sky-600 dark:text-sky-400 font-extrabold hover:underline hover:text-sky-500 dark:hover:text-sky-300 transition-colors cursor-pointer group/jump max-w-[155px] truncate"
                        title="点击在主看板查看该事项详情"
                      >
                        <span className="truncate">【{parseResult.matched_matter_title}】</span>
                        <ExternalLink className="w-2.5 h-2.5 opacity-70 group-hover/jump:opacity-100 group-hover/jump:translate-x-0.5 transition-all shrink-0" />
                      </button>
                    </span>

                    {/* 快捷操作药丸：调整 & 撤销 */}
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <button
                        onClick={handleStartReRoute}
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60 hover:bg-sky-100 dark:hover:bg-sky-900/60 border border-sky-200/60 dark:border-sky-800/60 active:scale-95 transition-all flex items-center gap-0.5 cursor-pointer shrink-0"
                        title="调整归集到其他事项或新建事项"
                      >
                        <ArrowLeftRight className="w-2.5 h-2.5" />
                        <span>调整</span>
                      </button>
                      <button
                        onClick={handleUndoCategorize}
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-100 dark:hover:bg-rose-900/60 border border-rose-200/60 dark:border-rose-800/60 active:scale-95 transition-all flex items-center gap-0.5 cursor-pointer shrink-0"
                        title="撤销本次归集，放回待归接收件箱"
                      >
                        <Undo2 className="w-2.5 h-2.5" />
                        <span>撤销</span>
                      </button>
                    </div>
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
                      <span className="truncate text-slate-700 dark:text-slate-200 font-medium flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5 inline shrink-0 text-amber-500 dark:text-amber-400" />
                        {parseResult.extracted_todos[0].due_time && (
                          <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 px-1 py-0.2 rounded shrink-0">
                            {formatDueTimeLabel(parseResult.extracted_todos[0].due_time)}
                          </span>
                        )}
                        <span className="truncate">待办: {parseResult.extracted_todos[0].content}</span>
                        {parseResult.extracted_todos.length > 1 && (
                          <span className="text-[9px] text-slate-400 shrink-0 font-normal">
                            (+{parseResult.extracted_todos.length - 1}项)
                          </span>
                        )}
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
            ) : (
              /* 分支 3.2: 识别归集到事项目标为空（无匹配事项），提供下拉手动归集与新建事项入口 */
              <div className="w-full flex items-center justify-between gap-2 min-w-0">
                {/* 左侧收件箱徽标 */}
                <div className="w-5 h-5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
                  <Inbox className="w-3.5 h-3.5" />
                </div>

                {/* 中间信息：首行显示“未匹配到事项”+“待归集”与快捷操作，次行显示待办或收件箱摘要 */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="flex items-center justify-between gap-1 leading-tight">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                        未匹配到事项
                      </span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 font-medium shrink-0">
                        待归集
                      </span>
                    </div>

                    {/* 快捷操作药丸：下拉手动归集 & 新建事项 */}
                    <div className="flex items-center gap-1 shrink-0 ml-1">
                      <button
                        onClick={handleStartReRoute}
                        className="px-2 py-0.5 rounded text-[10px] font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/70 hover:bg-sky-100 dark:hover:bg-sky-900/80 border border-sky-200/80 dark:border-sky-800/80 active:scale-95 transition-all flex items-center gap-0.5 cursor-pointer shrink-0 shadow-2xs"
                        title="展开活跃事项下拉列表手动归集"
                      >
                        <span>手动归集</span>
                        <ChevronDown className="w-2.5 h-2.5 opacity-80" />
                      </button>
                      <button
                        onClick={handleStartCreateNew}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/70 hover:bg-emerald-100 dark:hover:bg-emerald-900/80 border border-emerald-200/80 dark:border-emerald-800/80 active:scale-95 transition-all flex items-center gap-0.5 cursor-pointer shrink-0 shadow-2xs"
                        title="为此内容新建一个事项并归集"
                      >
                        <Plus className="w-2.5 h-2.5" />
                        <span>新建</span>
                      </button>
                    </div>
                  </div>

                  {/* 次行精炼信息 */}
                  <div className="flex items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                    {parseResult.extracted_todos && parseResult.extracted_todos.length > 0 ? (
                      <span className="truncate text-slate-600 dark:text-slate-300">
                        <Clock className="w-2.5 h-2.5 inline mr-1 text-amber-500" />
                        待办: {parseResult.extracted_todos[0].content}
                      </span>
                    ) : parseResult.raw_snippet ? (
                      <span className="truncate text-slate-400 dark:text-slate-400">
                        已暂存收件箱: "{parseResult.raw_snippet.replace(/\s+/g, ' ').slice(0, 24)}..."
                      </span>
                    ) : (
                      <span className="truncate text-slate-400 dark:text-slate-500">
                        碎片内容已入收件箱，可手动归集或新建事项
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
            )
          )}
        </div>
      )}
    </div>
  );
};
