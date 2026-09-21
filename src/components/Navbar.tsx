import React from 'react';
import { LayoutGrid, CheckSquare, Plus, Settings, Search, Sparkles, Zap } from 'lucide-react';

interface NavbarProps {
  currentTab: 'matters' | 'todos';
  setCurrentTab: (tab: 'matters' | 'todos') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onOpenNewMatter: () => void;
  onOpenSettings: () => void;
  onTriggerMockCapture: () => void;
  isCapturing: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  searchQuery,
  setSearchQuery,
  onOpenNewMatter,
  onOpenSettings,
  onTriggerMockCapture,
  isCapturing,
}) => {
  return (
    <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md flex items-center justify-between sticky top-0 z-30 select-none">
      {/* 品牌与视图切换 */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white leading-none">
              AI2Assistant
            </h1>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">智能事项与待办伴侣</span>
          </div>
        </div>

        {/* 视图 Tab */}
        <nav className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl">
          <button
            onClick={() => setCurrentTab('matters')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              currentTab === 'matters'
                ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            事项看板
          </button>
          <button
            onClick={() => setCurrentTab('todos')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              currentTab === 'todos'
                ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            待办清单
          </button>
        </nav>
      </div>

      {/* 搜索框与操作按钮 */}
      <div className="flex items-center gap-3">
        {/* 全局搜索框 */}
        <div className="relative w-64">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索事项、事实摘要、日志..."
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-transparent focus:border-sky-500 focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 outline-none transition-all"
          />
        </div>

        {/* 划选捕获测试触发器 */}
        <button
          onClick={onTriggerMockCapture}
          disabled={isCapturing}
          title="划选文本后按 Alt+A，或点击此按钮体验 AI 自动意图识别"
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-xl border border-sky-200 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-all"
        >
          <Zap className={`w-3.5 h-3.5 ${isCapturing ? 'animate-bounce text-amber-500' : 'text-sky-500'}`} />
          <span>{isCapturing ? 'AI 解析中...' : '划选测试 (Alt+A)'}</span>
        </button>

        {/* 新建事项 */}
        <button
          onClick={onOpenNewMatter}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-sm shadow-sky-600/20 active:scale-95 transition-all"
        >
          <Plus className="w-3.5 h-3.5" />
          新建事项
        </button>

        {/* 设置中心 */}
        <button
          onClick={onOpenSettings}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-all"
          title="系统与模型配置"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
