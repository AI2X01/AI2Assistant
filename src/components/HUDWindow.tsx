import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  CheckCircle2,
  X,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { AIParseResult } from '../types';
import { api } from '../services/api';
import { listen } from '@tauri-apps/api/event';

export const HUDWindow: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [parseResult, setParseResult] = useState<AIParseResult | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    // 监听后端发起的抓取事件
    const unlisten = listen('start-auto-capture', async () => {
      await handleTriggerCapture();
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 键盘快捷盲操 (1, 2, 3, Enter, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      } else if (parseResult?.action === 'AMBIGUOUS') {
        if (e.key === '1' && parseResult.candidate_matters[0]) {
          handleConfirmExisting(parseResult.candidate_matters[0].id);
        } else if (e.key === '2' && parseResult.candidate_matters[1]) {
          handleConfirmExisting(parseResult.candidate_matters[1].id);
        } else if (e.key === '3') {
          handleConfirmCreateNew();
        }
      } else if (parseResult?.action === 'CREATE_NEW' && e.key === 'Enter') {
        handleConfirmCreateNew();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [parseResult]);

  // 自动倒计时淡出
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      handleClose();
      return;
    }
    const timer = setTimeout(() => {
      setCountdown((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleTriggerCapture = async () => {
    setLoading(true);
    setParseResult(null);
    setCountdown(null);
    try {
      const res = await api.triggerCaptureAndAnalyze();
      setParseResult(res);

      // 高置信度且已自动归档，启动 3 秒淡出倒计时
      if (res.action === 'MATCH_EXISTING' && res.confidence >= 0.8) {
        setCountdown(3);
      }
    } catch (e: any) {
      console.error('抓取解析失败', e);
      handleClose();
    } finally {
      setLoading(false);
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
    });
    handleClose();
  };

  const handleClose = async () => {
    setParseResult(null);
    setCountdown(null);
    await api.hideHudWindow();
  };

  return (
    <div className="w-full h-full p-2 select-none">
      <div className="w-full h-full rounded-2xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-sky-400/40 dark:border-sky-500/30 shadow-2xl p-4 flex flex-col justify-between text-slate-800 dark:text-slate-100">
        {/* 顶部状态与关闭 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-bold text-sky-600 dark:text-sky-400">
            <Sparkles className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>AI2Assistant 智能感知</span>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 1. 解析中动效 */}
        {loading && (
          <div className="my-auto text-center space-y-2 py-4">
            <div className="inline-block w-8 h-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
            <p className="text-xs text-slate-500">正在分析语义、比对事项与提取行动项...</p>
          </div>
        )}

        {/* 2. 高置信度自动归档展示 */}
        {!loading && parseResult && parseResult.action === 'MATCH_EXISTING' && (
          <div className="my-auto space-y-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs">
              <CheckCircle2 className="w-4 h-4" />
              <span>已自动沉淀至：【{parseResult.matched_matter_title}】</span>
            </div>
            <p className="text-[11px] text-slate-500 line-clamp-2 italic bg-slate-100 dark:bg-slate-800 p-2 rounded-lg">
              "{parseResult.raw_snippet}"
            </p>
            {parseResult.extracted_todos.length > 0 && (
              <div className="text-[11px] text-sky-600 dark:text-sky-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                <span>自动提炼待办: {parseResult.extracted_todos[0].content}</span>
              </div>
            )}
            <div className="text-[10px] text-right text-slate-400">
              {countdown !== null ? `${countdown} 秒后自动收起` : ''}
            </div>
          </div>
        )}

        {/* 3. 歧义多意图候选选择 */}
        {!loading && parseResult && parseResult.action === 'AMBIGUOUS' && (
          <div className="my-auto space-y-2 text-xs">
            <span className="text-[11px] text-slate-500 block">检测到多项可能关联的事项，请单键选择：</span>
            <div className="space-y-1.5">
              {parseResult.candidate_matters.map((c, idx) => (
                <button
                  key={c.id}
                  onClick={() => handleConfirmExisting(c.id)}
                  className="w-full flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800 hover:bg-sky-50 hover:text-sky-600 transition-all border border-slate-200 dark:border-slate-700"
                >
                  <span className="font-medium text-left truncate">
                    <span className="font-bold text-sky-600 mr-1">[{idx + 1}]</span>
                    【{c.title}】
                  </span>
                  <span className="text-[10px] text-slate-400">匹配 {Math.round(c.confidence * 100)}%</span>
                </button>
              ))}

              <button
                onClick={handleConfirmCreateNew}
                className="w-full flex items-center justify-between p-2 rounded-xl bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 font-semibold border border-sky-200 dark:border-sky-800"
              >
                <span>
                  <span className="font-bold mr-1">[3]</span>+ 新建事项: "
                  {parseResult.suggested_new_matter?.title || '新事项'}"
                </span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="text-[10px] text-slate-400 text-center">按键盘数字键 [1~3] 盲操确认, [Esc] 忽略</div>
          </div>
        )}

        {/* 4. 推荐新建事项 */}
        {!loading && parseResult && parseResult.action === 'CREATE_NEW' && (
          <div className="my-auto space-y-2 text-xs">
            <span className="text-[11px] text-slate-500 block">未匹配到现有事项，建议新建：</span>
            <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <h4 className="font-bold text-slate-900 dark:text-white">
                【{parseResult.suggested_new_matter?.title}】
              </h4>
              <p className="text-[11px] text-slate-500 mt-1 line-clamp-1">
                {parseResult.raw_snippet}
              </p>
            </div>
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-slate-400">按 [Enter] 回车确认新建, [Esc] 忽略</span>
              <button
                onClick={handleConfirmCreateNew}
                className="px-3 py-1 bg-sky-600 hover:bg-sky-500 text-white rounded-lg font-semibold text-xs shadow-xs"
              >
                立即创建
              </button>
            </div>
          </div>
        )}

        {/* 底部小标签 */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-[10px] text-slate-400">
          <span>来源: {parseResult?.source_app || '前台应用'}</span>
          <span>按 Esc 立即收起</span>
        </div>
      </div>
    </div>
  );
};
