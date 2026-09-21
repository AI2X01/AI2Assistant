import React, { useState, useEffect, useRef } from 'react';
import { X, Edit3, Briefcase, Heart, Star, Check } from 'lucide-react';
import { Matter, CategoryType, PriorityType, StatusType } from '../types';
import { api } from '../services/api';

interface EditMatterModalProps {
  matter: Matter | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (updatedMatter: Matter) => void;
}

export const EditMatterModal: React.FC<EditMatterModalProps> = ({
  matter,
  isOpen,
  onClose,
  onSuccess,
}) => {
  if (!isOpen || !matter) return null;

  const [title, setTitle] = useState(matter.title);
  const [overview, setOverview] = useState(matter.overview || '');
  const [factSummary, setFactSummary] = useState(matter.fact_summary || '');
  const [relatedContacts, setRelatedContacts] = useState(matter.related_contacts || '');
  const [category, setCategory] = useState<CategoryType>(matter.category);
  const [priority, setPriority] = useState<PriorityType>(matter.priority);
  const [importance, setImportance] = useState<number>(matter.importance || 3);
  const [status, setStatus] = useState<StatusType>(matter.status || 'active');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (matter) {
      setTitle(matter.title);
      setOverview(matter.overview || '');
      setFactSummary(matter.fact_summary || '');
      setRelatedContacts(matter.related_contacts || '');
      setCategory(matter.category);
      setPriority(matter.priority);
      setImportance(matter.importance || 3);
      setStatus(matter.status || 'active');
      setError(null);
    }
  }, [matter, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('事项标题不能为空');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const updated: Matter = {
        ...matter,
        title: title.trim(),
        overview: overview.trim(),
        fact_summary: factSummary.trim(),
        related_contacts: relatedContacts.trim(),
        category,
        priority,
        importance,
        status,
      };
      await api.updateMatter(updated);
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      console.error('更新事项失败', err);
      setError(err?.message || '保存事项修改失败，请重试');
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
        {/* 标题栏 */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold text-sm">
            <div className="w-8 h-8 rounded-xl bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 flex items-center justify-center">
              <Edit3 className="w-4 h-4" />
            </div>
            <span>编辑事项信息</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单内容 */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {error && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 text-xs text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}

          {/* 事项标题 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              事项标题 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：核心业务系统白皮书交付"
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-sky-500 transition-all"
            />
          </div>

          {/* 分类与状态 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">分类</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCategory('work')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    category === 'work'
                      ? 'bg-sky-50 dark:bg-sky-950/60 border-sky-300 dark:border-sky-700 text-sky-600 dark:text-sky-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <Briefcase className="w-3.5 h-3.5" />
                  工作
                </button>
                <button
                  type="button"
                  onClick={() => setCategory('life')}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
                    category === 'life'
                      ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50'
                  }`}
                >
                  <Heart className="w-3.5 h-3.5" />
                  生活
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">事项状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as StatusType)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 outline-none"
              >
                <option value="active">进行中 (Active)</option>
                <option value="pending">已挂起 (Pending)</option>
                <option value="completed">已完成 (Completed)</option>
                <option value="archived">已归档 (Archived)</option>
              </select>
            </div>
          </div>

          {/* 优先级与重要度 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">优先级</label>
              <div className="flex gap-1.5">
                {(['high', 'medium', 'low'] as PriorityType[]).map((p) => {
                  const labelMap = { high: '高', medium: '中', low: '低' };
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                        priority === p
                          ? p === 'high'
                            ? 'bg-rose-50 border-rose-300 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400'
                            : p === 'medium'
                            ? 'bg-amber-50 border-amber-300 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400'
                            : 'bg-slate-100 border-slate-300 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {labelMap[p]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">重要度星级</label>
              <div className="flex items-center gap-1.5 py-1.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => setImportance(star)}
                    className="p-1 hover:scale-110 transition-transform"
                  >
                    <Star
                      className={`w-4 h-4 ${
                        star <= importance
                          ? 'fill-amber-400 text-amber-400'
                          : 'text-slate-300 dark:text-slate-600'
                      }`}
                    />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 概述 */}
          {/* 关联人/群配置 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                关联人 / 关联群聊配置
              </label>
              <span className="text-[10px] text-slate-400">
                用逗号或空格隔开，如：潮汕话标注群, 陈伟豪
              </span>
            </div>
            <input
              type="text"
              value={relatedContacts}
              onChange={(e) => setRelatedContacts(e.target.value)}
              placeholder="例如：潮汕话标注群, 陈伟豪, 李总, 业务对接组"
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-sky-500 transition-all"
            />
          </div>

          {/* 事项概述 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">事项概述</label>
            <textarea
              rows={2}
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              placeholder="简明描述该事项的总体目标或背景..."
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-sky-500 transition-all resize-none"
            />
          </div>

          {/* 核心事实沉淀 */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              核心事实沉淀 (关键约束、商务、共识)
            </label>
            <textarea
              rows={4}
              value={factSummary}
              onChange={(e) => setFactSummary(e.target.value)}
              placeholder="• 商务约束: ...&#10;• 关键共识: ...&#10;• 交付时间: ..."
              className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white outline-none focus:border-sky-500 transition-all resize-none leading-relaxed"
            />
          </div>

          {/* 底部动作 */}
          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-1.5 px-5 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-xl shadow-sm shadow-sky-600/20 active:scale-95 transition-all"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{loading ? '保存中...' : '保存修改'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
