import React, { useState, useMemo } from 'react';
import {
  Sparkles,
  FileText,
  Lightbulb,
  Copy,
  Check,
  Search,
  Edit3,
  LayoutGrid,
  List,
  TrendingUp,
  RefreshCw,
} from 'lucide-react';

interface StructuredFactsViewProps {
  factSummary: string;
  onEdit: () => void;
  onRefreshSummarize?: () => void;
  isSummarizing?: boolean;
}

export interface SummaryOrSuggestionItem {
  id: string;
  raw: string;
  section: 'summary' | 'suggestion';
  key?: string;
  value: string;
}

export const StructuredFactsView: React.FC<StructuredFactsViewProps> = ({
  factSummary,
  onEdit,
  onRefreshSummarize,
  isSummarizing = false,
}) => {
  const [viewMode, setViewMode] = useState<'structured' | 'list'>('structured');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyAllSuccess, setCopyAllSuccess] = useState(false);

  // 解析文本为【事项总结】与【推进建议】两部分
  const { summaryItems, suggestionItems, allItems } = useMemo(() => {
    if (!factSummary || !factSummary.trim()) {
      return { summaryItems: [], suggestionItems: [], allItems: [] };
    }

    const lines = factSummary
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const summaries: SummaryOrSuggestionItem[] = [];
    const suggestions: SummaryOrSuggestionItem[] = [];

    // 检测文本是否显式包含分段标识（如【事项总结】/【推进建议】）
    let currentSection: 'summary' | 'suggestion' | 'unknown' = 'unknown';
    const hasExplicitSections = lines.some(
      (l) =>
        l.includes('【事项总结】') ||
        l.includes('【总结】') ||
        l.includes('## 事项总结') ||
        l.includes('## 总结') ||
        l.includes('【推进建议】') ||
        l.includes('【建议】') ||
        l.includes('## 推进建议') ||
        l.includes('## 建议')
    );

    lines.forEach((line, idx) => {
      // 1. 检查显式段落标题
      if (
        line.includes('【事项总结】') ||
        line.includes('【总结】') ||
        line.includes('## 事项总结') ||
        line.includes('## 总结')
      ) {
        currentSection = 'summary';
        return;
      }
      if (
        line.includes('【推进建议】') ||
        line.includes('【建议】') ||
        line.includes('## 推进建议') ||
        line.includes('## 建议')
      ) {
        currentSection = 'suggestion';
        return;
      }

      // 提取核心文本，去除开头的列表符号
      const cleanLine = line.replace(/^[•\-\*\d\.\、\s]+/, '').trim();
      if (!cleanLine) return;

      const id = `item-${idx}`;

      // 提取 key-value (例如 "结算范围: 泰语项目..." 或 "风险提示: ...")
      let key: string | undefined = undefined;
      let value = cleanLine;
      const kvMatch = cleanLine.match(/^([^：:\n]{2,16})[：:]\s*(.*)$/);
      if (kvMatch && !cleanLine.includes('http://') && !cleanLine.includes('https://')) {
        key = kvMatch[1].trim();
        value = kvMatch[2].trim() || cleanLine;
      }

      if (hasExplicitSections) {
        if (currentSection === 'suggestion') {
          suggestions.push({ id, raw: cleanLine, section: 'suggestion', key, value });
        } else {
          summaries.push({ id, raw: cleanLine, section: 'summary', key, value });
        }
      } else {
        // 智能分类存量旧数据：
        // 包含"建议"、"风险"、"防范"、"需关注"、"注意"、"待催办"等归入【推进建议】，其余归入【事项总结】
        const isSuggestionKeyword =
          cleanLine.includes('建议') ||
          cleanLine.includes('风险') ||
          cleanLine.includes('需关注') ||
          cleanLine.includes('防范') ||
          cleanLine.includes('注意') ||
          cleanLine.includes('待催办') ||
          cleanLine.includes('推测') ||
          (key && (key.includes('建议') || key.includes('风险')));

        if (isSuggestionKeyword) {
          suggestions.push({ id, raw: cleanLine, section: 'suggestion', key, value });
        } else {
          summaries.push({ id, raw: cleanLine, section: 'summary', key, value });
        }
      }
    });

    return {
      summaryItems: summaries,
      suggestionItems: suggestions,
      allItems: [...summaries, ...suggestions],
    };
  }, [factSummary]);

  // 搜索过滤
  const filteredSummaries = useMemo(() => {
    if (!searchQuery.trim()) return summaryItems;
    const q = searchQuery.toLowerCase();
    return summaryItems.filter(
      (item) =>
        item.raw.toLowerCase().includes(q) ||
        (item.key && item.key.toLowerCase().includes(q))
    );
  }, [summaryItems, searchQuery]);

  const filteredSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return suggestionItems;
    const q = searchQuery.toLowerCase();
    return suggestionItems.filter(
      (item) =>
        item.raw.toLowerCase().includes(q) ||
        (item.key && item.key.toLowerCase().includes(q))
    );
  }, [suggestionItems, searchQuery]);

  const totalFilteredCount = filteredSummaries.length + filteredSuggestions.length;

  // 复制单条
  const handleCopyItem = async (e: React.MouseEvent, item: SummaryOrSuggestionItem) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(item.raw);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (err) {
      console.error('复制失败', err);
    }
  };

  // 复制全部内容（格式化为标准的总结与建议）
  const handleCopyAll = async () => {
    try {
      const formatted = `【事项总结】\n${summaryItems.map((s) => `• ${s.raw}`).join('\n')}\n\n【推进建议】\n${suggestionItems.map((s) => `• ${s.raw}`).join('\n')}`;
      await navigator.clipboard.writeText(formatted);
      setCopyAllSuccess(true);
      setTimeout(() => setCopyAllSuccess(false), 2000);
    } catch (err) {
      console.error('复制失败', err);
    }
  };

  // 动态高亮关键人员、量化数字、时间节点与引号实体
  const renderHighlightedContent = (text: string) => {
    const regex = /(@[\u4e00-\u9fa5_a-zA-Z0-9]+|「[^」]+」|“[^”]+”|【[^】]+】|\d+(?:~\d+)?(?:个|名|人|小时|天|条|点|分|%|ms|TPS|万|千|元|k|K|万条))/g;
    const parts = text.split(regex);

    return (
      <span>
        {parts.map((part, idx) => {
          if (!part) return null;
          if (part.startsWith('@')) {
            return (
              <span
                key={idx}
                className="inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded bg-sky-100/90 dark:bg-sky-950/90 text-sky-700 dark:text-sky-300 font-semibold text-[11px]"
              >
                {part}
              </span>
            );
          }
          if (part.startsWith('「') || part.startsWith('“') || part.startsWith('【')) {
            return (
              <span
                key={idx}
                className="inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded bg-teal-100/80 dark:bg-teal-950/80 text-teal-800 dark:text-teal-300 font-medium text-[11px]"
              >
                {part}
              </span>
            );
          }
          if (/\d+(?:~\d+)?(?:个|名|人|小时|天|条|点|分|%|ms|TPS|万|千|元|k|K|万条)/.test(part)) {
            return (
              <span
                key={idx}
                className="font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1 py-0.2 mx-0.5 rounded"
              >
                {part}
              </span>
            );
          }
          return <span key={idx}>{part}</span>;
        })}
      </span>
    );
  };

  // 空状态处理
  if (!factSummary || !factSummary.trim()) {
    return (
      <div className="p-8 rounded-2xl bg-slate-50/80 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-800 text-center">
        <div className="w-10 h-10 mx-auto mb-2 rounded-xl bg-sky-50 dark:bg-sky-950/60 flex items-center justify-center text-sky-500">
          <Sparkles className={`w-5 h-5 ${isSummarizing ? 'animate-spin' : ''}`} />
        </div>
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
          暂无总结与建议
        </p>
        <p className="text-[11px] text-slate-400 mt-1 mb-3">
          可根据碎片日志言简意赅总结现状，并由 AI 生成持续更新的推进建议
        </p>
        <div className="flex items-center justify-center gap-2">
          {onRefreshSummarize && (
            <button
              onClick={onRefreshSummarize}
              disabled={isSummarizing}
              className="px-3 py-1.5 text-xs font-semibold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/80 hover:bg-sky-100 rounded-lg border border-sky-200/60 transition-all flex items-center gap-1 cursor-pointer"
            >
              <Sparkles className={`w-3.5 h-3.5 ${isSummarizing ? 'animate-spin' : ''}`} />
              <span>{isSummarizing ? '提炼中...' : '生成总结与建议'}</span>
            </button>
          )}
          <button
            onClick={onEdit}
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 rounded-lg border border-slate-200 dark:border-slate-600 transition-all flex items-center gap-1 cursor-pointer"
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>手动录入</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 顶部工具控制条 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1 border-b border-slate-100 dark:border-slate-800/80">
        {/* 左侧：搜索框与数量徽章 */}
        <div className="flex items-center gap-2 flex-1 min-w-[180px]">
          <div className="relative flex-1 max-w-[240px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索总结或推进建议..."
              className="w-full pl-8 pr-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700/80 bg-slate-50/80 dark:bg-slate-800/80 text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 transition-all"
            />
          </div>
          <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
            {summaryItems.length} 项总结 · {suggestionItems.length} 条建议
          </span>
        </div>

        {/* 右侧：视图切换与快捷操作按钮 */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 视图模式切换胶囊 */}
          <div className="flex items-center p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/60">
            <button
              onClick={() => setViewMode('structured')}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                viewMode === 'structured'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
              title="双板块结构视图：分为【事项总结】与【推进建议】"
            >
              <LayoutGrid className="w-3 h-3" />
              <span>结构视图</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-2xs font-semibold'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
              title="全量列表视图：清晰卡片化纵览"
            >
              <List className="w-3 h-3" />
              <span>列表视图</span>
            </button>
          </div>

          {/* 复制全部 */}
          <button
            onClick={handleCopyAll}
            className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-lg transition-all cursor-pointer"
            title="一键复制格式化的总结与建议"
          >
            {copyAllSuccess ? (
              <>
                <Check className="w-3 h-3 text-emerald-500" />
                <span className="text-emerald-600 dark:text-emerald-400">已复制</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3 text-slate-400" />
                <span>复制</span>
              </>
            )}
          </button>

          {/* 重新生成总结与建议 */}
          {onRefreshSummarize && (
            <button
              onClick={onRefreshSummarize}
              disabled={isSummarizing}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-sky-600 dark:text-sky-400 bg-sky-50 hover:bg-sky-100 dark:bg-sky-950/60 dark:hover:bg-sky-900/60 border border-sky-200/60 dark:border-sky-800/60 rounded-lg transition-all cursor-pointer"
              title="根据整体日志重新提炼生成总结与建议"
            >
              <RefreshCw className={`w-3 h-3 ${isSummarizing ? 'animate-spin' : ''}`} />
              <span>{isSummarizing ? '生成中...' : '重新生成'}</span>
            </button>
          )}

          {/* 编辑按钮 */}
          <button
            onClick={onEdit}
            className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-700/80 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded-lg transition-all cursor-pointer shadow-2xs"
            title="编辑内容"
          >
            <Edit3 className="w-3 h-3" />
            <span>编辑</span>
          </button>
        </div>
      </div>

      {/* 核心展示区 */}
      {viewMode === 'structured' ? (
        /* ================= 模式 1: 双板块结构视图 (总结 + 建议) ================= */
        <div className="space-y-4">
          {/* 板块 1: 事项总结 (言简意赅总结现状) */}
          <div className="rounded-2xl p-4 bg-gradient-to-br from-sky-500/10 via-sky-500/5 to-transparent dark:from-sky-950/40 dark:via-sky-950/20 dark:to-transparent border border-sky-200/80 dark:border-sky-800/60 shadow-xs space-y-3">
            {/* 板块头部 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center">
                  <FileText className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-sky-900 dark:text-sky-200 flex items-center gap-1.5">
                    <span>事项总结</span>
                    <span className="text-[10px] font-normal text-sky-600/80 dark:text-sky-400/80">
                      （言简意赅总结现状）
                    </span>
                  </h4>
                </div>
              </div>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-semibold">
                {filteredSummaries.length} 项要点
              </span>
            </div>

            {/* 总结内容清单 */}
            {filteredSummaries.length > 0 ? (
              <div className="space-y-2">
                {filteredSummaries.map((item) => (
                  <div
                    key={item.id}
                    className="group relative p-3 rounded-xl bg-white/90 dark:bg-slate-900/80 border border-sky-100 dark:border-sky-900/40 text-xs text-slate-800 dark:text-slate-100 leading-relaxed shadow-2xs hover:border-sky-300 dark:hover:border-sky-700 transition-all flex items-start gap-2.5"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-sky-500 shrink-0 mt-2" />
                    <div className="flex-1 min-w-0">
                      {item.key && (
                        <span className="inline-block font-bold text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/70 border border-sky-200/60 dark:border-sky-800/50 px-1.5 py-0.2 rounded-md mr-1.5 text-[11px]">
                          {item.key}
                        </span>
                      )}
                      {renderHighlightedContent(item.value)}
                    </div>
                    <button
                      onClick={(e) => handleCopyItem(e, item)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-sky-600 transition-opacity rounded shrink-0 cursor-pointer"
                      title="复制本条"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3 text-center text-xs text-slate-400 italic bg-white/50 dark:bg-slate-900/40 rounded-xl border border-dashed border-sky-200/50 dark:border-sky-900/30">
                {searchQuery ? `未找到匹配 “${searchQuery}” 的总结要点` : '暂无总结要点'}
              </div>
            )}
          </div>

          {/* 板块 2: 推进建议 (持续更新的前瞻指导与风险提示) */}
          <div className="rounded-2xl p-4 bg-gradient-to-br from-amber-500/10 via-indigo-500/5 to-transparent dark:from-amber-950/30 dark:via-indigo-950/20 dark:to-transparent border border-amber-200/80 dark:border-amber-800/60 shadow-xs space-y-3">
            {/* 板块头部 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Lightbulb className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                    <span>推进建议</span>
                    <span className="text-[10px] font-normal text-amber-700/80 dark:text-amber-400/80">
                      （针对当前事项的行动指引与风险防范）
                    </span>
                  </h4>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100/90 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300 font-semibold border border-amber-300/40 dark:border-amber-700/50">
                  <TrendingUp className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400 animate-pulse" />
                  持续更新
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">
                  {filteredSuggestions.length} 条建议
                </span>
              </div>
            </div>

            {/* 建议内容卡片 */}
            {filteredSuggestions.length > 0 ? (
              <div className="space-y-2">
                {filteredSuggestions.map((item, idx) => (
                  <div
                    key={item.id}
                    className="group relative p-3 rounded-xl bg-white/95 dark:bg-slate-900/90 border border-amber-100 dark:border-amber-900/40 text-xs text-slate-800 dark:text-slate-100 leading-relaxed shadow-2xs hover:border-amber-300 dark:hover:border-amber-600 hover:shadow-sm transition-all flex items-start gap-2.5"
                  >
                    {/* 递增序号指示器 */}
                    <div className="w-5 h-5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 font-mono font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5 border border-amber-200/50 dark:border-amber-800/40">
                      {String(idx + 1).padStart(2, '0')}
                    </div>
                    <div className="flex-1 min-w-0">
                      {item.key && (
                        <span className="inline-block font-bold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/70 border border-amber-200/60 dark:border-amber-800/50 px-1.5 py-0.2 rounded-md mr-1.5 text-[11px]">
                          {item.key}
                        </span>
                      )}
                      {renderHighlightedContent(item.value)}
                    </div>
                    <button
                      onClick={(e) => handleCopyItem(e, item)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-amber-600 transition-opacity rounded shrink-0 cursor-pointer"
                      title="复制本条建议"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-3.5 text-center text-xs text-slate-500 dark:text-slate-400 bg-white/50 dark:bg-slate-900/40 rounded-xl border border-dashed border-amber-200/60 dark:border-amber-900/40 space-y-1.5">
                <p className="font-medium text-slate-600 dark:text-slate-300">
                  {searchQuery ? `未找到匹配 “${searchQuery}” 的推进建议` : '暂无持续推进建议'}
                </p>
                {onRefreshSummarize && !searchQuery && (
                  <button
                    onClick={onRefreshSummarize}
                    disabled={isSummarizing}
                    className="inline-flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:underline cursor-pointer font-semibold"
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>点击一键根据当前全部日志提炼建议</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* ================= 模式 2: 卡片列表视图 ================= */
        <div className="space-y-2">
          {allItems.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400">暂无内容</div>
          ) : (
            allItems
              .filter((item) => {
                if (!searchQuery.trim()) return true;
                const q = searchQuery.toLowerCase();
                return (
                  item.raw.toLowerCase().includes(q) ||
                  (item.key && item.key.toLowerCase().includes(q))
                );
              })
              .map((item) => {
                const isSuggestion = item.section === 'suggestion';
                return (
                  <div
                    key={item.id}
                    className="group relative p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 hover:border-sky-300 dark:hover:border-sky-600 text-xs text-slate-800 dark:text-slate-100 leading-relaxed shadow-2xs transition-all flex items-start gap-2.5"
                  >
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold shrink-0 mt-0.5 border ${
                        isSuggestion
                          ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50'
                          : 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800/50'
                      }`}
                    >
                      {isSuggestion ? '建议' : '总结'}
                    </span>
                    <div className="flex-1 min-w-0">
                      {item.key && (
                        <span className="font-bold mr-1.5 text-slate-900 dark:text-white">
                          【{item.key}】
                        </span>
                      )}
                      {renderHighlightedContent(item.value)}
                    </div>
                    <button
                      onClick={(e) => handleCopyItem(e, item)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-sky-600 transition-opacity rounded shrink-0 cursor-pointer"
                      title="复制本条"
                    >
                      {copiedId === item.id ? (
                        <Check className="w-3 h-3 text-emerald-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </button>
                  </div>
                );
              })
          )}
        </div>
      )}

      {/* 搜索无结果提示 */}
      {searchQuery && totalFilteredCount === 0 && (
        <div className="p-4 text-center text-xs text-slate-400 bg-slate-50 dark:bg-slate-800/30 rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          未搜索到包含 “{searchQuery}” 的总结与建议内容
        </div>
      )}
    </div>
  );
};
