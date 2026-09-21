import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Keyboard, RotateCcw, X, AlertCircle } from 'lucide-react';

interface HotkeyInputProps {
  value: string;
  defaultValue?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}

export const HotkeyInput: React.FC<HotkeyInputProps> = ({
  value,
  defaultValue,
  onChange,
  placeholder = '点击录制快捷键',
  label,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [activeModifiers, setActiveModifiers] = useState<string[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 解析当前快捷键为按键列表用于徽章展示
  const parseTokens = (hotkeyStr: string): string[] => {
    if (!hotkeyStr || !hotkeyStr.trim()) return [];
    return hotkeyStr.split('+').map((t) => t.trim()).filter(Boolean);
  };

  const handleStartRecording = () => {
    setIsRecording(true);
    setActiveModifiers([]);
    setHint('请直接在键盘上按下组合键 (如 Alt+A)...');
  };

  const handleStopRecording = useCallback(() => {
    setIsRecording(false);
    setActiveModifiers([]);
    setHint(null);
  }, []);

  // 点击外部时退出录制
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleStopRecording();
      }
    };
    if (isRecording) {
      window.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isRecording, handleStopRecording]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecording) return;

    e.preventDefault();
    e.stopPropagation();

    // 按 Esc 取消录制
    if (e.key === 'Escape') {
      handleStopRecording();
      return;
    }

    // 单按 Backspace 或 Delete 清空快捷键
    if (
      (e.key === 'Backspace' || e.key === 'Delete') &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      !e.metaKey
    ) {
      onChange('');
      handleStopRecording();
      return;
    }

    // 收集修饰键
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');

    // 如果只是按下了修饰键本身，更新正在按下的修饰键预览
    const isModifierKey = ['Control', 'Alt', 'Shift', 'Meta'].includes(e.key);
    if (isModifierKey) {
      setActiveModifiers(mods);
      setHint('请继续按下主按键 (字母/数字/功能键)...');
      return;
    }

    // 识别主按键
    let mainKey = '';
    const code = e.code;

    if (code.startsWith('Key') && code.length === 4) {
      mainKey = code.slice(3).toUpperCase();
    } else if (code.startsWith('Digit') && code.length === 6) {
      mainKey = code.slice(5);
    } else if (code.startsWith('Numpad') && /^Numpad\d$/.test(code)) {
      mainKey = 'Num' + code.slice(6);
    } else if (/^F\d{1,2}$/.test(e.key)) {
      mainKey = e.key.toUpperCase();
    } else {
      switch (code) {
        case 'Space':
          mainKey = 'Space';
          break;
        case 'Enter':
          mainKey = 'Enter';
          break;
        case 'Tab':
          mainKey = 'Tab';
          break;
        case 'ArrowUp':
          mainKey = 'Up';
          break;
        case 'ArrowDown':
          mainKey = 'Down';
          break;
        case 'ArrowLeft':
          mainKey = 'Left';
          break;
        case 'ArrowRight':
          mainKey = 'Right';
          break;
        case 'Backquote':
          mainKey = '`';
          break;
        case 'Minus':
          mainKey = '-';
          break;
        case 'Equal':
          mainKey = '=';
          break;
        case 'BracketLeft':
          mainKey = '[';
          break;
        case 'BracketRight':
          mainKey = ']';
          break;
        case 'Backslash':
          mainKey = '\\';
          break;
        case 'Semicolon':
          mainKey = ';';
          break;
        case 'Quote':
          mainKey = "'";
          break;
        case 'Comma':
          mainKey = ',';
          break;
        case 'Period':
          mainKey = '.';
          break;
        case 'Slash':
          mainKey = '/';
          break;
        default:
          if (e.key.length === 1) {
            mainKey = e.key.toUpperCase();
          }
      }
    }

    if (!mainKey) {
      setHint('暂不支持该按键，请换一个组合');
      return;
    }

    // 全局热键建议带有修饰键，如果只按了单个非功能按键给出温馨提示
    if (mods.length === 0 && !/^F\d{1,2}$/.test(mainKey)) {
      setHint('全局快捷键建议搭配 Ctrl 或 Alt 修饰键');
      return;
    }

    // 拼接成标准快捷键字符串
    const newShortcut = [...mods, mainKey].join('+');
    onChange(newShortcut);
    handleStopRecording();
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (!isRecording) return;
    const mods: string[] = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (e.metaKey) mods.push('Super');
    setActiveModifiers(mods);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    handleStopRecording();
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (defaultValue) {
      onChange(defaultValue);
    }
    handleStopRecording();
  };

  const tokens = parseTokens(value);

  return (
    <div className="w-full space-y-1.5" ref={containerRef}>
      {label && (
        <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
          <label className="text-xs font-medium">{label}</label>
          {defaultValue && value !== defaultValue && (
            <button
              type="button"
              onClick={handleReset}
              className="text-[11px] text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
              title={`恢复推荐默认值: ${defaultValue}`}
            >
              <RotateCcw className="w-3 h-3" />
              <span>恢复默认 ({defaultValue})</span>
            </button>
          )}
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={handleStartRecording}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        className={`relative w-full min-h-[42px] px-3 py-2 rounded-xl border transition-all cursor-pointer select-none flex items-center justify-between ${
          isRecording
            ? 'border-sky-500 bg-sky-50/70 dark:bg-sky-950/30 ring-2 ring-sky-500/20 shadow-sm'
            : 'border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/80 hover:border-slate-300 dark:hover:border-slate-600'
        }`}
      >
        {/* 左侧按键展示或录制状态 */}
        <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
          {isRecording ? (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-500 animate-ping mr-0.5" />
              <span className="text-xs text-sky-600 dark:text-sky-400 font-medium">
                {activeModifiers.length > 0 ? (
                  <span className="flex items-center gap-1">
                    {activeModifiers.map((mod) => (
                      <kbd
                        key={mod}
                        className="px-1.5 py-0.5 text-[11px] font-mono font-bold bg-white dark:bg-slate-800 border border-sky-300 dark:border-sky-600 rounded text-sky-700 dark:text-sky-300 shadow-2xs"
                      >
                        {mod}
                      </kbd>
                    ))}
                    <span className="text-slate-400 font-bold">+</span>
                    <span className="text-slate-400 text-xs italic">按下目标键...</span>
                  </span>
                ) : (
                  '请按下组合键 (如 Alt+A)...'
                )}
              </span>
            </div>
          ) : tokens.length > 0 ? (
            <div className="flex items-center gap-1 shrink-0 flex-nowrap">
              {tokens.map((token, idx) => (
                <React.Fragment key={idx}>
                  <kbd className="px-2 py-0.5 text-xs font-mono font-semibold bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-800 dark:text-slate-100 rounded-md shadow-2xs whitespace-nowrap">
                    {token}
                  </kbd>
                  {idx < tokens.length - 1 && (
                    <span className="text-slate-400 dark:text-slate-500 text-xs font-bold">+</span>
                  )}
                </React.Fragment>
              ))}
            </div>
          ) : (
            <span className="text-slate-400 text-xs flex items-center gap-1.5 italic">
              <Keyboard className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600" />
              {placeholder}
            </span>
          )}
        </div>

        {/* 右侧操作按钮 */}
        <div className="flex items-center gap-1 ml-2 shrink-0">
          {value && !isRecording && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
              title="清除快捷键"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          {isRecording ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleStopRecording();
              }}
              className="px-2 py-0.5 text-[11px] text-slate-500 dark:text-slate-400 hover:bg-slate-200/50 dark:hover:bg-slate-700/50 rounded"
            >
              取消
            </button>
          ) : (
            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono px-1.5 py-0.5 rounded bg-slate-200/50 dark:bg-slate-700/50">
              点击录制
            </span>
          )}
        </div>
      </div>

      {/* 录制提示或校验警告 */}
      {isRecording && hint && (
        <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 pt-0.5">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{hint}</span>
        </div>
      )}
    </div>
  );
};
