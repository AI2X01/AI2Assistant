import React, { useState } from 'react';
import {
  Pin,
  CheckCircle2,
  ChevronRight,
  Briefcase,
  Heart,
  Archive,
  RotateCcw,
  Star,
  Edit3,
  CheckSquare,
  ListTodo,
} from 'lucide-react';
import { Matter } from '../types';
import { EditMatterModal } from './EditMatterModal';

interface MatterCardProps {
  matter: Matter;
  onSelect: (matter: Matter) => void;
  onTogglePin: (id: string, e: React.MouseEvent) => void;
  onUpdateStatus: (id: string, status: string, e: React.MouseEvent) => void;
  onRefresh?: () => void;
}

export const MatterCard: React.FC<MatterCardProps> = ({
  matter,
  onSelect,
  onTogglePin,
  onUpdateStatus,
  onRefresh,
}) => {
  const [isEditOpen, setIsEditOpen] = useState(false);
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

          {/* 右上角操作区：编辑 & 置顶 */}
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditOpen(true);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 opacity-0 group-hover:opacity-100 transition-all"
              title="编辑事项信息"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>

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
        </div>

        {/* 事项标题 */}
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 tracking-tight leading-snug line-clamp-2 mb-1.5 group-hover:text-sky-600 dark:group-hover:text-sky-400 transition-colors">
          {matter.title}
        </h3>

        {/* 关联人/群胶囊 */}
        {matter.related_contacts && matter.related_contacts.trim() && (
          <div className="flex items-center gap-1 mb-2 flex-wrap">
            {matter.related_contacts
              .split(/[,，、;； ]+/)
              .filter(Boolean)
              .slice(0, 3)
              .map((c, i) => (
                <span
                  key={i}
                  className="px-1.5 py-0.5 text-[10px] font-medium rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/40"
                >
                  @{c}
                </span>
              ))}
            {matter.related_contacts.split(/[,，、;； ]+/).filter(Boolean).length > 3 && (
              <span className="text-[10px] text-slate-400">
                +{matter.related_contacts.split(/[,，、;； ]+/).filter(Boolean).length - 3}
              </span>
            )}
          </div>
        )}

        {/* 1. 核心事实沉淀 */}
        {matter.fact_summary ? (
          <div className="mb-2.5 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800/80 text-slate-600 dark:text-slate-300 text-xs leading-relaxed line-clamp-3 whitespace-pre-line font-normal">
            {matter.fact_summary}
          </div>
        ) : matter.overview ? (
          <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-2.5 leading-relaxed">
            {matter.overview}
          </p>
        ) : (
          <div className="text-[11px] text-slate-400 italic mb-2.5 p-2 rounded-lg bg-slate-50/50 dark:bg-slate-800/20 border border-dashed border-slate-100 dark:border-slate-800/60">
            • 暂无核心事实沉淀
          </div>
        )}

        {/* 2. 最新一条待办（取代原最新日志） */}
        {matter.latest_todo_content ? (
          <div className="flex items-start gap-2 text-xs text-slate-700 dark:text-slate-200 mb-3 bg-sky-50/70 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 p-2.5 rounded-xl">
            <CheckSquare className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${matter.latest_todo_status === 'completed' ? 'text-emerald-500' : 'text-sky-600 dark:text-sky-400'}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1 mb-0.5">
                <span className="text-[10px] font-semibold text-sky-600 dark:text-sky-400">
                  {matter.latest_todo_status === 'completed' ? '最近完成' : '最新待办'}
                </span>
                {matter.latest_todo_due_time && (
                  <span className="text-[10px] text-slate-400 font-mono">
                    {matter.latest_todo_due_time.slice(5, 16)}
                  </span>
                )}
              </div>
              <p className={`line-clamp-1 font-medium ${matter.latest_todo_status === 'completed' ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-100'}`}>
                {matter.latest_todo_content}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mb-3 bg-slate-50/80 dark:bg-slate-800/30 p-2 rounded-lg border border-dashed border-slate-200/80 dark:border-slate-800">
            <ListTodo className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0" />
            <span className="italic">暂无待办事项</span>
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

      {/* 卡片内嵌编辑弹窗 */}
      <EditMatterModal
        matter={matter}
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        onSuccess={() => {
          if (onRefresh) onRefresh();
        }}
      />
    </div>
  );
};
