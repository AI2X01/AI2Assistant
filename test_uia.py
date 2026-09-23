import comtypes.client
from comtypes.gen.UIAutomationClient import *
import ctypes

user32 = ctypes.windll.user32

uia = comtypes.client.CreateObject(CUIAutomation)

def find_wechat_window():
    # 查找前台或顶级窗口
    hwnd = user32.GetForegroundWindow()
    # 枚举顶级窗口
    hwnds = []
    def cb(h, _):
        title_len = user32.GetWindowTextLengthW(h)
        title_buf = ctypes.create_unicode_buffer(title_len + 1)
        user32.GetWindowTextW(h, title_buf, title_len + 1)
        cls_buf = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(h, cls_buf, 256)
        title = title_buf.value
        cls = cls_buf.value
        if "WeChat" in cls or "WeChat" in title or "微信" in title or "标贝" in title:
            hwnds.append((h, cls, title))
        return True
    
    WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    user32.EnumWindows(WNDENUMPROC(cb), 0)
    return hwnds

hwnds = find_wechat_window()
print("Found matching windows:", hwnds)

for h, cls, title in hwnds:
    try:
        elem = uia.ElementFromHandle(h)
        cond = uia.CreateTrueCondition()
        elems = elem.FindAll(TreeScope_Descendants, cond)
        print(f"\nWindow HWND {h}, elements count: {elems.Length}")
        for i in range(min(elems.Length, 100)):
            e = elems.GetElement(i)
            name = e.CurrentName
            if name and any(k in name for k in ["潮汕", "标贝", "曦瀚", "(7)", "【"]):
                rect = e.CurrentBoundingRectangle
                print(f"  [{i}] Type: {e.CurrentControlType}, Name: '{name}', Rect: ({rect.left}, {rect.top}, {rect.right}, {rect.bottom})")
    except Exception as ex:
        print(f"Error on hwnd {h}: {ex}")
