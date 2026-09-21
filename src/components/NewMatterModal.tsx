import React, { useState, useEffect, useRef } from 'react';
import { X, Briefcase, Heart, Sparkles } from 'lucide-react';
import { api } from '../services/api';

interface NewMatterModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const NewMatterModal: React.FC<NewMatterModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  if (!isOpen) return null;

  const [title, setTitle] = useState('');
  const [overview, setOverview] = useState('');
  const [relatedContacts, setRelatedContacts] = useState('');
  const [category, setCategory] = useState<'work' | 'life'>('work');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [importance, setImportance] = useState(3);
  const [loading, setLoading] = useState(false);

  const isMouseDownOnBackdrop = useRef(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isMouseDownOnBackdrop.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isMouseDownOnBackdrop.current && e.target === e.currentTarget) {
      onClose();
    }
    isMouseDownOnBackdrop.current = false;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    setLoading(true);
    try {
      await api.createMatter({
        title: title.trim(),
        overview: overview.trim(),
        category,
        priority,
        importance,
        related_contacts: relatedContacts.trim(),
      });
      onSuccess();
      onClose();
    } catch (e) {
      console.error('创建事项失败', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 dark:bg-black/70 backdrop-blur-sm dark:backdrop-blur-md select-none p-4"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-700/80 ring-1 ring-slate-900/5 dark:ring-white/10 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.3),0_10px_25px_-5px_rgba(15,23,42,0.15)] dark:shadow-[0_30px_90px_rgba(0,0,0,0.9),0_12px_36px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.08)] overflow-hidden animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/30">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 dark:bg-sky-400/10 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Sparkles className="w-4.5 h-4.5" />
            </div>
            <span>新建事项</span>
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
            title="关闭 (Esc)"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {/* 标题 */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              事项标题 <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：A银行系统技术架构白皮书交付"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:bg-white"
            />
          </div>

          {/* 类别与优先级 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                分类
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCategory('work')}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl border font-semibold transition-all ${
                    category === 'work'
                      ? 'border-sky-500 bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500'
                  }`}
                >
                  <Briefcase className="w-3.5 h-3.5" />
                  工作
                </button>
                <button
                  type="button"
                  onClick={() => setCategory('life')}
                  className={`flex-1 flex items-center justify-center gap-1 py-2 rounded-xl border font-semibold transition-all ${
                    category === 'life'
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-slate-700 text-slate-500'
                  }`}
                >
                  <Heart className="w-3.5 h-3.5" />
                  生活
                </button>
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                优先级
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none font-medium"
              >
                <option value="high">高优先级 (Urgent)</option>
                <option value="medium">中优先级 (Normal)</option>
                <option value="low">低优先级 (Low)</option>
              </select>
            </div>
          </div>

          {/* 重要度 */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              重要程度 ({importance} 星)
            </label>
            <input
              type="range"
              min={1}
              max={5}
              value={importance}
              onChange={(e) => setImportance(Number(e.target.value))}
              className="w-full accent-sky-500"
            />
          </div>

          {/* 关联人/群配置 */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block font-bold text-slate-700 dark:text-slate-300">
                关联人 / 关联群聊配置
              </label>
              <span className="text-[11px] text-slate-400">
                多个用逗号、顿号或空格分隔
              </span>
            </div>
            <input
              type="text"
              value={relatedContacts}
              onChange={(e) => setRelatedContacts(e.target.value)}
              placeholder="例如：潮汕话标注群, 陈伟豪, 李总, 硬件组"
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:bg-white"
            />
            <p className="text-[10px] text-slate-400 mt-1">
              💡 关键线索：在微信/企微对应群聊或与联系人划选文本时，系统将优先自动归集到该事项。
            </p>
          </div>

          {/* 简要概述 */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              简要概述 / 背景目标
            </label>
            <textarea
              rows={2}
              value={overview}
              onChange={(e) => setOverview(e.target.value)}
              placeholder="简要记录该事项的目标、背景或预期产出..."
              className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 focus:bg-white leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl shadow-sm transition-all"
            >
              {loading ? '创建中...' : '立即创建'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
