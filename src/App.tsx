import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { MatterCard } from './components/MatterCard';
import { MatterDrawer } from './components/MatterDrawer';
import { TodoBoard } from './components/TodoBoard';
import { InboxBoard } from './components/InboxBoard';
import { NewMatterModal } from './components/NewMatterModal';
import { SettingsModal } from './components/SettingsModal';
import { HUDWindow } from './components/HUDWindow';
import { CompactTodoWidget } from './components/CompactTodoWidget';
import { Matter } from './types';
import { api } from './services/api';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen } from '@tauri-apps/api/event';
import { Filter, ArrowUpDown, Inbox, Sparkles } from 'lucide-react';
import { initThemeSystem, setThemeMode } from './services/theme';
import { ThemeMode } from './types';

// 同步获取当前窗口 label，避免初始状态闪变
function getInitialWindowLabel(): string {
  try {
    // @ts-ignore
    const label = window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label;
    if (label) return label;
    const appWin = getCurrentWebviewWindow();
    if (appWin && appWin.label) return appWin.label;
  } catch { }
  return 'main';
}

export function App() {
  const [windowLabel, setWindowLabel] = useState<string>(getInitialWindowLabel);

  useEffect(() => {
    // 启动全局主题系统（系统深色偏好监听 & 多窗口广播响应）
    initThemeSystem();

    // 从持久化配置中拉取并对齐主题偏好
    api.getAppConfig().then((cfg) => {
      if (cfg?.theme) {
        setThemeMode(cfg.theme as ThemeMode, false);
      }
    }).catch(() => { });

    try {
      const appWin = getCurrentWebviewWindow();
      if (appWin && appWin.label) {
        setWindowLabel(appWin.label);
      }
    } catch {
      setWindowLabel('main');
    }
  }, []);

  // 动态同步 body 与 #root 的透明类
  useEffect(() => {
    if (windowLabel === 'hud') {
      document.body.classList.add('is-hud');
      document.getElementById('root')?.classList.add('is-hud');
    } else {
      document.body.classList.remove('is-hud');
      document.getElementById('root')?.classList.remove('is-hud');
    }
  }, [windowLabel]);

  // 如果是 HUD 右下角微窗，直接渲染 HUD 组件
  if (windowLabel === 'hud') {
    return <HUDWindow />;
  }

  return <MainWindow />;
}

function MainWindow() {
  const [currentTab, setCurrentTab] = useState<'matters' | 'todos' | 'inbox'>('matters');
  const [matters, setMatters] = useState<Matter[]>([]);
  const [selectedMatter, setSelectedMatter] = useState<Matter | null>(null);
  const [uncategorizedCount, setUncategorizedCount] = useState<number>(0);

  // 过滤与排序
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('updated');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filtersRef = React.useRef({ statusFilter, categoryFilter, sortBy });
  useEffect(() => {
    filtersRef.current = { statusFilter, categoryFilter, sortBy };
  }, [statusFilter, categoryFilter, sortBy]);

  // 弹窗状态
  const [isNewMatterOpen, setIsNewMatterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isCompactMode, setIsCompactMode] = useState(false);

  const handleEnterCompact = async () => {
    try {
      await api.enterCompactMode();
      setIsCompactMode(true);
    } catch (e) {
      console.error('进入缩略模式失败', e);
    }
  };

  const handleExitCompact = async () => {
    try {
      await api.exitCompactMode();
      setIsCompactMode(false);
    } catch (e) {
      console.error('退出缩略模式失败', e);
    }
  };

  useEffect(() => {
    loadMatters();
    loadUncategorizedCount();
  }, [statusFilter, categoryFilter, sortBy]);

  // 监听后端发起的实时数据更新广播
  useEffect(() => {
    const unlisten = listen('refresh-data', () => {
      loadMatters();
      loadUncategorizedCount();
      //showToast('✓ AI 划选捕获已同步更新！');
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // 监听来自 HUD 或外部请求打开特定事项详情的事件
  useEffect(() => {
    const unlistenOpen = listen<{ matterId: string }>('open-matter-detail', async (event) => {
      const matterId = event.payload?.matterId;
      if (!matterId) return;

      // 如果处于桌面缩略微窗模式，立刻退出缩略模式恢复主看板
      if (isCompactMode) {
        await handleExitCompact();
      }

      // 切换到事项主看板并加载目标事项
      setCurrentTab('matters');
      try {
        const targetMatter = await api.getMatterById(matterId);
        if (targetMatter) {
          setSelectedMatter(targetMatter);
        }
      } catch (err) {
        console.error('打开对应事项详情失败', err);
      }
    });

    return () => {
      unlistenOpen.then((fn) => fn());
    };
  }, [isCompactMode]);

  // 窗口重新获取焦点时静默刷新事项列表与未归集数
  useEffect(() => {
    const handleFocus = () => {
      loadMatters();
      loadUncategorizedCount();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  const loadMatters = async () => {
    try {
      const { statusFilter: sf, categoryFilter: cf, sortBy: sb } = filtersRef.current;
      const list = await api.getMatters(sf, cf, sb);
      setMatters(list);
    } catch (e) {
      console.error('加载事项列表失败', e);
    }
  };

  const loadUncategorizedCount = async () => {
    try {
      const inboxList = await api.getInboxLogs();
      const count = inboxList.filter((l) => !l.matter_id).length;
      setUncategorizedCount(count);
    } catch (e) {
      console.warn('获取未归集数失败', e);
    }
  };

  // 置顶切换
  const handleTogglePin = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.toggleMatterPinned(id);
    loadMatters();
  };

  // 状态流转
  const handleUpdateStatus = async (id: string, status: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.updateMatterStatus(id, status);
    loadMatters();
    showToast(`事项状态已更新`);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // 搜索过滤（防空安全保护）
  const filteredMatters = (matters || []).filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const title = (m.title || '').toLowerCase();
    const overview = (m.overview || '').toLowerCase();
    const factSummary = (m.fact_summary || '').toLowerCase();
    const snippet = (m.latest_log_snippet || '').toLowerCase();
    const todoContent = (m.latest_todo_content || '').toLowerCase();
    return title.includes(q) || overview.includes(q) || factSummary.includes(q) || snippet.includes(q) || todoContent.includes(q);
  });

  // 如果处于桌面右上角常驻缩略模式，直接渲染待办小微窗
  if (isCompactMode) {
    return <CompactTodoWidget onExpand={handleExitCompact} />;
  }

  return (
    <div className="h-screen h-[100dvh] max-h-screen w-full bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none overflow-hidden">
      {/* 顶部全局导航栏 */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        uncategorizedCount={uncategorizedCount}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenNewMatter={() => setIsNewMatterOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onEnterCompactMode={handleEnterCompact}
      />

      {/* 轻量全局 Toast */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-slate-900 text-white dark:bg-sky-500 text-xs px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-in slide-in-from-top-2 duration-200">
          <Sparkles className="w-4 h-4 text-sky-400 dark:text-white" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 主体视图：严格限定高度，垂直滚动平滑响应鼠标滚轮 */}
      <main className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain">
        {currentTab === 'matters' && (
          <div className="max-w-7xl mx-auto p-6 space-y-6 pb-16">
            {/* 过滤器与排序工具栏 */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900/60 p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
              {/* 状态过滤 */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1">
                  <Filter className="w-3 h-3" />
                  状态:
                </span>
                {[
                  { label: '进行中 (默认)', value: 'active' },
                  { label: '已挂起', value: 'pending' },
                  { label: '已完成', value: 'completed' },
                  { label: '已归档', value: 'archived' },
                  { label: '全部', value: 'all' },
                ].map((st) => (
                  <button
                    key={st.value}
                    onClick={() => setStatusFilter(st.value)}
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${statusFilter === st.value
                      ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60'
                      : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
                      }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>

              {/* 类别与排序 */}
              <div className="flex items-center gap-3">
                {/* 类别 */}
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 outline-none"
                >
                  <option value="all">全部分类</option>
                  <option value="work">仅工作事项</option>
                  <option value="life">仅生活事项</option>
                </select>

                {/* 排序 */}
                <div className="flex items-center gap-1 text-xs text-slate-500">
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value)}
                    className="text-xs font-semibold px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 outline-none"
                  >
                    <option value="updated">按最近更新排序</option>
                    <option value="priority">按优先级排序</option>
                    <option value="importance">按重要程度排序</option>
                    <option value="created">按创建时间排序</option>
                  </select>
                </div>
              </div>
            </div>

            {/* 事项卡片网格 */}
            {filteredMatters.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredMatters.map((matter) => (
                  <MatterCard
                    key={matter.id}
                    matter={matter}
                    onSelect={(m) => setSelectedMatter(m)}
                    onTogglePin={handleTogglePin}
                    onUpdateStatus={handleUpdateStatus}
                    onRefresh={loadMatters}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-20 bg-white dark:bg-slate-900/40 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
                  <Inbox className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">暂无符合条件的事项</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  点击右上角【新建事项】创建，或者在微信/企微中划选文字并按 Alt+A 自动捕获。
                </p>
              </div>
            )}
          </div>
        )}

        {currentTab === 'todos' && (
          <TodoBoard onSelectMatter={(m) => setSelectedMatter(m)} />
        )}

        {currentTab === 'inbox' && (
          <InboxBoard onSelectMatter={(m) => setSelectedMatter(m)} />
        )}
      </main>

      {/* 侧边详情与时间轴抽屉 */}
      {selectedMatter && (
        <MatterDrawer
          matter={selectedMatter}
          onClose={() => setSelectedMatter(null)}
          onRefreshMatters={loadMatters}
        />
      )}

      {/* 新建事项模态框 */}
      <NewMatterModal
        isOpen={isNewMatterOpen}
        onClose={() => setIsNewMatterOpen(false)}
        onSuccess={loadMatters}
      />

      {/* 设置中心模态框 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}

export default App;
