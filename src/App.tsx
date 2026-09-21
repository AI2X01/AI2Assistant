import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { MatterCard } from './components/MatterCard';
import { MatterDrawer } from './components/MatterDrawer';
import { TodoBoard } from './components/TodoBoard';
import { NewMatterModal } from './components/NewMatterModal';
import { SettingsModal } from './components/SettingsModal';
import { HUDWindow } from './components/HUDWindow';
import { Matter } from './types';
import { api } from './services/api';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Filter, ArrowUpDown, Inbox, Sparkles } from 'lucide-react';

export function App() {
  const [windowLabel, setWindowLabel] = useState<string>('main');

  // 检测窗口 Label
  useEffect(() => {
    try {
      const appWin = getCurrentWebviewWindow();
      if (appWin && appWin.label) {
        setWindowLabel(appWin.label);
      }
    } catch {
      // 浏览器环境默认 main
      setWindowLabel('main');
    }
  }, []);

  // 如果是 HUD 右下角微窗，直接渲染 HUD 组件
  if (windowLabel === 'hud') {
    return <HUDWindow />;
  }

  return <MainWindow />;
}

function MainWindow() {
  const [currentTab, setCurrentTab] = useState<'matters' | 'todos'>('matters');
  const [matters, setMatters] = useState<Matter[]>([]);
  const [selectedMatter, setSelectedMatter] = useState<Matter | null>(null);

  // 过滤与排序
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('updated');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 弹窗状态
  const [isNewMatterOpen, setIsNewMatterOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    loadMatters();
  }, [statusFilter, categoryFilter, sortBy]);

  const loadMatters = async () => {
    try {
      const list = await api.getMatters(statusFilter, categoryFilter, sortBy);
      setMatters(list);
    } catch (e) {
      console.error('加载事项列表失败', e);
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
  };

  // 模拟划选触发
  const handleTriggerMockCapture = async () => {
    setIsCapturing(true);
    try {
      const res = await api.triggerCaptureAndAnalyze();
      if (res.action === 'MATCH_EXISTING') {
        showToast(`✓ 已自动沉淀至【${res.matched_matter_title || '关联事项'}】，生成待办项！`);
      } else {
        showToast(`AI 意图分析完成: ${res.action}`);
      }
      loadMatters();
    } catch (e: any) {
      showToast(`划选捕获提示: ${e.message || String(e)}`);
    } finally {
      setIsCapturing(false);
    }
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // 搜索过滤
  const filteredMatters = matters.filter((m) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.title.toLowerCase().includes(q) ||
      m.overview.toLowerCase().includes(q) ||
      m.fact_summary.toLowerCase().includes(q) ||
      (m.latest_log_snippet && m.latest_log_snippet.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans select-none">
      {/* 顶部全局导航栏 */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onOpenNewMatter={() => setIsNewMatterOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onTriggerMockCapture={handleTriggerMockCapture}
        isCapturing={isCapturing}
      />

      {/* 轻量全局 Toast */}
      {toastMessage && (
        <div className="fixed top-20 right-6 z-50 bg-slate-900 text-white dark:bg-sky-500 text-xs px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2 animate-in slide-in-from-top-2 duration-200">
          <Sparkles className="w-4 h-4 text-sky-400 dark:text-white" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* 主体视图 */}
      <main className="flex-1 overflow-y-auto">
        {currentTab === 'matters' ? (
          <div className="max-w-7xl mx-auto p-6 space-y-6">
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
                    className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all ${
                      statusFilter === st.value
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
        ) : (
          <TodoBoard onSelectMatter={(m) => setSelectedMatter(m)} />
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
