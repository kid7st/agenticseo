# AgenticSEO

Open-source, local-first SEO for agents. AgenticSEO aims to bring OpenSEO's SEO capabilities to a portable core, local commands, and agent skills, without requiring an OpenSEO account, MCP server, browser UI, or always-on application server. Pi is the first development client, not the only intended user.

**Status:** product and technical design only. No working CLI has been shipped yet.

- [Product and capability inventory](docs/PRODUCT.md)
- [Technical design](docs/DESIGN.md)
- [Execution plan and acceptance criteria](docs/PLAN.md)

A local invocation may still call paid external services, including DataForSEO. Google Search Console and Analytics require authorization. Remote execution is optional for long or unattended jobs, not a prerequisite for normal CLI use.

## Origin and license

AgenticSEO is an independent project based on the product and source design of [OpenSEO](https://github.com/every-app/open-seo). It is not an official OpenSEO release or affiliated with its maintainers. OpenSEO is MIT-licensed; source ported from OpenSEO must retain its original copyright and license notices. New code in this repository is licensed under [MIT](LICENSE). The names AgenticSEO and OpenSEO refer to separate projects.
