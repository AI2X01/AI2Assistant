import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Search,
  RefreshCw,
  Clock,
  FolderCheck,
  FolderPlus,
  FolderInput,
  CheckCircle2,
  Trash2,
  Copy,
  Check,
  ExternalLink,
  MessageSquare,
  Globe,
  AppWindow,
} from 'lucide-react';
import { InboxLogItem, Matter } from '../types';
import { api } from '../services/api';
import { CategorizeModal } from './CategorizeModal';

interface InboxBoardProps {
  onSelectMatter: (matter: Matter) => void;
}

export const InboxBoard: React.FC<InboxBoardProps> = ({ onSelectMatter }) => {
  const [inboxLogs, setInboxLogs] = useState<InboxLogItem[]>([]);
  const [matters, setMatters] = useState<Matter[]>([]);
  const [filter, setFilter] = useState<'all' | 'uncategorized' | 'categorized'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 归集弹窗控制
  const [selectedLogForCategorize, setSelectedLogForCategorize] = useState<InboxLogItem | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [logs, mList] = await Promise.all([
        api.getInboxLogs(),
        api.getMatters('all', 'all', 'updated'),
      ]);
      setInboxLogs(logs);
      setMatters(mList);
    } catch (e) {
      console.error('加载 AI 收件箱数据失败', e);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLog = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('确定要从收件箱删除此条收集文本吗？')) {
      await api.deleteLog(id);
      loadData();
    }
  };

  const handleCopyText = (id: string, text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handleOpenMatter = (matterId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const found = matters.find((m) => m.id === matterId);
    if (found) {
      onSelectMatter(found);
    }
  };

  // 统计指标
  const totalCount = inboxLogs.length;
  const uncatCount = inboxLogs.filter((l) => !l.matter_id).length;
  const catCount = totalCount - uncatCount;

  // 过滤逻辑
  const filteredLogs = inboxLogs.filter((l) => {
    if (filter === 'uncategorized' && l.matter_id) return false;
    if (filter === 'categorized' && !l.matter_id) return false;
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase();
    return (
      l.raw_content.toLowerCase().includes(q) ||
      l.source_app.toLowerCase().includes(q) ||
      l.source_window_title.toLowerCase().includes(q) ||
      (l.matter_title && l.matter_title.toLowerCase().includes(q))
    );
  });

  const getSourceIcon = (app: string) => {
    const lower = app.toLowerCase();
    if (lower.includes('微信') || lower.includes('wechat')) {
      return <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />;
    }
    if (lower.includes('企微') || lower.includes('wework')) {
      return <MessageSquare className="w-3.5 h-3.5 text-blue-500" />;
    }
    if (lower.includes('chrome') || lower.includes('edge') || lower.includes('网页') || lower.includes('浏览器')) {
      return <Globe className="w-3.5 h-3.5 text-sky-500" />;
    }
    return <AppWindow className="w-3.5 h-3.5 text-slate-400" />;
  };

  return (
    <div className="max-w-7xl mx-auto p-6 pb-20 space-y-6">
      {/* 顶部控制栏 */}
      <div className="flex flex-wrap items-center justify-between gap-4 bg-white dark:bg-slate-900/60 p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
        {/* 筛选 Tab */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
              filter === 'all'
                ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800/60'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
            }`}
          >
            <Inbox className="w-3.5 h-3.5" />
            <span>全部收集</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 font-bold">
              {totalCount}
            </span>
          </button>

          <button
            onClick={() => setFilter('uncategorized')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
              filter === 'uncategorized'
                ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>待归集</span>
            {uncatCount > 0 && (
              <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500 text-white font-bold animate-pulse">
                {uncatCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setFilter('categorized')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-xl transition-all ${
              filter === 'categorized'
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800/60'
                : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'
            }`}
          >
            <FolderCheck className="w-3.5 h-3.5" />
            <span>已归集</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-800 font-bold">
              {catCount}
            </span>
          </button>
        </div>

        {/* 搜索与刷新 */}
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索收件箱内容、来源、事项..."
              className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-sky-500 text-slate-900 dark:text-white outline-none"
            />
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
            title="刷新收件箱"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 收集内容瀑布流/列表 */}
      {filteredLogs.length > 0 ? (
        <div className="space-y-4">
          {filteredLogs.map((log) => {
            const isCategorized = Boolean(log.matter_id);

            return (
              <div
                key={log.id}
                className={`group p-5 rounded-2xl border transition-all duration-200 bg-white dark:bg-slate-900 shadow-xs hover:shadow-md ${
                  isCategorized
                    ? 'border-slate-200/80 dark:border-slate-800 hover:border-slate-300'
                    : 'border-amber-200/90 dark:border-amber-900/60 bg-gradient-to-r from-amber-50/20 to-white dark:to-slate-900'
                }`}
              >
                {/* 顶部元数据：来源、时间、状态徽标 */}
                <div className="flex items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* 来源应用 */}
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      {getSourceIcon(log.source_app)}
                      <span>{log.source_app || '外部应用'}</span>
                    </div>

                    {/* 窗口标题 */}
                    {log.source_window_title && (
                      <span className="text-[11px] text-slate-400 max-w-xs truncate" title={log.source_window_title}>
                        · {log.source_window_title}
                      </span>
                    )}

                    {/* 收集时间 */}
                    <span className="text-[11px] text-slate-400 flex items-center gap-1 ml-1">
                      <Clock className="w-3 h-3" />
                      {log.created_at}
                    </span>
                  </div>

                  {/* 状态徽标与主操作 */}
                  <div className="flex items-center gap-2">
                    {isCategorized ? (
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                        <FolderCheck className="w-3.5 h-3.5" />
                        <span>已归集至：</span>
                        <button
                          onClick={(e) => handleOpenMatter(log.matter_id!, e)}
                          className="hover:underline font-bold flex items-center gap-0.5 text-emerald-800 dark:text-emerald-200"
                        >
                          【{log.matter_title || '关联事项'}】
                          <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60">
                          待归集
                        </span>
                        <button
                          onClick={() => setSelectedLogForCategorize(log)}
                          className="flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-xs transition-all active:scale-95 cursor-pointer"
                        >
                          <FolderInput className="w-3.5 h-3.5" />
                          <span>归集到事项</span>
                        </button>
                      </div>
                    )}

                    {/* 复制文本 */}
                    <button
                      onClick={(e) => handleCopyText(log.id, log.raw_content, e)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                      title="复制原始文本"
                    >
                      {copiedId === log.id ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>

                    {/* 删除日志 */}
                    <button
                      onClick={(e) => handleDeleteLog(log.id, e)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-all"
                      title="删除此条记录"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 原始抓取文本 */}
                <div className="bg-slate-50/70 dark:bg-slate-800/40 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
                  {log.raw_content}
                </div>

                {/* 关联产生的待办事项展示 */}
                {log.todos && log.todos.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-sky-500" />
                      衍生待办 ({log.todos.length}):
                    </span>
                    {log.todos.map((todo) => (
                      <span
                        key={todo.id}
                        className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-medium border ${
                          todo.status === 'completed'
                            ? 'line-through bg-slate-50 dark:bg-slate-800/40 text-slate-400 border-slate-200 dark:border-slate-700'
                            : 'bg-sky-50/60 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200/80 dark:border-sky-800/60'
                        }`}
                      >
                        {todo.content}
                        {todo.due_time && <span className="text-[10px] text-amber-500">({todo.due_time})</span>}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-24 bg-white dark:bg-slate-900/40 rounded-3xl border border-dashed border-slate-200 dark:border-slate-800 space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto text-slate-400">
            <Inbox className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">收件箱暂无记录</h3>
          <p className="text-xs text-slate-400 max-w-sm mx-auto">
            在微信、企业微信、浏览器中划选任意文字并按下全局快捷键 (如 Alt+A)，内容将第一时间无缝沉淀到这里。
          </p>
        </div>
      )}

      {/* 手工归集模态弹窗 */}
      <CategorizeModal
        log={selectedLogForCategorize}
        isOpen={Boolean(selectedLogForCategorize)}
        onClose={() => setSelectedLogForCategorize(null)}
        onSuccess={loadData}
        matters={matters}
      />
    </div>
  );
};
