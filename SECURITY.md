# Security policy

## Reporting a vulnerability

Report vulnerabilities privately via
[GitHub Security Advisories](https://github.com/jwhenry3/atolljs/security/advisories/new).
Please do not open a public issue for a security bug.

Include the affected package (`@atolljs/*`) and version, a description of
the impact, and reproduction steps if available. You can expect an initial
response within a few days.

## Supported versions

Only the latest published minor line receives security fixes.

## Supply-chain controls

This repository pins down the npm supply chain in a few places — keep them
intact when touching install/release infrastructure:

- Every installable project directory (repo root, `docs-consumer/`, each
  `examples/*`) carries an `.npmrc` with `min-release-age=7` (newly
  published versions must age a week before they can enter a lockfile),
  `ignore-scripts=true` (no install lifecycle scripts run — see below for
  the escape hatch), and `save-exact=true` (new deps pin exactly).
- GitHub Actions are pinned to commit SHAs, not mutable major tags.
  Dependabot (`.github/dependabot.yml`) bumps the SHAs on a weekly
  cadence with a matching 7-day cooldown.
- Publishing is stage-only over npm trusted publishing (OIDC): no stored
  npm token is required, and staged packages need a maintainer's 2FA
  approval on npmjs.com before they become installable. See
  `.github/workflows/publish.yml`.
- CI audits every lockfile with `npm audit --audit-level=high`.

`min-release-age` requires npm ≥ 11.10 (bundled with Node 26). Older npm
versions ignore the setting silently — run the repo on Node 26+.

If a native dependency legitimately needs its install script (e.g. a
prebuilt binary not shipped via `optionalDependencies`), rebuild it
explicitly rather than disabling the policy globally:

```bash
npm rebuild <pkg> --ignore-scripts=false
```
