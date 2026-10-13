use crate::models::project_profile::ProjectProfile;
use crate::services::project_profile_service::ProjectProfileService;
use crate::store::AppState;
use tauri::State;

#[tauri::command]
pub fn get_project_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<ProjectProfile>, String> {
    ProjectProfileService::get_profiles(&state.db)
}

#[tauri::command]
pub fn save_project_profile(
    state: State<'_, AppState>,
    profile: ProjectProfile,
) -> Result<ProjectProfile, String> {
    ProjectProfileService::save_profile(&state.db, profile)
}

#[tauri::command]
pub fn delete_project_profile(
    state: State<'_, AppState>,
    id: String,
) -> Result<bool, String> {
    ProjectProfileService::delete_profile(&state.db, &id)
}

#[tauri::command]
pub fn capture_current_project_profile(
    state: State<'_, AppState>,
    name: String,
    description: Option<String>,
    icon: Option<String>,
) -> Result<ProjectProfile, String> {
    ProjectProfileService::capture_current_profile(&state.db, name, description, icon)
}

#[tauri::command]
pub fn apply_project_profile(
    state: State<'_, AppState>,
    id: String,
) -> Result<ProjectProfile, String> {
    ProjectProfileService::apply_profile(&state.db, &id)
}
