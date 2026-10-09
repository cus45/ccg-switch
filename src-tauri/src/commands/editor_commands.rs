// 编辑器集成命令

use std::path::{Path, PathBuf};
use std::process::Command;

const MAX_FUZZY_SEARCH_ENTRIES: usize = 20_000;
const FUZZY_SKIP_DIRS: &[&str] = &[
    ".git",
    ".next",
    ".turbo",
    "build",
    "dist",
    "node_modules",
    "src-tauri/target",
    "target",
];

#[derive(Clone, Copy)]
enum EditorLaunchMode {
    CodeGoto,
    JetBrainsLine,
}

struct EditorCandidate {
    program: String,
    mode: EditorLaunchMode,
}

fn normalize_windows_like_path(path: &str) -> String {
    let (cleaned, _) = clean_file_path_input(path);

    #[cfg(target_os = "windows")]
    {
        let bytes = cleaned.as_bytes();
        if bytes.len() >= 3
            && bytes[0] == b'/'
            && bytes[1].is_ascii_alphabetic()
            && bytes[2] == b'/'
        {
            let drive = (bytes[1] as char).to_ascii_uppercase();
            return format!("{}:\\{}", drive, cleaned[3..].replace('/', "\\"));
        }

        if bytes.len() >= 8
            && cleaned[..5].eq_ignore_ascii_case("/mnt/")
            && bytes[5].is_ascii_alphabetic()
            && bytes[6] == b'/'
        {
            let drive = (bytes[5] as char).to_ascii_uppercase();
            return format!("{}:\\{}", drive, cleaned[7..].replace('/', "\\"));
        }
    }

    cleaned
}

fn clean_file_path_input(path: &str) -> (String, Option<u32>) {
    let trimmed = path.trim().trim_matches('"');
    let without_url = trimmed
        .strip_prefix("file:///")
        .map(|rest| {
            #[cfg(target_os = "windows")]
            {
                if rest.as_bytes().get(1) == Some(&b':') {
                    return rest.to_string();
                }
            }
            format!("/{rest}")
        })
        .or_else(|| trimmed.strip_prefix("file://").map(ToString::to_string))
        .unwrap_or_else(|| trimmed.to_string());

    strip_editor_line_suffix(&without_url)
}

fn strip_editor_line_suffix(path: &str) -> (String, Option<u32>) {
    let Some(last_colon) = path.rfind(':') else {
        return (path.to_string(), None);
    };

    let tail = &path[last_colon + 1..];
    if let Some((line, end)) = tail.split_once('-') {
        if is_decimal(line) && is_decimal(end) {
            return (path[..last_colon].to_string(), line.parse().ok());
        }
    }

    if !is_decimal(tail) {
        return (path.to_string(), None);
    }

    let before_last_colon = &path[..last_colon];
    if let Some(previous_colon) = before_last_colon.rfind(':') {
        let possible_line = &before_last_colon[previous_colon + 1..];
        if is_decimal(possible_line) {
            return (
                before_last_colon[..previous_colon].to_string(),
                possible_line.parse().ok(),
            );
        }
    }

    (before_last_colon.to_string(), tail.parse().ok())
}

fn is_decimal(value: &str) -> bool {
    !value.is_empty() && value.as_bytes().iter().all(u8::is_ascii_digit)
}

fn resolve_file_path(file_path: &str, cwd: Option<&str>) -> PathBuf {
    let normalized = normalize_windows_like_path(file_path);
    let candidate = PathBuf::from(&normalized);
    if candidate.is_absolute() {
        return candidate;
    }

    let Some(base) = cwd
        .map(normalize_windows_like_path)
        .map(PathBuf::from)
        .filter(|base| base.is_absolute())
    else {
        return PathBuf::from(normalized);
    };

    let direct = base.join(&candidate);
    if direct.is_file() {
        return direct;
    }

    resolve_file_by_fuzzy_match(&base, &normalized).unwrap_or(direct)
}

fn extract_file_name(path_hint: &str) -> Option<String> {
    let normalized = path_hint.replace('\\', "/");
    normalized
        .split('/').rfind(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .filter(|segment| !segment.is_empty())
}

fn extract_path_suffix(path_hint: &str) -> Option<String> {
    let segments = path_hint
        .replace('\\', "/")
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    if segments.len() <= 1 {
        return None;
    }

    let common_roots = ["src", "main", "java", "kotlin", "webview"];
    let start_index = if segments.len() > 2
        && common_roots
            .iter()
            .any(|root| segments[0].eq_ignore_ascii_case(root))
    {
        1
    } else {
        0
    };

    if start_index >= segments.len() - 1 {
        return None;
    }

    Some(segments[start_index..].join("/"))
}

fn should_skip_fuzzy_dir(base: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(base) else {
        return false;
    };
    let normalized = relative.to_string_lossy().replace('\\', "/");
    let normalized_lower = normalized.to_ascii_lowercase();
    FUZZY_SKIP_DIRS.iter().any(|skip| {
        let skip_lower = skip.to_ascii_lowercase();
        if skip_lower.contains('/') {
            return normalized_lower == skip_lower
                || normalized_lower.starts_with(&format!("{skip_lower}/"));
        }

        normalized_lower
            .split('/')
            .any(|segment| segment == skip_lower)
    })
}

fn fuzzy_score(relative_path: &str, path_hint: &str, path_suffix: Option<&str>) -> u8 {
    if relative_path.eq_ignore_ascii_case(path_hint) {
        return 0;
    }

    if relative_path
        .to_ascii_lowercase()
        .ends_with(&path_hint.to_ascii_lowercase())
    {
        return 1;
    }

    if let Some(suffix) = path_suffix {
        let relative_lower = relative_path.to_ascii_lowercase();
        let suffix_lower = suffix.to_ascii_lowercase();
        if relative_lower.ends_with(&suffix_lower) {
            return 2;
        }
        if relative_lower.contains(&suffix_lower) {
            return 3;
        }
    }

    let relative_lower = relative_path.to_ascii_lowercase();
    if relative_lower.starts_with("src/") || relative_lower.contains("/src/") {
        return 4;
    }
    if relative_lower.starts_with("main/") || relative_lower.contains("/main/") {
        return 5;
    }

    6
}

fn resolve_file_by_fuzzy_match(base: &Path, path_hint: &str) -> Option<PathBuf> {
    if !base.is_dir() {
        return None;
    }

    let normalized_hint = path_hint.replace('\\', "/");
    let normalized_hint = normalized_hint.trim_matches('/');
    let file_name = extract_file_name(normalized_hint)?;
    let path_suffix = extract_path_suffix(normalized_hint);
    let mut stack = vec![base.to_path_buf()];
    let mut visited_entries = 0usize;
    let mut matches: Vec<(u8, usize, String, PathBuf)> = Vec::new();

    while let Some(directory) = stack.pop() {
        if visited_entries >= MAX_FUZZY_SEARCH_ENTRIES {
            break;
        }

        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        let mut entries = entries.flatten().collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.path());

        for entry in entries {
            if visited_entries >= MAX_FUZZY_SEARCH_ENTRIES {
                break;
            }
            visited_entries += 1;

            let path = entry.path();
            if path.is_dir() {
                if !should_skip_fuzzy_dir(base, &path) {
                    stack.push(path);
                }
                continue;
            }

            let Some(current_file_name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if !current_file_name.eq_ignore_ascii_case(&file_name) {
                continue;
            }

            let relative_path = path
                .strip_prefix(base)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let score = fuzzy_score(&relative_path, normalized_hint, path_suffix.as_deref());
            matches.push((score, relative_path.len(), relative_path, path));
        }
    }

    matches.sort_by(|left, right| {
        left.0
            .cmp(&right.0)
            .then(left.1.cmp(&right.1))
            .then(left.2.cmp(&right.2))
    });
    matches.into_iter().next().map(|(_, _, _, path)| path)
}

fn goto_arg(path: &Path, line_start: Option<u32>) -> String {
    let path = path.to_string_lossy();
    line_start
        .map(|line| format!("{path}:{line}:1"))
        .unwrap_or_else(|| path.to_string())
}

fn try_spawn(program: &str, args: &[String]) -> bool {
    Command::new(program).args(args).spawn().is_ok()
}

fn discover_editor_executables(root: &Path, names: &[&str], max_depth: usize) -> Vec<PathBuf> {
    fn walk(
        dir: &Path,
        names: &[String],
        depth: usize,
        max_depth: usize,
        found: &mut Vec<PathBuf>,
    ) {
        if depth > max_depth {
            return;
        }

        let entries = match std::fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, names, depth + 1, max_depth, found);
                continue;
            }

            let Some(file_name) = path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.to_ascii_lowercase())
            else {
                continue;
            };

            if names.iter().any(|name| name == &file_name) {
                found.push(path);
            }
        }
    }

    let names = names
        .iter()
        .map(|name| name.to_ascii_lowercase())
        .collect::<Vec<_>>();
    let mut found = Vec::new();
    walk(root, &names, 0, max_depth, &mut found);
    found.sort();
    found.dedup();
    found
}

fn editor_args(
    mode: EditorLaunchMode,
    resolved_path: &Path,
    goto: &str,
    line_start: Option<u32>,
) -> Vec<String> {
    match mode {
        EditorLaunchMode::CodeGoto => vec!["--goto".to_string(), goto.to_string()],
        EditorLaunchMode::JetBrainsLine => {
            if let Some(line) = line_start {
                vec![
                    "--line".to_string(),
                    line.to_string(),
                    resolved_path.to_string_lossy().to_string(),
                ]
            } else {
                vec![resolved_path.to_string_lossy().to_string()]
            }
        }
    }
}

fn default_editor_candidates() -> Vec<EditorCandidate> {
    [
        ("code", EditorLaunchMode::CodeGoto),
        ("code.cmd", EditorLaunchMode::CodeGoto),
        ("Code.exe", EditorLaunchMode::CodeGoto),
        ("cursor", EditorLaunchMode::CodeGoto),
        ("cursor.cmd", EditorLaunchMode::CodeGoto),
        ("Cursor.exe", EditorLaunchMode::CodeGoto),
        ("idea64", EditorLaunchMode::JetBrainsLine),
        ("idea64.exe", EditorLaunchMode::JetBrainsLine),
        ("idea", EditorLaunchMode::JetBrainsLine),
        ("idea.cmd", EditorLaunchMode::JetBrainsLine),
        ("webstorm64", EditorLaunchMode::JetBrainsLine),
        ("webstorm64.exe", EditorLaunchMode::JetBrainsLine),
        ("webstorm", EditorLaunchMode::JetBrainsLine),
        ("webstorm.cmd", EditorLaunchMode::JetBrainsLine),
        ("rustrover64", EditorLaunchMode::JetBrainsLine),
        ("rustrover64.exe", EditorLaunchMode::JetBrainsLine),
        ("pycharm64", EditorLaunchMode::JetBrainsLine),
        ("pycharm64.exe", EditorLaunchMode::JetBrainsLine),
        ("clion64", EditorLaunchMode::JetBrainsLine),
        ("clion64.exe", EditorLaunchMode::JetBrainsLine),
    ]
    .into_iter()
    .map(|(program, mode)| EditorCandidate {
        program: program.to_string(),
        mode,
    })
    .collect()
}

#[cfg(target_os = "windows")]
fn push_existing_candidate(
    candidates: &mut Vec<EditorCandidate>,
    seen: &mut std::collections::HashSet<String>,
    path: PathBuf,
    mode: EditorLaunchMode,
) {
    if !path.exists() {
        return;
    }

    let program = path.to_string_lossy().to_string();
    if seen.insert(program.to_ascii_lowercase()) {
        candidates.push(EditorCandidate { program, mode });
    }
}

#[cfg(target_os = "windows")]
fn editor_candidates() -> Vec<EditorCandidate> {
    let mut candidates = default_editor_candidates();
    let mut seen = candidates
        .iter()
        .map(|candidate| candidate.program.to_ascii_lowercase())
        .collect::<std::collections::HashSet<_>>();

    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        push_existing_candidate(
            &mut candidates,
            &mut seen,
            local_app_data
                .join("Programs")
                .join("Microsoft VS Code")
                .join("Code.exe"),
            EditorLaunchMode::CodeGoto,
        );
        push_existing_candidate(
            &mut candidates,
            &mut seen,
            local_app_data
                .join("Programs")
                .join("Cursor")
                .join("Cursor.exe"),
            EditorLaunchMode::CodeGoto,
        );

        let toolbox_scripts = local_app_data
            .join("JetBrains")
            .join("Toolbox")
            .join("scripts");
        for script in [
            "idea.cmd",
            "webstorm.cmd",
            "rustrover.cmd",
            "pycharm.cmd",
            "clion.cmd",
        ] {
            push_existing_candidate(
                &mut candidates,
                &mut seen,
                toolbox_scripts.join(script),
                EditorLaunchMode::JetBrainsLine,
            );
        }

        let toolbox_apps = local_app_data
            .join("JetBrains")
            .join("Toolbox")
            .join("apps");
        for editor in discover_editor_executables(
            &toolbox_apps,
            &[
                "idea64.exe",
                "webstorm64.exe",
                "rustrover64.exe",
                "pycharm64.exe",
                "clion64.exe",
            ],
            8,
        ) {
            push_existing_candidate(
                &mut candidates,
                &mut seen,
                editor,
                EditorLaunchMode::JetBrainsLine,
            );
        }
    }

    for env_name in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        let Some(program_files) = std::env::var_os(env_name).map(PathBuf::from) else {
            continue;
        };

        push_existing_candidate(
            &mut candidates,
            &mut seen,
            program_files.join("Microsoft VS Code").join("Code.exe"),
            EditorLaunchMode::CodeGoto,
        );
        push_existing_candidate(
            &mut candidates,
            &mut seen,
            program_files.join("Cursor").join("Cursor.exe"),
            EditorLaunchMode::CodeGoto,
        );

        let jetbrains_root = program_files.join("JetBrains");
        for editor in discover_editor_executables(
            &jetbrains_root,
            &[
                "idea64.exe",
                "webstorm64.exe",
                "rustrover64.exe",
                "pycharm64.exe",
                "clion64.exe",
            ],
            4,
        ) {
            push_existing_candidate(
                &mut candidates,
                &mut seen,
                editor,
                EditorLaunchMode::JetBrainsLine,
            );
        }
    }

    candidates
}

#[cfg(not(target_os = "windows"))]
fn editor_candidates() -> Vec<EditorCandidate> {
    default_editor_candidates()
}

#[cfg(target_os = "windows")]
fn try_spawn_shell_open(path: &Path) -> bool {
    let path_arg = path.to_string_lossy().to_string();
    Command::new("cmd")
        .args(["/C", "start", "", &path_arg])
        .spawn()
        .is_ok()
}

#[cfg(target_os = "macos")]
fn try_spawn_shell_open(path: &Path) -> bool {
    Command::new("open").arg(path).spawn().is_ok()
}

#[cfg(target_os = "linux")]
fn try_spawn_shell_open(path: &Path) -> bool {
    Command::new("xdg-open").arg(path).spawn().is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolves_relative_file_path_against_cwd() {
        let resolved =
            resolve_file_path("src/pages/ChatPage.tsx", Some("C:/guodevelop/ccg-switch"));

        assert_eq!(
            resolved.to_string_lossy().replace('\\', "/"),
            "C:/guodevelop/ccg-switch/src/pages/ChatPage.tsx"
        );
    }

    #[test]
    fn strips_editor_line_suffix_before_resolving_path() {
        let resolved = resolve_file_path(
            "src/pages/ChatPage.tsx:122:7",
            Some("C:/guodevelop/ccg-switch"),
        );

        assert_eq!(
            resolved.to_string_lossy().replace('\\', "/"),
            "C:/guodevelop/ccg-switch/src/pages/ChatPage.tsx"
        );

        assert_eq!(
            clean_file_path_input("src/pages/ChatPage.tsx:122:7").1,
            Some(122)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalizes_slash_drive_windows_paths() {
        let normalized = normalize_windows_like_path("/c/guodevelop/ccg-switch/src/main.ts");

        assert_eq!(normalized, "C:\\guodevelop\\ccg-switch\\src\\main.ts");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalizes_wsl_mount_windows_paths() {
        let normalized = normalize_windows_like_path("/mnt/c/guodevelop/ccg-switch/src/main.ts");

        assert_eq!(normalized, "C:\\guodevelop\\ccg-switch\\src\\main.ts");
    }

    #[test]
    fn fuzzy_resolves_filename_against_cwd_when_direct_path_is_missing() {
        let root =
            std::env::temp_dir().join(format!("ccg-switch-fuzzy-name-{}", std::process::id()));
        let target_dir = root.join("src").join("utils");
        let target = target_dir.join("linkify.ts");

        fs::create_dir_all(&target_dir).expect("create source dir");
        fs::write(&target, "").expect("create target file");

        let resolved = resolve_file_path("linkify.ts", Some(&root.to_string_lossy()));

        assert_eq!(resolved, target);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fuzzy_prefers_path_suffix_over_first_filename_match() {
        let root =
            std::env::temp_dir().join(format!("ccg-switch-fuzzy-suffix-{}", std::process::id()));
        let less_specific_dir = root.join("src").join("other");
        let suffix_dir = root.join("webview").join("src").join("utils");
        let less_specific = less_specific_dir.join("linkify.ts");
        let suffix_target = suffix_dir.join("linkify.ts");

        fs::create_dir_all(&less_specific_dir).expect("create first source dir");
        fs::create_dir_all(&suffix_dir).expect("create suffix source dir");
        fs::write(&less_specific, "").expect("create first target file");
        fs::write(&suffix_target, "").expect("create suffix target file");

        let resolved = resolve_file_path("utils/linkify.ts", Some(&root.to_string_lossy()));

        assert_eq!(resolved, suffix_target);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn fuzzy_skips_generated_dependency_dirs() {
        let root =
            std::env::temp_dir().join(format!("ccg-switch-fuzzy-skip-{}", std::process::id()));
        let dependency_dir = root.join("node_modules").join("pkg");
        let dependency_file = dependency_dir.join("linkify.ts");

        fs::create_dir_all(&dependency_dir).expect("create dependency dir");
        fs::write(&dependency_file, "").expect("create dependency file");

        let resolved = resolve_file_path("linkify.ts", Some(&root.to_string_lossy()));

        assert_eq!(resolved, root.join("linkify.ts"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn discovers_editor_executables_in_nested_toolbox_dirs() {
        let root =
            std::env::temp_dir().join(format!("ccg-switch-editor-test-{}", std::process::id()));
        let bin_dir = root
            .join("JetBrains")
            .join("Toolbox")
            .join("apps")
            .join("IDEA-U")
            .join("ch-0")
            .join("243.25659.39")
            .join("bin");
        let editor = bin_dir.join("idea64.exe");

        fs::create_dir_all(&bin_dir).expect("create fake toolbox dir");
        fs::write(&editor, "").expect("create fake editor executable");

        let discovered = discover_editor_executables(
            &root.join("JetBrains").join("Toolbox").join("apps"),
            &["idea64.exe"],
            8,
        );

        assert!(discovered.contains(&editor));

        let _ = fs::remove_dir_all(root);
    }
}

/// 在编辑器中打开文件
///
/// # Arguments
/// * `file_path` - 文件路径
/// * `line_start` - 起始行号（可选）
/// * `line_end` - 结束行号（可选，暂未使用）
#[tauri::command]
pub async fn open_file_in_editor(
    file_path: String,
    line_start: Option<u32>,
    _line_end: Option<u32>,
    cwd: Option<String>,
) -> Result<(), String> {
    let (_, path_line_start) = clean_file_path_input(&file_path);
    let line_start = line_start.or(path_line_start);
    let resolved_path = resolve_file_path(&file_path, cwd.as_deref());
    let goto = goto_arg(&resolved_path, line_start);

    for candidate in editor_candidates() {
        let args = editor_args(candidate.mode, &resolved_path, &goto, line_start);

        if try_spawn(&candidate.program, &args) {
            return Ok(());
        }
    }

    if try_spawn_shell_open(&resolved_path) {
        return Ok(());
    }

    Err(format!(
        "Failed to open file in editor: {}",
        resolved_path.display()
    ))
}
