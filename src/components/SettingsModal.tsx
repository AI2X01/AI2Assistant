import React, { useState, useEffect } from 'react';
import { X, Key, Zap, Sliders, Database, CheckCircle2 } from 'lucide-react';
import { AppConfig } from '../types';
import { api } from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const [config, setConfig] = useState<AppConfig>({
    api_base_url: 'https://api.openai.com/v1',
    api_key: '',
    model_name: 'gpt-4o-mini',
    capture_shortcut: 'Alt+A',
    main_window_shortcut: 'Alt+Shift+Space',
    auto_archive_confidence: 0.8,
  });

  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    api.getAppConfig().then(setConfig);
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await api.saveAppConfig(config);
    setSavedSuccess(true);
    setTimeout(() => {
      setSavedSuccess(false);
      onClose();
    }, 800);
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs select-none">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
        <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <Sliders className="w-4 h-4 text-sky-500" />
            系统与模型配置
          </h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5 text-xs">
          {/* 大模型 API 配置 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
              <Key className="w-4 h-4 text-amber-500" />
              <span>大语言模型 (OpenAI 兼容协议)</span>
            </div>

            <div>
              <label className="block text-slate-600 dark:text-slate-400 mb-1">
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

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1">
                  API Key (留空时自动启用离线轻量规则引擎)
                </label>
                <input
                  type="password"
                  value={config.api_key}
                  onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                  placeholder="sk-..."
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white outline-none focus:border-sky-500"
                />
              </div>
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1">
                  模型名称 (Model Name)
                </label>
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
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
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

          {/* 快捷键与自动化策略 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold">
              <Zap className="w-4 h-4 text-sky-500" />
              <span>全局快捷键与意图阈值</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1">
                  划选捕获快捷键
                </label>
                <input
                  type="text"
                  value={config.capture_shortcut}
                  onChange={(e) => setConfig({ ...config, capture_shortcut: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-600 dark:text-slate-400 mb-1">
                  呼出主看板快捷键
                </label>
                <input
                  type="text"
                  value={config.main_window_shortcut}
                  onChange={(e) => setConfig({ ...config, main_window_shortcut: e.target.value })}
                  className="w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                />
              </div>
            </div>

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
