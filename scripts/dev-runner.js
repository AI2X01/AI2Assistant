import net from 'node:net';
import { spawn, execSync } from 'node:child_process';
import process from 'node:process';

const PORT = 1420;

/**
 * 探测端口是否已经处于监听状态（兼容 IPv4、IPv6 与系统 netstat 双重检测）
 */
async function checkPortInUse(port) {
  const hosts = ['localhost', '127.0.0.1', '::1'];
  for (const host of hosts) {
    const isOpen = await new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(250);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        socket.destroy();
        resolve(false);
      });

      socket.connect(port, host);
    });

    if (isOpen) {
      return true;
    }
  }

  // 系统级双重确认（Windows netstat）
  if (process.platform === 'win32') {
    try {
      const output = execSync('netstat -ano', {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const pattern = new RegExp(`:${port}\\s+.*LISTENING`, 'i');
      if (pattern.test(output)) {
        return true;
      }
    } catch {}
  }

  return false;
}

async function main() {
  const inUse = await checkPortInUse(PORT);

  if (inUse) {
    console.log(`\n=============================================================`);
    console.log(`⚡ [AI助手] 检测到前端端口 ${PORT} 已处于监听状态`);
    console.log(`⚡ [AI助手] 自动跳过前端启动，直接打开客户端 UI 窗口！`);
    console.log(`=============================================================\n`);
    // 正常退出，通知 Tauri CLI 前置开发服务器已就绪，立即启动客户端窗口
    process.exit(0);
  }

  console.log(`\n🚀 [AI助手] 端口 ${PORT} 空闲，正在为您启动 Vite 前端服务...\n`);

  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'npx.cmd' : 'npx';
  const child = spawn(cmd, ['vite'], {
    stdio: 'inherit',
    shell: true,
  });

  child.on('error', (err) => {
    console.error('启动 Vite 失败:', err);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  // 处理退出信号
  const cleanup = () => {
    if (!child.killed) {
      try {
        child.kill();
      } catch {}
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main();
