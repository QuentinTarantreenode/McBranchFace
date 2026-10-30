#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Remote {
    Azure { org_url: String, project: String, repo: String, web_base: String },
    GitHub { owner: String, repo: String },
    Other,
}

impl Remote {
    /// The server a provider call goes to: an Azure DevOps organization, or GitHub.
    pub fn server(&self) -> String {
        match self {
            Remote::Azure { org_url, .. } => org_url.to_lowercase(),
            Remote::GitHub { .. } => "github.com".to_string(),
            Remote::Other => String::new(),
        }
    }
}

pub fn parse(url: &str) -> Remote {
    let url = url.trim();
    parse_azure(url).or_else(|| parse_github(url)).unwrap_or(Remote::Other)
}

fn parse_azure(url: &str) -> Option<Remote> {
    // SSH: git@ssh.dev.azure.com:v3/Org/Project/Repo, Org@vs-ssh.visualstudio.com:v3/Org/Project/Repo
    if let Some(idx) = url.find(":v3/") {
        let host = &url[..idx];
        let parts: Vec<&str> = url[idx + 4..].split('/').collect();
        if parts.len() >= 3 && (host.contains("dev.azure.com") || host.contains("visualstudio.com")) {
            let org_url = if host.contains("visualstudio.com") {
                format!("https://{}.visualstudio.com", parts[0])
            } else {
                format!("https://dev.azure.com/{}", parts[0])
            };
            return Some(azure(org_url, parts[1], parts[2]));
        }
        return None;
    }

    let rest = url.strip_prefix("https://").or_else(|| url.strip_prefix("http://"))?;
    let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
    let (host, path) = rest.split_once('/')?;
    let segs: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    let git_idx = segs.iter().position(|s| *s == "_git")?;
    let repo = segs.get(git_idx + 1)?;

    if host.eq_ignore_ascii_case("dev.azure.com") {
        // dev.azure.com/Org/Project/_git/Repo
        if git_idx < 2 {
            return None;
        }
        return Some(azure(format!("https://dev.azure.com/{}", segs[0]), segs[git_idx - 1], repo));
    }
    if host.to_ascii_lowercase().ends_with(".visualstudio.com") {
        // org.visualstudio.com[/DefaultCollection]/Project/_git/Repo
        if git_idx < 1 {
            return None;
        }
        return Some(azure(format!("https://{host}"), segs[git_idx - 1], repo));
    }
    None
}

fn azure(org_url: String, project: &str, repo: &str) -> Remote {
    let repo = repo.trim_end_matches(".git");
    let web_base = format!("{org_url}/{project}/_git/{repo}");
    Remote::Azure { org_url, project: decode(project), repo: decode(repo), web_base }
}

fn parse_github(url: &str) -> Option<Remote> {
    let path = if let Some(p) = url.strip_prefix("git@github.com:") {
        p
    } else {
        let rest = url
            .strip_prefix("https://")
            .or_else(|| url.strip_prefix("http://"))
            .or_else(|| url.strip_prefix("ssh://"))?;
        let rest = rest.split_once('@').map(|(_, r)| r).unwrap_or(rest);
        let (host, path) = rest.split_once('/')?;
        if !host.eq_ignore_ascii_case("github.com") {
            return None;
        }
        path
    };
    let mut segs = path.trim_end_matches('/').split('/');
    let owner = segs.next()?.to_string();
    let repo = segs.next()?.trim_end_matches(".git").to_string();
    Some(Remote::GitHub { owner, repo })
}

fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(b) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// One value per repository, whatever URL flavour a working copy was cloned with
/// (HTTPS with or without user, SSH, visualstudio.com or dev.azure.com, trailing `.git`).
pub fn identity(url: &str) -> String {
    match parse(url) {
        Remote::Azure { org_url, project, repo, .. } => {
            let org = org_url
                .strip_prefix("https://dev.azure.com/")
                .map(String::from)
                .or_else(|| org_url.strip_prefix("https://").and_then(|h| h.split('.').next()).map(String::from))
                .unwrap_or(org_url);
            format!("dev.azure.com/{org}/{project}/{repo}").to_lowercase()
        }
        Remote::GitHub { owner, repo } => format!("github.com/{owner}/{repo}").to_lowercase(),
        Remote::Other => generic_identity(url),
    }
}

fn generic_identity(url: &str) -> String {
    let url = url.trim().replace('\\', "/");
    let (has_scheme, rest) = match url.split_once("://") {
        Some((_, r)) => (true, r.to_string()),
        None => (false, url.clone()),
    };
    let rest = match rest.split_once('@') {
        Some((user, r)) if !user.contains('/') => r.to_string(),
        _ => rest,
    };
    // scp syntax "host:path" becomes "host/path"; a Windows drive "C:/…" stays a path.
    let rest = match rest.split_once(':') {
        Some((host, path)) if !has_scheme && host.len() > 1 && !host.contains('/') => format!("{host}/{path}"),
        Some((host, path)) if has_scheme && path.split('/').next().is_some_and(|p| p.chars().all(|c| c.is_ascii_digit())) => {
            format!("{host}{}", &path[path.find('/').unwrap_or(path.len())..])
        }
        _ => rest,
    };
    rest.trim_end_matches('/').trim_end_matches(".git").trim_end_matches('/').to_lowercase()
}

/// The server that signs a fetch in: the Azure DevOps organization (one sign-in covers all its
/// repositories), GitHub, or the host of any other URL. None for a folder on disk, which asks nobody.
pub fn sign_in_server(url: &str) -> Option<String> {
    let remote = parse(url);
    if remote != Remote::Other {
        return Some(remote.server());
    }
    let url = url.trim().replace('\\', "/");
    let (rest, scheme) = match url.split_once("://") {
        Some((scheme, rest)) => (rest.to_string(), Some(scheme.to_ascii_lowercase())),
        None => (url.clone(), None),
    };
    if scheme.as_deref() == Some("file") {
        return None;
    }
    let rest = rest.split_once('@').filter(|(user, _)| !user.contains('/')).map_or(rest.as_str(), |(_, r)| r);
    let host = match scheme {
        Some(_) => rest.split(['/', ':']).next(),
        // scp syntax `host:path`; `C:/x` and `/srv/x` are folders.
        None => rest.split_once(':').map(|(h, _)| h).filter(|h| h.len() > 1 && !h.contains('/')),
    };
    host.filter(|h| !h.is_empty()).map(str::to_ascii_lowercase)
}

pub fn links(remote: &Remote) -> Option<crate::model::RepoLinks> {
    use crate::model::RepoLinks;
    match remote {
        Remote::Azure { web_base, .. } => Some(RepoLinks {
            home: web_base.clone(),
            pull_requests: format!("{web_base}/pullrequests?_a=active"),
            branch: format!("{web_base}?version=GB{{branch}}"),
        }),
        Remote::GitHub { owner, repo } => {
            let home = format!("https://github.com/{owner}/{repo}");
            Some(RepoLinks { pull_requests: format!("{home}/pulls"), branch: format!("{home}/tree/{{branch}}"), home })
        }
        Remote::Other => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_sign_in_server_per_organization_or_host() {
        let s = |u: &str| sign_in_server(u);
        assert_eq!(s("https://dev.azure.com/Org/P/_git/a").as_deref(), Some("https://dev.azure.com/org"));
        assert_eq!(s("git@ssh.dev.azure.com:v3/Org/P/b"), s("https://user@dev.azure.com/Org/P/_git/a"), "one organization, whatever the URL");
        assert_eq!(s("git@github.com:o/r.git").as_deref(), Some("github.com"));
        assert_eq!(s("https://git.example.com:8443/team/r.git").as_deref(), Some("git.example.com"));
        assert_eq!(s("ssh://git@Git.Example.com:2222/r.git").as_deref(), Some("git.example.com"));
        assert_eq!(s("git@gitlab.example.com:team/r.git").as_deref(), Some("gitlab.example.com"));
        assert_eq!(s("C:/repos/origin.git"), None, "a folder asks nobody");
        assert_eq!(s("/srv/git/origin.git"), None);
        assert_eq!(s("file:///srv/git/origin.git"), None);
    }

    #[test]
    fn azure_https_with_user() {
        let r = parse("https://Fabrikam@dev.azure.com/Fabrikam/Acme.Core/_git/26");
        assert_eq!(
            r,
            Remote::Azure {
                org_url: "https://dev.azure.com/Fabrikam".into(),
                project: "Acme.Core".into(),
                repo: "26".into(),
                web_base: "https://dev.azure.com/Fabrikam/Acme.Core/_git/26".into(),
            }
        );
    }

    #[test]
    fn azure_variants() {
        let Remote::Azure { org_url, project, repo, .. } =
            parse("https://org.visualstudio.com/DefaultCollection/My%20Project/_git/Repo")
        else {
            panic!()
        };
        assert_eq!((org_url.as_str(), project.as_str(), repo.as_str()), ("https://org.visualstudio.com", "My Project", "Repo"));

        let Remote::Azure { org_url, project, repo, .. } = parse("git@ssh.dev.azure.com:v3/Org/Proj/Repo") else {
            panic!()
        };
        assert_eq!((org_url.as_str(), project.as_str(), repo.as_str()), ("https://dev.azure.com/Org", "Proj", "Repo"));
    }

    #[test]
    fn github_variants() {
        for u in ["https://github.com/o/r.git", "git@github.com:o/r.git", "ssh://git@github.com/o/r"] {
            assert_eq!(parse(u), Remote::GitHub { owner: "o".into(), repo: "r".into() }, "{u}");
        }
        assert_eq!(parse("https://gitlab.com/o/r.git"), Remote::Other);
    }

    #[test]
    fn identity_is_the_same_for_every_url_flavour() {
        let azure = [
            "https://Fabrikam@dev.azure.com/Fabrikam/Acme.Core/_git/26",
            "https://dev.azure.com/fabrikam/Acme.Core/_git/26",
            "https://fabrikam.visualstudio.com/Acme.Core/_git/26",
            "https://fabrikam.visualstudio.com/DefaultCollection/Acme.Core/_git/26",
            "git@ssh.dev.azure.com:v3/Fabrikam/Acme.Core/26",
        ];
        for u in azure {
            assert_eq!(identity(u), "dev.azure.com/fabrikam/acme.core/26", "{u}");
        }
        for u in ["https://github.com/O/R.git", "git@github.com:o/r", "ssh://git@github.com/o/r/"] {
            assert_eq!(identity(u), "github.com/o/r", "{u}");
        }
        for u in ["https://gitlab.com/g/r.git", "git@gitlab.com:g/r.git", "ssh://git@gitlab.com:22/g/r"] {
            assert_eq!(identity(u), "gitlab.com/g/r", "{u}");
        }
        assert_eq!(identity("C:\\repos\\origin.git"), "c:/repos/origin", "local path keeps its drive");
        assert_ne!(identity("https://github.com/o/r"), identity("https://github.com/o/r2"));
    }

    #[test]
    fn provider_links() {
        let l = links(&parse("https://github.com/o/r.git")).unwrap();
        assert_eq!(l.pull_requests, "https://github.com/o/r/pulls");
        assert_eq!(l.branch.replace("{branch}", "f/x"), "https://github.com/o/r/tree/f/x");
        let l = links(&parse("https://dev.azure.com/Org/P/_git/R")).unwrap();
        assert_eq!(l.branch.replace("{branch}", "f/x"), "https://dev.azure.com/Org/P/_git/R?version=GBf/x");
        assert!(links(&Remote::Other).is_none());
    }
}
