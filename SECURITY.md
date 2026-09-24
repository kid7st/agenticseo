# Security policy

Security fixes land on `main` and ship in the next GitHub release. Only the latest release is supported.

## Report privately

Do not open a public issue with a vulnerability or credentials. Use GitHub's [private vulnerability reporting](https://github.com/kid7st/agenticseo/security/advisories/new). Include a reproduction, affected commit or version, impact, and any relevant environment details without sending live secrets.

This includes credential leakage, unsafe handling of project-local data, and unexpected outbound requests from the CLI. Third-party provider outages and vulnerabilities in a user's own agent or website are outside this project's control.

## Protect local data

Keep `DATAFORSEO_API_KEY`, `AHREFS_API_KEY` and your Google OAuth client secret outside project files and Git. Google grants are stored in `~/.config/agenticseo/google-accounts.json` (or under `XDG_CONFIG_HOME`), readable only by you; `agenticseo google disconnect` revokes a grant at Google and removes it. Local `.agenticseo/evidence/` contains paid query results; the CLI creates a nested `.gitignore` for that directory. Review files before publishing an SEO project or filing an issue.
