use serde::Serialize;
use tauri::{AppHandle, Emitter};
use futures::StreamExt;
use tokio::io::AsyncWriteExt;

const GITHUB_REPO: &str = "cus45/ccg-switch";

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: String,
    pub download_url: Option<String>,
    pub file_size: Option<u64>,
    pub published_at: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub percentage: f64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    pub stage: String,
    pub message: String,
    pub percentage: f64,
}

/// 检查 GitHub Release 是否有新版本
pub async fn check_update(current_version: &str) -> Result<UpdateInfo, String> {
    let url = format!("https://api.github.com/repos/{}/releases/latest", GITHUB_REPO);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(&url)
        .header("User-Agent", "CCG-Switch-Updater")
        .send()
        .await
        .map_err(|e| format!("网络请求失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API 请求失败: {}", response.status()));
    }

    let release: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("解析响应失败: {}", e))?;

    let tag_name = release["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v');
    let body = release["body"].as_str().unwrap_or("");
    let published_at = release["published_at"].as_str().unwrap_or("");

    let (download_url, file_size) = find_platform_asset(&release);
    let has_update = version_is_newer(tag_name, current_version);

    Ok(UpdateInfo {
        has_update,
        current_version: current_version.to_string(),
        latest_version: tag_name.to_string(),
        release_notes: body.to_string(),
        download_url,
        file_size,
        published_at: Some(published_at.to_string()),
    })
}

/// 从 Release assets 中找到当前平台对应的安装包
fn find_platform_asset(release: &serde_json::Value) -> (Option<String>, Option<u64>) {
    let assets = match release["assets"].as_array() {
        Some(assets) => assets,
        None => return (None, None),
    };

    #[cfg(target_os = "windows")]
    {
        // 优先 NSIS .exe 安装包
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            if name.ends_with("-setup.exe") {
                return (
                    asset["browser_download_url"].as_str().map(String::from),
                    asset["size"].as_u64(),
                );
            }
        }
        // 其次 .msi
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            if name.ends_with(".msi") {
                return (
                    asset["browser_download_url"].as_str().map(String::from),
                    asset["size"].as_u64(),
                );
            }
        }
    }

    #[cfg(target_os = "macos")]
    {
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            if name.ends_with(".dmg") {
                return (
                    asset["browser_download_url"].as_str().map(String::from),
                    asset["size"].as_u64(),
                );
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for asset in assets {
            let name = asset["name"].as_str().unwrap_or("");
            if name.ends_with(".AppImage") {
                return (
                    asset["browser_download_url"].as_str().map(String::from),
                    asset["size"].as_u64(),
                );
            }
        }
    }

    (None, None)
}

/// 语义版本比较
fn version_is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> Vec<u32> {
        v.split('.').filter_map(|s| s.parse().ok()).collect()
    };
    parse(latest) > parse(current)
}

/// 下载更新安装包，通过事件推送下载进度
pub async fn download_update(app: &AppHandle, url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .build()
        .map_err(|e| format!("创建 HTTP 客户端失败: {}", e))?;

    let response = client
        .get(url)
        .header("User-Agent", "CCG-Switch-Updater")
        .send()
        .await
        .map_err(|e| format!("下载失败: {}", e))?;

    let total = response.content_length().unwrap_or(0);
    let file_name = url.split('/').last().unwrap_or("update-installer.exe");

    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(file_name);

    let mut file = tokio::fs::File::create(&file_path)
        .await
        .map_err(|e| format!("创建临时文件失败: {}", e))?;

    let mut stream = response.bytes_stream();
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("下载中断: {}", e))?;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {}", e))?;

        downloaded += chunk.len() as u64;

        let percentage = if total > 0 {
            (downloaded as f64 / total as f64 * 100.0).min(100.0)
        } else {
            0.0
        };

        let _ = app.emit("update-download-progress", DownloadProgress {
            downloaded,
            total,
            percentage,
        });
    }

    file.flush()
        .await
        .map_err(|e| format!("文件写入失败: {}", e))?;

    Ok(file_path.to_string_lossy().to_string())
}

/// 启动安装程序
pub fn install_update(app: &tauri::AppHandle, file_path: &str) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        use std::fs;

        // Stage 1: 挂载 DMG
        let _ = app.emit("update-install-progress", InstallProgress {
            stage: "mounting".to_string(),
            message: "正在挂载磁盘镜像...".to_string(),
            percentage: 10.0,
        });

        let mount_output = std::process::Command::new("hdiutil")
            .args(["attach", "-nobrowse", "-readonly", file_path])
            .output()
            .map_err(|e| format!("挂载 DMG 失败: {}，请确保已授权访问磁盘权限", e))?;

        if !mount_output.status.success() {
            let stderr = String::from_utf8_lossy(&mount_output.stderr);
            return Err(format!("挂载 DMG 失败: {}", stderr));
        }

        let stdout = String::from_utf8_lossy(&mount_output.stdout);

        // 解析挂载点路径（例如：/Volumes/CCG Switch）
        let mount_point = stdout
            .lines()
            .find(|line| line.contains("/Volumes/"))
            .and_then(|line| line.split('\t').find(|part| part.contains("/Volumes/")))
            .map(|s| s.trim().to_string())
            .ok_or_else(|| format!("无法解析 DMG 挂载点，输出: {}", stdout))?;

        // Stage 2: 查找 .app 文件
        let _ = app.emit("update-install-progress", InstallProgress {
            stage: "copying".to_string(),
            message: "正在查找应用程序...".to_string(),
            percentage: 30.0,
        });

        let mount_path = std::path::Path::new(&mount_point);
        let app_bundle = fs::read_dir(mount_path)
            .map_err(|e| format!("读取挂载点失败: {}", e))?
            .filter_map(Result::ok)
            .find(|entry| entry.path().extension().map_or(false, |ext| ext == "app"))
            .ok_or_else(|| format!("DMG 中未找到 .app 文件"))?;

        let app_source = app_bundle.path();
        let app_name = app_source
            .file_name()
            .ok_or_else(|| format!("无法获取应用名称"))?;
        let app_target = std::path::Path::new("/Applications").join(app_name);

        // Stage 3: 复制到 /Applications
        let _ = app.emit("update-install-progress", InstallProgress {
            stage: "copying".to_string(),
            message: format!("正在复制到应用程序文件夹...",),
            percentage: 50.0,
        });

        // 如果目标已存在，先删除
        if app_target.exists() {
            fs::remove_dir_all(&app_target)
                .map_err(|e| format!("删除旧版本失败（权限不足）: {}，请手动删除 /Applications 中的旧版本后重试", e))?;
        }

        // 使用 cp -R 递归复制
        std::process::Command::new("cp")
            .args(["-R", app_source.to_str().unwrap(), app_target.to_str().unwrap()])
            .status()
            .map_err(|e| format!("复制应用失败: {}，请确保已授予写入 /Applications 的权限", e))?;

        if !app_target.exists() {
            return Err(format!("复制后目标文件不存在，请检查 /Applications 目录权限"));
        }

        // Stage 4: 验证
        let _ = app.emit("update-install-progress", InstallProgress {
            stage: "verifying".to_string(),
            message: "正在验证安装...".to_string(),
            percentage: 80.0,
        });

        if !app_target.exists() || !app_target.join("Contents").exists() {
            return Err(format!("安装验证失败：应用包结构不完整"));
        }

        // Stage 5: 清理（卸载 DMG）
        let _ = app.emit("update-install-progress", InstallProgress {
            stage: "cleanup".to_string(),
            message: "正在清理临时文件...".to_string(),
            percentage: 90.0,
        });

        let _ = std::process::Command::new("hdiutil")
            .args(["detach", &mount_point])
            .status();

        // Stage 6: 完成
        let _ = app.emit("update-install-progress", InstallProgress {
            stage: "success".to_string(),
            message: format!("安装成功！已更新到 /Applications/{}", app_name.to_string_lossy()),
            percentage: 100.0,
        });

        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    {
        std::process::Command::new(file_path)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {}", e))?;
        Ok(())
    }
}
