---
name: verify-ui
description: Slash command /verify-ui [screens] [--out dir] - one capture-and-inspect pass (desktop/tablet/mobile, light/dark) with console, network, overflow, interpolation and layout-shift checks and design parity for BudgetFlow screens. No fixing loop; use /visual-qa for that.
disable-model-invocation: true
---

# /verify-ui

Verify the screens named after `/verify-ui` (default: every screen changed on this branch, from `git diff --name-only main...HEAD`) by following the `ux-verify` skill (`.cursor/skills/ux-verify/SKILL.md`).

- Output folder: the `--out` value if given, else `evidence/<branch-name>/verify-ui`.
- Capture every meaningful state of each screen with the role that sees it, not only its default view.
- Report with embedded screenshots, blocking findings, design-parity notes and open UX questions. To fix what it finds, run `/visual-qa`.
