# seo-local

Local-first, headless SEO tools for AI agents. The goal is to bring OpenSEO's SEO capabilities to a CLI that an agent such as Pi can run without an OpenSEO account, MCP server, browser UI, or always-on application server.

**Status:** product and technical design only. No working CLI has been shipped yet.

- [Product and capability inventory](docs/PRODUCT.md)
- [Technical design](docs/DESIGN.md)
- [Execution plan and acceptance criteria](docs/PLAN.md)

A local invocation may still call paid external services, including DataForSEO. Google Search Console and Analytics require authorization. Remote execution is optional for long or unattended jobs, not a prerequisite for normal CLI use.

This project is an independent effort informed by [OpenSEO](https://github.com/every-app/open-seo). OpenSEO is MIT-licensed; when copying source, preserve its copyright and license notices. A license for original code in this repository has not been selected yet.
