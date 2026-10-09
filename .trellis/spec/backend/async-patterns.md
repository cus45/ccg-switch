# 异步模式

> tokio 使用、进程管理、并发控制

---

## 概述

CC Switch 后端使用 **tokio** 异步运行时。Tauri 2 自动集成 tokio，命令标记 `async` 后会在 tokio 运行时执行。

---

## 何时使用异步

### 必须用 async 的场景

- 文件 I/O（大文件、频繁读写）
- 网络请求（HTTP、WebSocket）
- 子进程管理（启动、通信、等待）
- tokio 工具（`sleep`、`spawn`、`select!`）
- 调用其他 async 函数
- SQLite 查询 / 写入（rusqlite 是阻塞的，哪怕只是一条聚合 SQL）
- 遍历会话目录（`~/.claude/projects`、`~/.codex/sessions` 可达数百文件、近 GB）

### 可用同步的场景

- 内存操作（读取已加载的配置）
- 快速文件读取（< 10ms，如小型 JSON）
- 纯计算/数据转换

**原则**：有疑问时用 async，避免阻塞。

### 同步 command 跑在主线程上

Tauri 里非 `async` 的 `#[tauri::command]` 在主线程执行：命令没返回，窗口就不响应。
用量统计曾全部是同步 command，进页面触发的会话文件扫描把整个应用卡住数秒；
首页的 `get_project_token_stats` 同样在启动时阻塞主线程。规则：

- 凡是碰数据库或文件系统的 command 一律 `async fn`，函数体丢进
  `tauri::async_runtime::spawn_blocking`（阻塞线程池）。不要直接在 async fn 里调阻塞 I/O，
  那会占住 tokio worker。
- `State<'_, AppState>` 不能跨线程，先 `let db = state.db.clone()`（`Arc`）再 move 进闭包。
- 统一写法见 `commands/usage_commands.rs::run_blocking` 与 `lib.rs::run_fs_blocking`：

```rust
#[tauri::command]
pub async fn get_usage_summary(
    state: State<'_, AppState>,
    start: Option<i64>,
    end: Option<i64>,
) -> Result<UsageSummary, String> {
    let db = state.db.clone();
    tauri::async_runtime::spawn_blocking(move || db.get_usage_summary(start, end))
        .await
        .map_err(|e| format!("后台任务执行失败: {e}"))?
}
```

### 反复扫描外部日志要做文件级增量

会话 JSONL 是追加写的。扫描器按文件记录 `(size, mtime, offset)`（表 `session_scan_files`）：
两者没变整文件跳过、不打开；变了只从 offset 续读完整行；`size < offset` 视为截断，从头重扫，
重复行靠主键 `INSERT OR IGNORE` 兜底。再加行级字面量预筛选（不含 `"usage"` 的行连 JSON 都不解）
与一文件一事务批量写入（日志行 + 扫描进度原子提交）。
本机 793 个文件 / 923 MB：全量 1.2 s，稳态增量 33 ms（release）。
数据库开 `journal_mode=WAL` + `synchronous=NORMAL`，否则每行提交一次 fsync。
同类场景（首页 `sum_session_tokens`）至少做字面量预筛选 + 按 (size, mtime) 记忆化。


---

## 懒启动模式（OnceCell）

### 模式：首次使用时初始化

用 `tokio::sync::OnceCell` 实现懒加载的异步资源：

```rust
use tokio::sync::OnceCell;
use std::sync::Arc;

pub struct ChatManager {
    app: AppHandle,
    client: OnceCell<Arc<DaemonClient>>,
}

impl ChatManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            client: OnceCell::new(),
        }
    }

    async fn client(&self) -> Result<Arc<DaemonClient>, String> {
        self.client
            .get_or_try_init(|| async {
                let node = resources::detect_node()?;
                let bridge = resources::resolve_bridge_dir(&self.app)?;
                let client = Arc::new(DaemonClient::new(node, bridge));
                client.start().await?;
                Ok::<Arc<DaemonClient>, String>(client)
            })
            .await
            .map(|c| c.clone())
    }

    pub async fn send(&self, method: String, params: Value) -> Result<String, String> {
        let client = self.client().await?;  // 首次调用时启动 daemon
        client.send_streaming(method, params).await
    }
}
```

**要点**：
- `get_or_try_init` 保证只初始化一次，即使多个并发调用
- 初始化失败时返回错误，不缓存失败状态（下次调用会重试）
- 返回 `Arc<T>` 允许多个调用者共享同一实例

---

## 子进程管理

### 启动子进程（daemon）

```rust
use tokio::process::Command;

pub async fn start_daemon(node: PathBuf, script: PathBuf) -> Result<Child, String> {
    let mut child = Command::new(node)
        .arg(script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .envs(env_vars)  // 传递环境变量（如 CLAUDE_PERMISSION_DIR）
        .kill_on_drop(true)  // 进程对象 drop 时自动杀死子进程
        .spawn()
        .map_err(|e| format!("启动 daemon 失败: {e}"))?;
    Ok(child)
}
```

**环境变量传递**：
```rust
let mut cmd = Command::new(&node_path);
cmd.arg(&daemon_js)
    .env("AI_BRIDGE_DEPS_DIR", &deps_dir)
    .env("CLAUDE_PERMISSION_DIR", &perm_dir)  // 权限文件目录
    .env("CLAUDE_SESSION_ID", SESSION_ID);     // 会话 ID
```

**环境变量检查清单**（新增协议时必须同步）：

| 变量名 | 用途 | Rust 端传值 | Node 端读取 |
|--------|------|------------|------------|
| `AI_BRIDGE_DEPS_DIR` | SDK 安装目录 | `deps_dir` | `process.env.AI_BRIDGE_DEPS_DIR` |
| `CLAUDE_PERMISSION_DIR` | 权限文件 IPC 目录 | `permission_dir` | `process.env.CLAUDE_PERMISSION_DIR` |
| `CLAUDE_SESSION_ID` | 会话 ID（文件名前缀） | `"default"` | `process.env.CLAUDE_SESSION_ID` |

**常见错误**：
- ❌ 只在 Node 端硬编码默认路径，忘记从 Rust 传递（导致路径不一致）
- ❌ 环境变量拼写错误（如 `CLAUDE_PERMISSION_DIR` vs `PERMISSION_DIR`）
- ✅ 启动时打印接收到的环境变量（调试模式）以验证传递成功

### 读取 stdout/stderr

```rust
let stdout = child.stdout.take().ok_or("无法获取 stdout")?;
let reader = BufReader::new(stdout);
let mut lines = reader.lines();

while let Some(line) = lines.next_line().await? {
    if line.starts_with("[EVENT]") {
        // 解析事件并推送给前端
    }
}
```

### 检查进程是否存活

```rust
pub fn is_running(&self) -> bool {
    match self.process.lock().as_ref() {
        Some(child) => child.try_wait().ok().flatten().is_none(),
        None => false,
    }
}
```

### 优雅关闭

```rust
pub async fn shutdown(&self) {
    if let Some(mut child) = self.process.lock().take() {
        let _ = child.kill().await;  // 发 SIGKILL
        let _ = child.wait().await;   // 等待进程退出
    }
}
```

---

## 并发控制

### 后台任务（spawn）

```rust
fn spawn_heartbeat(client: Arc<DaemonClient>) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            if !client.is_running() {
                break;
            }
            if client.heartbeat().await.is_err() {
                break;
            }
        }
    });
}
```

**要点**：
- `tokio::spawn` 创建独立任务，不会阻塞当前函数
- 用 `Arc` 共享状态（`Arc<DaemonClient>`）
- 任务内循环检查退出条件，避免泄漏

### 轮询循环（文件监听）

```rust
pub fn start(&self) {
    let dir = self.permission_dir.clone();
    let session_id = self.session_id.clone();
    let app = self.app.clone();
    let stop = self.stop.clone();

    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            Self::poll_once(&dir, &session_id, &app);
            std::thread::sleep(Duration::from_millis(100));
        }
    });
}
```

**为什么用 `std::thread` 而非 tokio？**
- 文件 I/O 是同步的（`std::fs::read_dir`）
- 100ms 轮询不需要复杂调度，线程简单直接
- 避免占用 tokio 运行时的工作线程

---

## 超时控制

### 命令级超时（Tauri 内置）

Tauri 命令自带 30s 默认超时（可配置）。对于长时间运行的操作，立即返回 ID，通过事件流式推送结果：

```rust
#[tauri::command]
pub async fn chat_send(...) -> Result<String, String> {
    let request_id = generate_id();
    // 立即返回 ID，不等待完成
    tokio::spawn(async move {
        // 实际执行，结果通过事件推送
        let result = execute_long_task().await;
        app.emit("chat://done", result);
    });
    Ok(request_id)
}
```

### 手动超时（tokio::time::timeout）

```rust
use tokio::time::{timeout, Duration};

let result = timeout(Duration::from_secs(5), async_operation())
    .await
    .map_err(|_| "操作超时".to_string())?
    .map_err(|e| format!("操作失败: {e}"))?;
```

---

## Channel 通信

### 从子进程接收流式数据

```rust
use tokio::sync::mpsc;

let (tx, mut rx) = mpsc::unbounded_channel();

// 读取 stdout 的任务
tokio::spawn(async move {
    let mut lines = BufReader::new(stdout).lines();
    while let Some(line) = lines.next_line().await.ok().flatten() {
        let _ = tx.send(line);
    }
});

// 主任务消费数据
while let Some(line) = rx.recv().await {
    process_line(&line);
}
```

---

## 常见模式

### 模式 1：懒启动 + 重启

```rust
pub async fn restart(&self) -> Result<(), String> {
    // 关闭旧实例
    if let Some(old) = self.client.get() {
        old.shutdown().await;
    }
    // 清空 OnceCell，下次 client() 会重新初始化
    self.client.take();
    // 预热新实例
    self.client().await?;
    Ok(())
}
```

### 模式 2：请求-响应（带超时）

```rust
pub async fn send_with_timeout(
    &self,
    request: Request,
    timeout_secs: u64,
) -> Result<Response, String> {
    let (tx, rx) = oneshot::channel();
    self.pending_requests.insert(request.id.clone(), tx);
    
    self.write_request(request)?;
    
    tokio::time::timeout(
        Duration::from_secs(timeout_secs),
        rx
    )
    .await
    .map_err(|_| "请求超时".to_string())?
    .map_err(|_| "接收响应失败".to_string())
}
```

### 模式 3：批量并发（join_all）

```rust
use futures::future::join_all;

let tasks: Vec<_> = ids.iter()
    .map(|id| fetch_data(id.clone()))
    .collect();

let results = join_all(tasks).await;
```

---

## 错误处理

### 异步错误传播

```rust
async fn nested_operation() -> Result<Data, String> {
    let a = fetch_a().await?;
    let b = process_b(a).await?;
    Ok(b)
}
```

`?` 操作符在 async 函数中正常工作。

### 忽略错误（后台任务）

```rust
tokio::spawn(async move {
    if let Err(e) = risky_operation().await {
        eprintln!("后台任务失败: {e}");  // 记录但不崩溃
    }
});
```

---

## 常见错误

### 错误 1：在 async 函数里用阻塞 I/O

```rust
// ❌ 阻塞 tokio 运行时
pub async fn read_config() -> Result<Config, String> {
    let content = std::fs::read_to_string("config.json")?;  // 阻塞！
    serde_json::from_str(&content).map_err(|e| e.to_string())
}
```

应该：
```rust
// ✅ 用 tokio::fs（小文件可以忽略此优化）
pub async fn read_config() -> Result<Config, String> {
    let content = tokio::fs::read_to_string("config.json")
        .await
        .map_err(|e| format!("读取配置失败: {e}"))?;
    serde_json::from_str(&content).map_err(|e| e.to_string())
}
```

### 错误 2：忘记 .await

```rust
// ❌ 返回 Future，未实际执行
pub async fn send_message(...) -> Result<(), String> {
    client.send(...);  // 忘记 .await
    Ok(())
}
```

编译器会警告 `unused Future`，但容易忽略。

### 错误 3：spawn 后不处理错误

```rust
// ❌ 任务失败时静默忽略
tokio::spawn(async move {
    critical_operation().await.unwrap();  // panic 只影响这个任务，主程序不知道
});
```

应该：
```rust
// ✅ 记录错误或通过 channel 报告
tokio::spawn(async move {
    if let Err(e) = critical_operation().await {
        eprintln!("[ERROR] 关键操作失败: {e}");
        // 可选：通过 mpsc 通知主任务
    }
});
```

---

## 参考

- tokio 文档: https://tokio.rs/
- Tauri 异步命令: https://v2.tauri.app/develop/calling-rust/
