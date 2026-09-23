import React, { useState, useEffect, useRef } from 'react';
import { X, Key, Zap, Sliders, Database, CheckCircle2, AlertCircle, UserCheck, Palette, Sun, Moon, Laptop, Power } from 'lucide-react';
import { AppConfig, ThemeMode } from '../types';
import { api } from '../services/api';
import { HotkeyInput } from './HotkeyInput';
import { useTheme } from '../services/theme';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const { theme, setTheme } = useTheme();

  const [config, setConfig] = useState<AppConfig>({
    api_base_url: 'https://api.openai.com/v1',
    api_key: '',
    model_name: 'gpt-4o-mini',
    capture_shortcut: 'Alt+A',
    main_window_shortcut: 'Alt+Shift+Space',
    auto_archive_confidence: 0.8,
    user_profile: '',
    theme: theme,
  });

  const [isAutostart, setIsAutostart] = useState(true);
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    api.getAppConfig().then((cfg) => {
      setConfig({
        ...cfg,
        theme: (cfg.theme as ThemeMode) || theme,
      });
    });
    api.isAutostartEnabled().then((enabled) => {
      setIsAutostart(enabled);
    });
  }, [theme]);

  const handleToggleAutostart = async () => {
    const nextVal = !isAutostart;
    setIsAutostart(nextVal);
    try {
      await api.setAutostart(nextVal);
    } catch (e) {
      console.error('切换开机自启动失败', e);
      setIsAutostart(!nextVal);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);
    try {
      if (config.theme) {
        setTheme(config.theme);
      }
      await api.saveAppConfig(config);
      setSavedSuccess(true);
      setTimeout(() => {
        setSavedSuccess(false);
        onClose();
      }, 800);
    } catch (err: any) {
      setSaveError(err?.message || String(err));
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await api.manualParseText('测试连通性：张三说下周一提交进度总结报告。');
      if (res) {
        setTestStatus(`✓ 测试通过！意图: ${res.action}, 待办数: ${res.extracted_todos.length}`);
      }
    } catch (e: any) {
      setTestStatus(`✕ 测试失败: ${e.message || String(e)}`);
    } finally {
      setTesting(false);
    }
  };

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 dark:bg-black/70 backdrop-blur-sm dark:backdrop-blur-md select-none p-4"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div
        className="w-full max-w-[700px] bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-700/80 ring-1 ring-slate-900/5 dark:ring-white/10 shadow-[0_25px_60px_-15px_rgba(15,23,42,0.3),0_10px_25px_-5px_rgba(15,23,42,0.15)] dark:shadow-[0_30px_90px_rgba(0,0,0,0.9),0_12px_36px_rgba(0,0,0,0.7),0_0_0_1px_rgba(255,255,255,0.08)] overflow-hidden animate-in zoom-in-95 duration-150 max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 弹窗标题栏 */}
        <div className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50/50 dark:bg-slate-800/30">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 dark:bg-sky-400/10 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <Sliders className="w-4.5 h-4.5" />
            </div>
            <span>系统与模型配置</span>
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

        <form onSubmit={handleSave} className="p-6 space-y-5 text-xs flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {/* 大模型 API 配置 */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
              <Key className="w-4 h-4 text-amber-500" />
              <span>大语言模型 (OpenAI 兼容协议)</span>
            </div>

            <div>
              <label className="block text-slate-600 dark:text-slate-400 mb-1.5 font-medium">
                API Base URL (兼容 DeepSeek, 通义千问, Kimi, Ollama, OpenAI)
              </label>
              <input
                type="text"
                value={config.api_base_url}
                onChange={(e) => setConfig({ ...config, api_base_url: e.target.value })}
                placeholder="https://api.deepseek.com/v1 或 https://api.openai.com/v1"
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    API Key
                  </label>
                  <span className="text-[11px] text-slate-400">
                    留空自动启用离线引擎
                  </span>
                </div>
                <input
                  type="password"
                  value={config.api_key}
                  onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                  placeholder="sk-..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    模型名称 (Model Name)
                  </label>
                  <span className="text-[11px] text-slate-400">
                    如 deepseek-chat 或 gpt-4o-mini
                  </span>
                </div>
                <input
                  type="text"
                  value={config.model_name}
                  onChange={(e) => setConfig({ ...config, model_name: e.target.value })}
                  placeholder="deepseek-chat 或 gpt-4o-mini"
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* 测试连通性 */}
            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testing}
                className="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold cursor-pointer transition-all"
              >
                {testing ? '测试中...' : '测试连通性与解析'}
              </button>
              {testStatus && (
                <span className={`text-[11px] font-medium ${testStatus.startsWith('✓') ? 'text-emerald-600' : 'text-rose-500'}`}>
                  {testStatus}
                </span>
              )}
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* 全局个人情况配置 */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
              <UserCheck className="w-4 h-4 text-indigo-500" />
              <span>全局个人情况配置 (身份与业务视角)</span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-slate-600 dark:text-slate-400 font-medium">
                  个人身份角色、核心职责范围与协作对接人
                </label>
                <span className="text-[11px] text-slate-400">
                  融合到 LLM 系统 Prompt，提升归集与待办提取精度
                </span>
              </div>
              <textarea
                rows={3}
                value={config.user_profile || ''}
                onChange={(e) => setConfig({ ...config, user_profile: e.target.value })}
                placeholder="例如：我是项目交付负责人/产品经理，负责多部门协同与核心业务推进。主要对接人包括张总、王工、李会计等，请重点关注项目节点、商务约束与交付风险..."
                className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500 resize-none leading-relaxed"
              />
              <p className="text-[11px] text-slate-400 mt-1">
                💡 提示：AI 将结合您的角色职责，精准判断对话中是指派给您的行动待办还是普通的汇报事实，并结合核心对接人提升归集可信度。
              </p>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* 界面外观与主题模式 */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
              <Palette className="w-4 h-4 text-amber-500" />
              <span>界面外观与色彩主题</span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  id: 'light' as ThemeMode,
                  label: '浅色模式',
                  desc: '清爽明亮界面',
                  icon: Sun,
                  iconColor: 'text-amber-500',
                  activeBg: 'border-amber-500/80 bg-amber-500/5 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20',
                },
                {
                  id: 'dark' as ThemeMode,
                  label: '深色模式',
                  desc: '舒适暗夜深邃',
                  icon: Moon,
                  iconColor: 'text-indigo-400',
                  activeBg: 'border-indigo-500/80 bg-indigo-500/5 text-indigo-600 dark:text-indigo-400 ring-1 ring-indigo-500/20',
                },
                {
                  id: 'system' as ThemeMode,
                  label: '跟随系统',
                  desc: '自适应操作系统',
                  icon: Laptop,
                  iconColor: 'text-sky-500',
                  activeBg: 'border-sky-500/80 bg-sky-500/5 text-sky-600 dark:text-sky-400 ring-1 ring-sky-500/20',
                },
              ].map((item) => {
                const currentMode = config.theme || theme;
                const isSelected = currentMode === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setConfig({ ...config, theme: item.id });
                      setTheme(item.id); // 立即预览生效
                    }}
                    className={`flex flex-col items-start p-3.5 rounded-xl border-2 text-left transition-all relative ${
                      isSelected
                        ? `${item.activeBg} font-semibold shadow-sm`
                        : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full mb-2">
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-white dark:bg-slate-800 shadow-xs' : 'bg-slate-100 dark:bg-slate-800'}`}>
                        <Icon className={`w-4 h-4 ${item.iconColor}`} />
                      </div>
                      {isSelected && (
                        <span className="flex h-2 w-2 relative">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-current"></span>
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-medium leading-tight">{item.label}</span>
                    <span className="text-[11px] text-slate-400 mt-0.5 leading-tight">{item.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* 快捷键与自动化策略 */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
              <Zap className="w-4 h-4 text-sky-500" />
              <span>全局快捷键与意图阈值</span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <HotkeyInput
                label="划选捕获快捷键"
                defaultValue="Alt+A"
                value={config.capture_shortcut}
                onChange={(val) => {
                  setConfig({ ...config, capture_shortcut: val });
                  setSaveError(null);
                }}
                placeholder="未设置 (点击录制)"
              />
              <HotkeyInput
                label="呼出主看板快捷键"
                defaultValue="Alt+Shift+Space"
                value={config.main_window_shortcut}
                onChange={(val) => {
                  setConfig({ ...config, main_window_shortcut: val });
                  setSaveError(null);
                }}
                placeholder="未设置 (点击录制)"
              />
            </div>
            <p className="text-[11px] text-slate-400">
              💡 点击按键框后直接按下键盘组合键即可录制，按 <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono border border-slate-200 dark:border-slate-700">Esc</kbd> 取消，按 <kbd className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono border border-slate-200 dark:border-slate-700">Backspace</kbd> 清空。
            </p>

            <div>
              <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 mb-1">
                <span>高置信度自动归档阈值</span>
                <span className="font-bold text-sky-600">{config.auto_archive_confidence}</span>
              </div>
              <input
                type="range"
                min={0.5}
                max={0.95}
                step={0.05}
                value={config.auto_archive_confidence}
                onChange={(e) => setConfig({ ...config, auto_archive_confidence: Number(e.target.value) })}
                className="w-full accent-sky-500"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                当 AI 对已有事项的匹配得分大于该阈值时，自动归档并提取事实与待办，不弹打扰微窗。
              </p>
            </div>
          </div>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* 系统运行与开机自启动 */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
              <Power className="w-4 h-4 text-emerald-500" />
              <span>系统运行与开机启动</span>
            </div>

            <div className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/40">
              <div className="flex flex-col pr-4">
                <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                  开机自动启动 (后台常驻)
                </span>
                <span className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                  Windows 开机登录后自动启动并在后台托盘常驻，守护全局划选感知与待办到期提醒
                </span>
              </div>
              <button
                type="button"
                onClick={handleToggleAutostart}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  isAutostart ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                    isAutostart ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>

          {saveError && (
            <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs flex items-center gap-2 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
              <Database className="w-3.5 h-3.5" />
              <span>本地 SQLite 数据安全存储</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
              >
                取消
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold rounded-xl shadow-sm transition-all flex items-center gap-1"
              >
                {savedSuccess ? <CheckCircle2 className="w-3.5 h-3.5" /> : null}
                {savedSuccess ? '已保存' : '保存设置'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
