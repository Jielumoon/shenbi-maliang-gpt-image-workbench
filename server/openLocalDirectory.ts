import path from "node:path";

const OPEN_DIRECTORY_SCRIPT = `
$ErrorActionPreference = 'Stop'
$serverPid = [int][Environment]::GetEnvironmentVariable('GPT_IMAGE_SERVER_PID')
$directory = [Environment]::GetEnvironmentVariable('GPT_IMAGE_LOG_DIRECTORY')
if (-not $directory -or -not (Test-Path -LiteralPath $directory -PathType Container)) {
  throw '日志目录不存在'
}
$server = Get-Process -Id $serverPid -ErrorAction Stop
$interactiveExplorer = Get-Process -Name explorer -ErrorAction SilentlyContinue |
  Where-Object { $_.SessionId -eq $server.SessionId } |
  Select-Object -First 1
if (-not $interactiveExplorer) {
  throw "服务进程位于会话 $($server.SessionId)，该会话没有可见的 Windows 资源管理器。请复制日志目录路径后手动打开。"
}
$explorerPath = Join-Path ([Environment]::GetEnvironmentVariable('SystemRoot')) 'explorer.exe'
Start-Process -FilePath $explorerPath -ArgumentList ('"{0}"' -f $directory) -ErrorAction Stop | Out-Null
`;

export function localDirectoryOpenCommand(
  directory: string,
  platform: NodeJS.Platform = process.platform,
  serverPid = process.pid
) {
  if (platform !== "win32") {
    throw new Error("当前服务不是运行在 Windows 桌面环境，无法打开资源管理器；请复制日志目录路径后到服务器上手动查看");
  }
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  return {
    candidates: [
      path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      "powershell.exe",
      "pwsh.exe"
    ],
    args: ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", OPEN_DIRECTORY_SCRIPT],
    environment: {
      ...process.env,
      SystemRoot: systemRoot,
      GPT_IMAGE_SERVER_PID: String(serverPid),
      GPT_IMAGE_LOG_DIRECTORY: path.resolve(directory)
    }
  };
}

export async function openLocalDirectory(directory: string) {
  const launch = localDirectoryOpenCommand(directory);
  let lastError = "";
  for (const command of launch.candidates) {
    try {
      const child = Bun.spawn({
        cmd: [command, ...launch.args],
        stdout: "pipe",
        stderr: "pipe",
        env: launch.environment,
        windowsHide: true
      });
      const timeout = setTimeout(() => child.kill(), 10_000);
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited
      ]).finally(() => clearTimeout(timeout));
      if (exitCode === 0) return;
      lastError = stderr.trim() || stdout.trim() || `资源管理器启动进程退出码 ${exitCode}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error ?? "");
    }
  }
  throw new Error(lastError || "资源管理器打开失败");
}
