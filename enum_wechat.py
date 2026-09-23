import ctypes
from ctypes import wintypes
import time

user32 = ctypes.windll.user32

def enum_windows_callback(hwnd, extra):
    if user32.IsWindowVisible(hwnd):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            class_buff = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, class_buff, 256)
            title = buff.value
            class_name = class_buff.value
            if "微信" in title or "WeChat" in title or "标贝" in title or "潮汕" in title or "ChatWnd" in class_name or "WeChat" in class_name:
                print(f"HWND: {hwnd}, Class: {class_name}, Title: {title}")
    return True

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
print("Enumerating windows matching WeChat / Title...")
user32.EnumWindows(WNDENUMPROC(enum_windows_callback), 0)
