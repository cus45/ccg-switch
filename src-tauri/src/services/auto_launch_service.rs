use std::io;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AutoLaunchStatus {
    #[serde(rename = "enabled")]
    pub enabled: bool,
    #[serde(rename = "supported")]
    pub supported: bool,
}

/// 获取开机自启动状态
pub fn get_auto_launch_status() -> Result<AutoLaunchStatus, io::Error> {
    let supported = cfg!(target_os = "windows");
    let enabled = if supported {
        check_auto_launch_enabled()
    } else {
        false
    };
    Ok(AutoLaunchStatus { enabled, supported })
}

/// 检查注册表中是否已设置自启动
#[cfg(target_os = "windows")]
fn check_auto_launch_enabled() -> bool {
    use std::process::Command;
    let key_path = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    match Command::new("reg")
        .args(["query", key_path, "/v", "CCSwitch"])
        .output()
    {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

#[cfg(not(target_os = "windows"))]
fn check_auto_launch_enabled() -> bool {
    false
}

/// 设置或取消开机自启动（Windows）
#[cfg(target_os = "windows")]
pub fn set_auto_launch(enabled: bool) -> Result<(), io::Error> {
    use std::process::Command;
    let exe_path = std::env::current_exe()
        .map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
    let key_path = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";

    let output = if enabled {
        Command::new("reg")
            .args([
                "add",
                key_path,
                "/v",
                "CCSwitch",
                "/t",
                "REG_SZ",
                "/d",
                &exe_path.to_string_lossy(),
                "/f",
            ])
            .output()?
    } else {
        Command::new("reg")
            .args(["delete", key_path, "/v", "CCSwitch", "/f"])
            .output()?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let action = if enabled { "add" } else { "delete" };
        return Err(io::Error::new(
            io::ErrorKind::Other,
            format!("Failed to {} auto-launch registry key: {}", action, stderr.trim()),
        ));
    }
    Ok(())
}

/// 非 Windows 平台：不支持自启动
#[cfg(not(target_os = "windows"))]
pub fn set_auto_launch(_enabled: bool) -> Result<(), io::Error> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Auto-launch not supported on this platform",
    ))
}
