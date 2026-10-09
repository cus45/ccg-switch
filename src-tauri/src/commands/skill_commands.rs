use crate::database::dao::skills::{InstalledSkillRow, SkillRepo};
use crate::services::sandbox_service::{run_sandbox_test, SandboxRequest, SandboxResponse};
use crate::services::skill_discovery::DiscoverableSkill;
use crate::services::skill_service_v2::{
    RemoteUpdateData, SkillServiceV2, SkillUpdateStatus, UpdateAllResult, ZipInstallResult,
};
use crate::store::AppState;
use tauri::State;

/// 获取所有已安装的 Skills（数据库版）
#[tauri::command]
pub fn get_installed_skills(state: State<'_, AppState>) -> Result<Vec<InstalledSkillRow>, String> {
    SkillServiceV2::get_all_installed(&state.db)
}

/// 安装 Skill（从 GitHub 仓库下载）
#[tauri::command]
pub async fn install_skill(
    state: State<'_, AppState>,
    skill: DiscoverableSkill,
    current_app: String,
) -> Result<InstalledSkillRow, String> {
    SkillServiceV2::install(&state.db, &skill, &current_app).await
}

/// 读取技能的系统提示词内容（SKILL.md 文件全文）
#[tauri::command]
pub fn read_skill_content_by_id(state: State<'_, AppState>, id: String) -> Result<String, String> {
    let skills = state
        .db
        .get_all_installed_skills()
        .map_err(|e| format!("DB Error: {}", e))?;
    let skill = skills
        .get(&id)
        .ok_or_else(|| format!("找不到技能: {}", id))?;

    let home = dirs::home_dir().ok_or("无法获取 HOME 目录")?;
    let skill_file = home
        .join(".ccg-switch")
        .join("skills")
        .join(&skill.directory)
        .join("SKILL.md");

    if !skill_file.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&skill_file).map_err(|e| format!("读取文件失败: {}", e))
}

/// 导出单技能为 Base64 长链接
#[tauri::command]
pub fn export_skill(state: State<'_, AppState>, id: String) -> Result<String, String> {
    SkillServiceV2::export_skill(&state.db, &id)
}

/// 从 Base64 长链接导入技能
#[tauri::command]
pub fn import_skill(
    state: State<'_, AppState>,
    payload: String,
) -> Result<InstalledSkillRow, String> {
    SkillServiceV2::import_skill(&state.db, &payload)
}

/// 卸载 Skill
#[tauri::command]
pub fn uninstall_skill(state: State<'_, AppState>, id: String) -> Result<(), String> {
    SkillServiceV2::uninstall(&state.db, &id)
}

/// 切换 Skill 的应用启用状态
#[tauri::command]
pub fn toggle_skill_app(
    state: State<'_, AppState>,
    id: String,
    app: String,
    enabled: bool,
) -> Result<(), String> {
    SkillServiceV2::toggle_app(&state.db, &id, &app, enabled)
}

/// 发现可安装的 Skills（从仓库抓取）
#[tauri::command]
pub async fn discover_skills(state: State<'_, AppState>) -> Result<Vec<DiscoverableSkill>, String> {
    SkillServiceV2::discover(&state.db).await
}

/// 获取技能仓库列表
#[tauri::command]
pub fn get_skill_repos(state: State<'_, AppState>) -> Result<Vec<SkillRepo>, String> {
    SkillServiceV2::get_repos(&state.db)
}

/// 保存技能仓库
#[tauri::command]
pub fn save_skill_repo(state: State<'_, AppState>, repo: SkillRepo) -> Result<(), String> {
    SkillServiceV2::save_repo(&state.db, repo)
}

/// 删除技能仓库
#[tauri::command]
pub fn delete_skill_repo(
    state: State<'_, AppState>,
    owner: String,
    name: String,
) -> Result<(), String> {
    SkillServiceV2::delete_repo(&state.db, &owner, &name)
}

/// 扫描并导入本地已有的 Skills
#[tauri::command]
pub fn scan_and_import_skills(
    state: State<'_, AppState>,
) -> Result<(usize, usize, Vec<String>), String> {
    SkillServiceV2::scan_and_import(&state.db)
}

/// 运行技能沙盒测试（调用选定的大模型 Provider）
#[tauri::command]
pub async fn run_skill_sandbox(
    state: State<'_, AppState>,
    request: SandboxRequest,
) -> Result<SandboxResponse, String> {
    run_sandbox_test(&state.db, request).await
}

/// 检查技能是否有远程更新
#[tauri::command]
pub async fn check_skill_update(
    state: State<'_, AppState>,
    id: String,
) -> Result<RemoteUpdateData, String> {
    SkillServiceV2::check_update(&state.db, &id).await
}

/// 应用技能远程更新
#[tauri::command]
pub fn apply_skill_update(
    state: State<'_, AppState>,
    id: String,
    new_content: String,
) -> Result<(), String> {
    SkillServiceV2::apply_update(&state.db, &id, &new_content)
}

/// 检查所有来自仓库的技能是否有更新
#[tauri::command]
pub async fn check_all_skill_updates(
    state: State<'_, AppState>,
) -> Result<Vec<SkillUpdateStatus>, String> {
    SkillServiceV2::check_all_updates(&state.db).await
}

/// 一键更新全部有更新的技能
#[tauri::command]
pub async fn update_all_skills(state: State<'_, AppState>) -> Result<UpdateAllResult, String> {
    SkillServiceV2::update_all(&state.db).await
}

/// 从本地 ZIP 安装技能
#[tauri::command]
pub fn install_skills_from_zip(
    state: State<'_, AppState>,
    path: String,
    current_app: String,
) -> Result<ZipInstallResult, String> {
    SkillServiceV2::install_from_zip(&state.db, std::path::Path::new(&path), &current_app)
}
