import { useState, useEffect } from 'react';
import { ThemeMode } from '../types';
import { emit, listen } from '@tauri-apps/api/event';

export const THEME_STORAGE_KEY = 'ai2assistant_theme';

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// 存储全局主题状态监听者（支持多组件与跨组件响应）
type ThemeListener = (theme: ThemeMode, isDark: boolean) => void;
const listeners = new Set<ThemeListener>();

export function getStoredTheme(): ThemeMode {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === 'light' || val === 'dark' || val === 'system') {
      return val;
    }
  } catch {}
  return 'system';
}

export function isSystemDark(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function computeIsDark(mode: ThemeMode): boolean {
  if (mode === 'dark') return true;
  if (mode === 'light') return false;
  return isSystemDark();
}

export function applyTheme(mode: ThemeMode) {
  const isDark = computeIsDark(mode);
  const root = document.documentElement;
  if (isDark) {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  listeners.forEach((listener) => listener(mode, isDark));
  return isDark;
}

export async function setThemeMode(mode: ThemeMode, broadcast = true) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {}
  
  applyTheme(mode);

  if (broadcast && isTauri) {
    try {
      await emit('theme-changed', { theme: mode });
    } catch (e) {
      console.warn('广播主题变更事件失败', e);
    }
  }

  // 异步将主题设置同步至后端数据库配置，确保多端和重启状态一致
  if (broadcast) {
    try {
      import('./api').then(async ({ api }) => {
        const cfg = await api.getAppConfig();
        if (cfg && cfg.theme !== mode) {
          cfg.theme = mode;
          await api.saveAppConfig(cfg);
        }
      }).catch(() => {});
    } catch {}
  }
}

// 初始化全局主题监听器（系统级色彩偏好与 Tauri 跨窗口事件）
let isInitialized = false;
export function initThemeSystem() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  // 1. 首次即时应用当前存储的主题
  const initialMode = getStoredTheme();
  applyTheme(initialMode);

  // 2. 监听操作系统深色/浅色偏好变更
  if (window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      const current = getStoredTheme();
      if (current === 'system') {
        applyTheme('system');
      }
    };
    mediaQuery.addEventListener('change', handleSystemThemeChange);
  }

  // 3. 监听多窗口/子窗口（如 HUD 悬浮微窗）之间的广播同步
  if (isTauri) {
    listen<{ theme: ThemeMode }>('theme-changed', (event) => {
      if (event.payload && event.payload.theme) {
        setThemeMode(event.payload.theme, false);
      }
    }).catch((e) => console.warn('监听 theme-changed 失败', e));
  }
}

// 提供便捷的 React Hook
export function useTheme() {
  const [theme, setLocalTheme] = useState<ThemeMode>(getStoredTheme);
  const [isDark, setIsDark] = useState<boolean>(() => computeIsDark(getStoredTheme()));

  useEffect(() => {
    initThemeSystem();

    const listener: ThemeListener = (newTheme, newIsDark) => {
      setLocalTheme(newTheme);
      setIsDark(newIsDark);
    };

    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const changeTheme = (newTheme: ThemeMode) => {
    setThemeMode(newTheme, true);
  };

  const toggleNextTheme = () => {
    // 循环切换：浅色 -> 深色 -> 跟随系统 -> 浅色
    const sequence: ThemeMode[] = ['light', 'dark', 'system'];
    const nextIndex = (sequence.indexOf(theme) + 1) % sequence.length;
    changeTheme(sequence[nextIndex]);
  };

  return {
    theme,
    isDark,
    setTheme: changeTheme,
    toggleNextTheme,
  };
}
