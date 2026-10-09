#![allow(dead_code)]
pub mod atomic_io;
pub mod json_store;
pub mod jsonl_store;
pub mod lock_registry;

use std::fs;
use std::path::Path;

/// 清理目录下残留的 .tmp 文件
pub fn cleanup_stale_tmp_files(dir: &Path) {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "tmp") {
                let _ = fs::remove_file(&path);
            }
        }
    }
}
