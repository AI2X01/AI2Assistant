import React, { useState } from 'react';
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
  const [category, setCategory] = useState<'work' | 'life'>('work');
  const [priority, setPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [importance, setImportance] = useState(3);
  const [loading, setLoading] = useState(false);

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs select-none">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-sky-500" />
            新建事项
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
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

          {/* 简要概述 */}
          <div>
            <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
              简要概述 / 背景目标
            </label>
            <textarea
              rows={3}
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
