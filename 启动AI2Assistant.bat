@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "EXE_RELEASE=%~dp0src-tauri\target\release\ai2assistant.exe"
set "EXE_DEBUG=%~dp0src-tauri\target\debug\ai2assistant.exe"

:: 1. 优先唤起独立 Release 客户端（内嵌完整前端资源，零依赖、启动速度最快）
if exist "%EXE_RELEASE%" (
    echo [AI助手] 正在为您唤起 Release 独立客户端...
    start "" "%EXE_RELEASE%"
    goto :done
)

:: 2. 检查前端 1420 端口是否已有服务在运行
set "PORT_IN_USE=0"
netstat -ano | findstr ":1420" | findstr "LISTENING" >nul 2>nul
if %errorlevel% equ 0 (
    set "PORT_IN_USE=1"
    echo [AI助手] 检测到前端端口 1420 已有服务在运行，自动跳过前端启动，直接打开客户端 UI！
)

:: 3. 唤起 Debug 调试客户端
if exist "%EXE_DEBUG%" (
    echo [AI助手] 正在唤起 Debug 调试客户端...
    if "%PORT_IN_USE%"=="0" (
        echo [AI助手] 正在启动前端开发服务...
        start /min cmd /c "pnpm dev"
        timeout /t 2 /nobreak >nul
    )
    start "" "%EXE_DEBUG%"
    goto :done
)

:: 4. 集成开发模式启动
echo [AI助手] 正在执行集成开发启动...
pnpm tauri dev

:done
exit /b 0

