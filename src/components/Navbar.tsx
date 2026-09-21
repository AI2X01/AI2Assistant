import React, { useState, useRef, useEffect } from 'react';
import { LayoutGrid, CheckSquare, Plus, Settings, Search, Inbox, X, Sparkles, Sun, Moon, Laptop, Check, Minimize2 } from 'lucide-react';
import { useTheme } from '../services/theme';

interface NavbarProps {
  currentTab: 'matters' | 'todos' | 'inbox';
  setCurrentTab: (tab: 'matters' | 'todos' | 'inbox') => void;
  uncategorizedCount?: number;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onOpenNewMatter: () => void;
  onOpenSettings: () => void;
  onEnterCompactMode?: () => void;
  onTriggerMockCapture?: () => void;
  isCapturing?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  uncategorizedCount = 0,
  searchQuery,
  setSearchQuery,
  onOpenNewMatter,
  onOpenSettings,
  onEnterCompactMode,
}) => {
  const [isSearchOpen, setIsSearchOpen] = useState(Boolean(searchQuery));
  const searchInputRef = useRef<HTMLInputElement>(null);
  const themeMenuRef = useRef<HTMLDivElement>(null);
  const [isThemeMenuOpen, setIsThemeMenuOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  // 点击外部关闭主题菜单
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target as Node)) {
        setIsThemeMenuOpen(false);
      }
    };
    if (isThemeMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isThemeMenuOpen]);

  // 展开搜索框时自动获取焦点
  useEffect(() => {
    if (isSearchOpen) {
      searchInputRef.current?.focus();
    }
  }, [isSearchOpen]);

  // 如果外部传入或修改了 searchQuery，自动保持展开状态
  useEffect(() => {
    if (searchQuery) {
      setIsSearchOpen(true);
    }
  }, [searchQuery]);

  return (
    <header className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md grid grid-cols-[1fr_auto_1fr] items-center sticky top-0 z-30 select-none shrink-0">
      {/* 1. 左侧品牌 Logo 与标题：恢复为原版质感 Sparkles 图标 */}
      <div className="flex items-center gap-2.5 justify-self-start shrink-0">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20 shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white leading-none">
            AI助手
          </h1>
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">个人事项智能整理小助手</span>
        </div>
      </div>

      {/* 2. 中间核心功能导航：位于 1fr_auto_1fr 网格正中心，实现真正物理居中 */}
      <nav className="flex items-center gap-2 bg-slate-100/90 dark:bg-slate-800/90 p-1.5 rounded-2xl border border-slate-200/80 dark:border-slate-700/60 shadow-xs justify-self-center shrink-0">
        <button
          onClick={() => setCurrentTab('matters')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer ${
            currentTab === 'matters'
              ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-md shadow-slate-200/80 dark:shadow-slate-950/50 ring-1 ring-slate-900/5 dark:ring-white/10 scale-[1.02]'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/40'
          }`}
        >
          <LayoutGrid className="w-[18px] h-[18px]" />
          <span>事项看板</span>
        </button>

        <button
          onClick={() => setCurrentTab('todos')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer ${
            currentTab === 'todos'
              ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-md shadow-slate-200/80 dark:shadow-slate-950/50 ring-1 ring-slate-900/5 dark:ring-white/10 scale-[1.02]'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/40'
          }`}
        >
          <CheckSquare className="w-[18px] h-[18px]" />
          <span>待办清单</span>
        </button>

        <button
          onClick={() => setCurrentTab('inbox')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all duration-200 cursor-pointer ${
            currentTab === 'inbox'
              ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-300 shadow-md shadow-slate-200/80 dark:shadow-slate-950/50 ring-1 ring-slate-900/5 dark:ring-white/10 scale-[1.02]'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/60 dark:hover:bg-slate-700/40'
          }`}
        >
          <Inbox className="w-[18px] h-[18px]" />
          <span>AI 收件箱</span>
          {uncategorizedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs bg-gradient-to-r from-amber-500 to-orange-500 text-white font-bold shadow-xs animate-pulse">
              {uncategorizedCount}
            </span>
          )}
        </button>
      </nav>

      {/* 3. 右侧搜索与操作区：搜索可收缩展开，划选测试按钮已移除 */}
      <div className="flex items-center gap-2.5 justify-self-end shrink-0">
        {/* 可收缩/展开的搜索组件 */}
        {isSearchOpen ? (
          <div className="relative flex items-center animate-in fade-in zoom-in-95 duration-200">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  if (searchQuery) {
                    setSearchQuery('');
                  } else {
                    setIsSearchOpen(false);
                  }
                }
              }}
              onBlur={() => {
                if (!searchQuery.trim()) {
                  setIsSearchOpen(false);
                }
              }}
              placeholder="搜索事项、事实、日志..."
              className="w-44 sm:w-56 pl-9 pr-8 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:border-sky-500 focus:bg-white dark:focus:bg-slate-900 text-slate-900 dark:text-white placeholder-slate-400 outline-none transition-all shadow-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (searchQuery) {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                } else {
                  setIsSearchOpen(false);
                }
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-all cursor-pointer"
              title={searchQuery ? '清空搜索' : '收起搜索'}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsSearchOpen(true)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer"
            title="搜索事项与日志"
          >
            <Search className="w-4 h-4" />
          </button>
        )}

        {/* 新建事项 */}
        <button
          onClick={onOpenNewMatter}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-sm shadow-sky-600/20 active:scale-95 transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          新建事项
        </button>

        {/* 主题模式切换下拉控件 */}
        <div className="relative" ref={themeMenuRef}>
          <button
            onClick={() => setIsThemeMenuOpen(!isThemeMenuOpen)}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer"
            title={`主题模式: ${theme === 'light' ? '浅色模式' : theme === 'dark' ? '深色模式' : '跟随系统'}`}
          >
            {theme === 'light' && <Sun className="w-4 h-4 text-amber-500" />}
            {theme === 'dark' && <Moon className="w-4 h-4 text-sky-400" />}
            {theme === 'system' && <Laptop className="w-4 h-4 text-slate-500 dark:text-slate-400" />}
          </button>

          {isThemeMenuOpen && (
            <div className="absolute right-0 mt-2 w-36 p-1 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 ring-1 ring-slate-900/5 dark:ring-white/10 shadow-[0_15px_35px_-5px_rgba(15,23,42,0.25)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.85),0_0_0_1px_rgba(255,255,255,0.08)] z-50 animate-in fade-in zoom-in-95 duration-100">
              <button
                onClick={() => {
                  setTheme('light');
                  setIsThemeMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  theme === 'light'
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 font-bold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Sun className="w-3.5 h-3.5 text-amber-500" />
                  <span>浅色模式</span>
                </div>
                {theme === 'light' && <Check className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => {
                  setTheme('dark');
                  setIsThemeMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  theme === 'dark'
                    ? 'bg-sky-50 dark:bg-sky-950/40 text-sky-600 dark:text-sky-400 font-bold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Moon className="w-3.5 h-3.5 text-sky-400" />
                  <span>深色模式</span>
                </div>
                {theme === 'dark' && <Check className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => {
                  setTheme('system');
                  setIsThemeMenuOpen(false);
                }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                  theme === 'system'
                    ? 'bg-slate-100 dark:bg-slate-700 text-sky-600 dark:text-sky-400 font-bold'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/60'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Laptop className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>跟随系统</span>
                </div>
                {theme === 'system' && <Check className="w-3.5 h-3.5" />}
              </button>
            </div>
          )}
        </div>

        {/* 缩略模式（桌面常驻待办便签） */}
        {onEnterCompactMode && (
          <button
            onClick={onEnterCompactMode}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-sky-600 dark:hover:text-sky-400 transition-all cursor-pointer"
            title="缩略模式（常驻桌面右上角展示待办）"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        )}

        {/* 设置中心 */}
        <button
          onClick={onOpenSettings}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-all cursor-pointer"
          title="系统与模型配置"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
