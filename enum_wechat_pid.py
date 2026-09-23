import ctypes
from ctypes import wintypes
import psutil

user32 = ctypes.windll.user32

wechat_pids = set()
for p in psutil.process_iter(['pid', 'name']):
    if p.info['name'] and any(k in p.info['name'].lower() for k in ['wechat', 'weixin', 'wxwork']):
        wechat_pids.add(p.info['pid'])

print(f"WeChat PIDs: {wechat_pids}")

def enum_windows_callback(hwnd, extra):
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if pid.value in wechat_pids:
        length = user32.GetWindowTextLengthW(hwnd)
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        class_buff = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, class_buff, 256)
        rect = wintypes.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        is_vis = user32.IsWindowVisible(hwnd)
        w = rect.right - rect.left
        h = rect.bottom - rect.top
        if w > 100 and h > 100:
            print(f"PID: {pid.value}, HWND: {hwnd}, Vis: {is_vis}, Class: '{class_buff.value}', Title: '{buff.value}', Size: {w}x{h}, Rect: ({rect.left}, {rect.top}, {rect.right}, {rect.bottom})")
    return True

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
