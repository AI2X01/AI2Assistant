import ctypes
from ctypes import wintypes
import os

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
psapi = ctypes.windll.psapi

def list_visible_windows():
    results = []
    def enum_cb(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            rect = wintypes.RECT()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            w = rect.right - rect.left
            h = rect.bottom - rect.top
            if w > 200 and h > 200:
                pid = wintypes.DWORD()
                user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                h_proc = kernel32.OpenProcess(0x1000, False, pid.value)
                proc_name = ""
                if h_proc:
                    buf = ctypes.create_unicode_buffer(512)
                    if psapi.GetProcessImageFileNameW(h_proc, buf, 512):
                        proc_name = os.path.basename(buf.value)
                    kernel32.CloseHandle(h_proc)

                title_buf = ctypes.create_unicode_buffer(512)
                user32.GetWindowTextW(hwnd, title_buf, 512)
                cls_buf = ctypes.create_unicode_buffer(256)
                user32.GetClassNameW(hwnd, cls_buf, 256)
                results.append((proc_name, hwnd, cls_buf.value, title_buf.value, w, h))
        return True

    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows(WNDENUMPROC(enum_cb), 0)
    return results

for r in list_visible_windows():
    print(r)
