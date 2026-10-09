use indexmap::IndexMap;
use serde::Serialize;
use serde_yaml::Value as YamlValue;
use std::path::{Path, PathBuf};

const MAX_COMMAND_SCAN_DEPTH: usize = 10;
const MAX_SCANNED_COMMANDS: usize = 200;
const MAX_FRONTMATTER_BYTES: usize = 8192;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct SlashCommand {
    pub id: String,
    pub name: String,
    pub description: String,
    pub source: String,
}

impl SlashCommand {
    fn new(name: &str, description: &str, source: &str) -> Self {
        let normalized_name = if name.starts_with('/') {
            name.to_string()
        } else {
            format!("/{name}")
        };
        Self {
            id: normalized_name.trim_start_matches('/').to_string(),
            name: normalized_name,
            description: description.to_string(),
            source: source.to_string(),
        }
    }
}

const LOCAL_COMMANDS: &[(&str, &str, &str)] = &[
    (
        "/clear",
        "Clear the current conversation and start a new session",
        "local",
    ),
    ("/help", "Show available slash commands", "local"),
];

const CLAUDE_BUILTIN_COMMANDS: &[(&str, &str, &str)] = &[
    (
        "/compact",
        "Summarize conversation to free context",
        "builtin",
    ),
    (
        "/context",
        "Visualize current context usage as a colored grid",
        "builtin",
    ),
    (
        "/init",
        "Initialize a new CLAUDE.md file with codebase documentation",
        "builtin",
    ),
    ("/plan", "Switch to plan mode", "builtin"),
    ("/resume", "Resume a previous conversation", "builtin"),
    ("/review", "Review a pull request", "builtin"),
    (
        "/batch",
        "Execute large-scale changes in parallel across isolated worktrees",
        "bundled",
    ),
    (
        "/claude-api",
        "Build apps with the Claude API or Anthropic SDK",
        "bundled",
    ),
    (
        "/debug",
        "Enable debug logging and diagnose session issues",
        "bundled",
    ),
    (
        "/loop",
        "Run a prompt or command on a recurring interval",
        "bundled",
    ),
    (
        "/simplify",
        "Review changed code for reuse, quality, and efficiency",
        "bundled",
    ),
    (
        "/update-config",
        "Configure settings.json hooks, permissions, and env vars",
        "bundled",
    ),
];

const CODEX_BUILTIN_COMMANDS: &[(&str, &str, &str)] = &[
    (
        "/compact",
        "Summarize conversation to free tokens",
        "builtin",
    ),
    (
        "/diff",
        "Show pending changes diff including untracked files",
        "builtin",
    ),
    ("/init", "Generate an AGENTS.md scaffold", "builtin"),
    ("/plan", "Switch to plan mode", "builtin"),
    ("/review", "Review working tree changes", "builtin"),
];

pub fn list_slash_commands(provider: Option<&str>, cwd: Option<&str>) -> Vec<SlashCommand> {
    let mut merged: IndexMap<String, SlashCommand> = IndexMap::new();

    for (name, description, source) in LOCAL_COMMANDS {
        insert_command(&mut merged, SlashCommand::new(name, description, source));
    }

    match provider.unwrap_or("claude").to_ascii_lowercase().as_str() {
        "codex" => {
            for (name, description, source) in CODEX_BUILTIN_COMMANDS {
                insert_command(&mut merged, SlashCommand::new(name, description, source));
            }
        }
        _ => {
            for (name, description, source) in CLAUDE_BUILTIN_COMMANDS {
                insert_command(&mut merged, SlashCommand::new(name, description, source));
            }
        }
    }

    for command in scan_project_commands(cwd) {
        insert_command(&mut merged, command);
    }

    merged.into_values().collect()
}

fn insert_command(merged: &mut IndexMap<String, SlashCommand>, command: SlashCommand) {
    merged.insert(command.name.to_ascii_lowercase(), command);
}

fn scan_project_commands(cwd: Option<&str>) -> Vec<SlashCommand> {
    let home = dirs::home_dir();
    let mut scan_dirs = Vec::new();

    if let Some(root) = resolve_cwd(cwd).or_else(|| home.clone()) {
        collect_command_scan_dirs(&root, home.as_deref(), &mut scan_dirs);
    }

    let mut commands = Vec::new();
    for dir in scan_dirs {
        scan_commands_recursive(&dir, &dir, "project", &mut commands, 0);
        if commands.len() >= MAX_SCANNED_COMMANDS {
            break;
        }
    }
    commands
}

fn resolve_cwd(cwd: Option<&str>) -> Option<PathBuf> {
    let raw = cwd?.trim();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    if path.is_dir() {
        Some(path)
    } else {
        path.parent().map(Path::to_path_buf)
    }
}

fn collect_command_scan_dirs(root: &Path, home: Option<&Path>, out: &mut Vec<PathBuf>) {
    let mut current = match root.canonicalize() {
        Ok(path) => path,
        Err(_) => root.to_path_buf(),
    };
    let home = home.and_then(|path| path.canonicalize().ok());

    for _ in 0..=MAX_COMMAND_SCAN_DEPTH {
        let candidate = current.join(".claude").join("commands");
        if candidate.is_dir() && !out.iter().any(|existing| same_path(existing, &candidate)) {
            out.push(candidate);
        }

        if home
            .as_ref()
            .is_some_and(|home_path| same_path(home_path, &current))
        {
            break;
        }

        let Some(parent) = current.parent() else {
            break;
        };
        current = parent.to_path_buf();
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    if cfg!(windows) {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    } else {
        left == right
    }
}

fn scan_commands_recursive(
    dir: &Path,
    base_dir: &Path,
    source: &str,
    commands: &mut Vec<SlashCommand>,
    depth: usize,
) {
    if depth > MAX_COMMAND_SCAN_DEPTH || commands.len() >= MAX_SCANNED_COMMANDS {
        return;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let mut entries = entries.filter_map(Result::ok).collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());

    let has_skill_md = entries.iter().any(|entry| {
        entry
            .file_type()
            .map(|file_type| file_type.is_file())
            .unwrap_or(false)
            && entry
                .file_name()
                .to_string_lossy()
                .eq_ignore_ascii_case("skill.md")
    });

    for entry in entries {
        if commands.len() >= MAX_SCANNED_COMMANDS {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        let path = entry.path();
        if file_type.is_file()
            && path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
        {
            if let Some(command) = parse_command_file(&path, base_dir, source) {
                commands.push(command);
            }
        } else if file_type.is_dir() && !has_skill_md {
            scan_commands_recursive(&path, base_dir, source, commands, depth + 1);
        }
    }
}

fn parse_command_file(path: &Path, base_dir: &Path, source: &str) -> Option<SlashCommand> {
    let stem = path.file_stem()?.to_string_lossy();
    let namespace = command_namespace(path, base_dir);
    let name = match namespace {
        Some(namespace) if !namespace.is_empty() => format!("/{namespace}:{stem}"),
        _ => format!("/{stem}"),
    };
    let description = extract_command_description(path).unwrap_or_default();
    Some(SlashCommand::new(&name, &description, source))
}

fn command_namespace(path: &Path, base_dir: &Path) -> Option<String> {
    let parent = path.parent()?;
    let relative = parent.strip_prefix(base_dir).ok()?;
    let parts = relative
        .components()
        .filter_map(|component| match component {
            std::path::Component::Normal(part) => Some(part.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(":"))
    }
}

fn extract_command_description(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_FRONTMATTER_BYTES)]);
    let frontmatter = extract_frontmatter(&text)?;
    let yaml = serde_yaml::from_str::<YamlValue>(&frontmatter).ok()?;
    match yaml {
        YamlValue::Mapping(mapping) => mapping
            .get(YamlValue::String("description".to_string()))
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned),
        _ => None,
    }
}

fn extract_frontmatter(text: &str) -> Option<String> {
    let normalized = text.strip_prefix('\u{feff}').unwrap_or(text);
    let after_open = normalized.strip_prefix("---")?;
    let after_open = after_open.strip_prefix('\r').unwrap_or(after_open);
    let after_open = after_open.strip_prefix('\n')?;
    let close_index = after_open.find("\n---")?;
    Some(after_open[..close_index].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ccg-slash-command-test-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn returns_claude_parity_builtins() {
        let commands = list_slash_commands(Some("claude"), None);
        let names = commands
            .iter()
            .map(|command| command.name.as_str())
            .collect::<Vec<_>>();

        assert!(names.contains(&"/context"));
        assert!(names.contains(&"/plan"));
        assert!(names.contains(&"/resume"));
        assert!(names.contains(&"/batch"));
        assert!(names.contains(&"/claude-api"));
    }

    #[test]
    fn returns_codex_specific_builtins() {
        let commands = list_slash_commands(Some("codex"), None);
        let names = commands
            .iter()
            .map(|command| command.name.as_str())
            .collect::<Vec<_>>();

        assert!(names.contains(&"/diff"));
        assert!(names.contains(&"/plan"));
        assert!(!names.contains(&"/resume"));
    }

    #[test]
    fn scans_project_claude_commands_recursively() {
        let root = temp_dir();
        let commands_dir = root.join(".claude").join("commands").join("review");
        std::fs::create_dir_all(&commands_dir).expect("create command dir");
        std::fs::write(
            commands_dir.join("deep.md"),
            "---\ndescription: Deep review command\n---\nbody\n",
        )
        .expect("write command");

        let commands = list_slash_commands(Some("claude"), root.to_str());
        let custom = commands
            .iter()
            .find(|command| command.name == "/review:deep")
            .expect("custom command");
        assert_eq!(custom.description, "Deep review command");

        let _ = std::fs::remove_dir_all(root);
    }
}
