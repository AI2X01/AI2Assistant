import React from 'react';
import {
  Pin,
  Clock,
  CheckCircle2,
  ChevronRight,
  Briefcase,
  Heart,
  Archive,
  RotateCcw,
  Star,
} from 'lucide-react';
import { Matter } from '../types';

interface MatterCardProps {
  matter: Matter;
  onSelect: (matter: Matter) => void;
  onTogglePin: (id: string, e: React.MouseEvent) => void;
  onUpdateStatus: (id: string, status: string, e: React.MouseEvent) => void;
}

export const MatterCard: React.FC<MatterCardProps> = ({
  matter,
  onSelect,
  onTogglePin,
  onUpdateStatus,
}) => {
  const isWork = matter.category === 'work';
  const isArchived = matter.status === 'archived';
  const isCompleted = matter.status === 'completed';

  const priorityColors = {
    high: 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/50',
    medium: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900/50',
    low: 'text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/50',
  };

  const priorityLabels = {
    high: '高优先级',
    medium: '中优先级',
    low: '低优先级',
  };

  return (
    <div
      onClick={() => onSelect(matter)}
      className={`group relative rounded-2xl border p-5 transition-all duration-200 cursor-pointer flex flex-col justify-between ${
        matter.is_pinned
          ? 'bg-gradient-to-b from-sky-50/50 to-white dark:from-sky-950/20 dark:to-slate-900 border-sky-300 dark:border-sky-800/60 shadow-md shadow-sky-500/5'
          : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-lg shadow-sm'
      } ${isArchived ? 'opacity-70 bg-slate-50/60 dark:bg-slate-950/60' : ''}`}
    >
      <div>
        {/* 卡片顶部：置顶、分类、优先级、重要度 */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* 分类胶囊 */}
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                isWork
                  ? 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/60'
                  : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60'
              }`}
            >
              {isWork ? <Briefcase className="w-3 h-3" /> : <Heart className="w-3 h-3" />}
              {isWork ? '工作' : '生活'}
            </span>

            {/* 优先级 */}
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${priorityColors[matter.priority]}`}>
              {priorityLabels[matter.priority]}
            </span>

            {/* 重要度星级 */}
            <div className="flex items-center text-amber-400 ml-1">
              {Array.from({ length: Math.min(5, matter.importance) }).map((_, i) => (
                <Star key={i} className="w-2.5 h-2.5 fill-amber-400" />
              ))}
            </div>
          </div>

          {/* 置顶按钮 */}
          <button
            onClick={(e) => onTogglePin(matter.id, e)}
            className={`p-1.5 rounded-lg transition-all ${
              matter.is_pinned
                ? 'text-sky-600 dark:text-sky-400 bg-sky-100 dark:bg-sky-900/60'
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100'
            }`}
            title={matter.is_pinned ? '取消置顶' : '置顶事项'}
          >
            <Pin className={`w-3.5 h-3.5 ${matter.is_pinned ? 'fill-current' : ''}`} />
          </button>
        </div>

        {/* 事项标题 */}
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-snug line-clamp-2 mb-2 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
          {matter.title}
        </h3>

        {/* 核心事实摘要预览 */}
        {matter.fact_summary ? (
          <div className="mb-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800/80 text-slate-600 dark:text-slate-300 text-xs leading-relaxed line-clamp-3 whitespace-pre-line font-normal">
            {matter.fact_summary}
          </div>
        ) : matter.overview ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-3 leading-relaxed">
            {matter.overview}
          </p>
        ) : null}

        {/* 最新一条碎片日志 */}
        {matter.latest_log_snippet && (
          <div className="flex items-start gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mb-3 bg-slate-100/70 dark:bg-slate-800/40 p-2 rounded-lg">
            <Clock className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
            <span className="line-clamp-1 italic">"{matter.latest_log_snippet}"</span>
          </div>
        )}
      </div>

      {/* 卡片底部：待办进度与快捷动作 */}
      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between mt-auto text-xs">
        {/* 待办计数 */}
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span className="font-medium text-[11px]">
            待办 {matter.pending_todos_count || 0} 项未完 / 共 {matter.total_todos_count || 0} 项
          </span>
        </div>

        {/* 快捷操作 */}
        <div className="flex items-center gap-1">
          {isArchived ? (
            <button
              onClick={(e) => onUpdateStatus(matter.id, 'active', e)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-950/40 rounded-md transition-all"
              title="重新激活到进行中"
            >
              <RotateCcw className="w-3 h-3" />
              激活
            </button>
          ) : (
            <>
              <button
                onClick={(e) => onUpdateStatus(matter.id, isCompleted ? 'active' : 'completed', e)}
                className={`p-1 text-[11px] rounded transition-all ${
                  isCompleted ? 'text-emerald-600 hover:bg-emerald-50' : 'text-slate-400 hover:text-emerald-600 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={isCompleted ? '标记为未完成' : '标记已完成'}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => onUpdateStatus(matter.id, 'archived', e)}
                className="p-1 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded transition-all"
                title="归档事项"
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          <div className="text-slate-400 group-hover:text-sky-500 group-hover:translate-x-0.5 transition-all ml-1">
            <ChevronRight className="w-4 h-4" />
          </div>
        </div>
      </div>
    </div>
  );
};
