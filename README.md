# Agent-first SEO (working title)

An open-source SEO platform designed for agents. The goal is to bring OpenSEO's SEO capabilities to a portable core and local-first command interface that agents can use without an OpenSEO account, MCP server, browser UI, or always-on application server. Pi is the first development client, not the only intended user.

**Status:** product and technical design only. No working CLI has been shipped yet. The public name, license for original code, and repository visibility are not final.

- [Product and capability inventory](docs/PRODUCT.md)
- [Technical design](docs/DESIGN.md)
- [Execution plan and acceptance criteria](docs/PLAN.md)

A local invocation may still call paid external services, including DataForSEO. Google Search Console and Analytics require authorization. Remote execution is optional for long or unattended jobs, not a prerequisite for normal CLI use.

This project is an independent effort informed by [OpenSEO](https://github.com/every-app/open-seo). OpenSEO is MIT-licensed; when copying source, preserve its copyright and license notices. Before a public release, select a compatible license for original code and publish contribution and security guidance. The repository is private while the name and publication scope are being decided.
