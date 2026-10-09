use crate::models::subagent::Subagent;
use std::fs;
use std::io;
use std::path::PathBuf;

fn get_agents_dir() -> Result<PathBuf, io::Error> {
    let home = dirs::home_dir()
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "Home directory not found"))?;
    Ok(home.join(".claude").join("agents"))
}

pub fn list_subagents() -> Result<Vec<Subagent>, io::Error> {
    let dir = get_agents_dir()?;
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut agents = Vec::new();
    for entry in fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().is_some_and(|ext| ext == "md") {
            let name = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            let content = fs::read_to_string(&path)?;
            agents.push(Subagent {
                name,
                content,
                file_path: path.to_string_lossy().to_string(),
            });
        }
    }
    agents.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(agents)
}

pub fn get_subagent(name: &str) -> Result<Subagent, io::Error> {
    let path = get_agents_dir()?.join(format!("{}.md", name));
    if !path.exists() {
        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            "Subagent not found",
        ));
    }
    let content = fs::read_to_string(&path)?;
    Ok(Subagent {
        name: name.to_string(),
        content,
        file_path: path.to_string_lossy().to_string(),
    })
}

pub fn save_subagent(name: &str, content: &str) -> Result<(), io::Error> {
    let dir = get_agents_dir()?;
    fs::create_dir_all(&dir)?;
    fs::write(dir.join(format!("{}.md", name)), content)?;
    Ok(())
}

pub fn delete_subagent(name: &str) -> Result<(), io::Error> {
    let path = get_agents_dir()?.join(format!("{}.md", name));
    if path.exists() {
        fs::remove_file(&path)?;
    }
    Ok(())
}
