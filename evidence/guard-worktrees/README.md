# Shell guard allows deletes inside the repository's worktrees: verification

- Branch: `fix/guard-worktrees`, from `main` at `f42339a`
- Checked: 2026-11-05, Node 24, git worktrees under the sibling `<repo>-worktrees/` folder
- Result: pass. Deletes inside this repository's worktrees are allowed; deletes in other projects, home, `/`, a whole worktree or the worktrees folder stay blocked. `scripts/worktree.sh check` works after a branch rename and explains its failures.

## Hook suite (`sh .cursor/hooks/test-hooks.sh`)

| State                                   | Result                                                 |
| --------------------------------------- | ------------------------------------------------------ |
| `main` hook code, new test file         | 104/108: the 4 new allow cases fail (denied), as filed |
| This branch                             | 108/108                                                |
| Formatting commit only (old test cases) | 99/99, so the Prettier commit changes no behavior      |

New cases, in a sandbox repository with one worktree in `repo-worktrees/` and one registered elsewhere:

| Command                                       | Runs from     | Expected | Actual |
| --------------------------------------------- | ------------- | -------- | ------ |
| `rm -f <repo>-worktrees/wt/tmp/scratch.txt`   | repository    | allow    | allow  |
| `rm -rf <registered worktree elsewhere>/dist` | repository    | allow    | allow  |
| `rm -rf tmp/scratch`                          | worktree      | allow    | allow  |
| `cd <repo>-worktrees/wt && rm -f notes.txt`   | repository    | allow    | allow  |
| `rm -rf <repo>-worktrees/wt` (whole worktree) | repository    | deny     | deny   |
| `rm -rf <repo>-worktrees` (worktrees folder)  | repository    | deny     | deny   |
| `rm -rf <other project>/src`                  | repository    | deny     | deny   |
| `rm -rf <other project>/src`                  | worktree      | deny     | deny   |
| `rm -f <repo>-worktrees/wt/x`                 | other project | deny     | deny   |

## Real checkout (17 registered worktrees)

"Before" is the `main` hook code, "After" this branch, both with the main checkout as the workspace root.

| Command                                | Runs from     | Before | After                                   |
| -------------------------------------- | ------------- | ------ | --------------------------------------- |
| `rm -f <own worktree>/tmp/scratch.txt` | main checkout | deny   | allow                                   |
| `rm -rf tmp/scratch`                   | own worktree  | deny   | allow                                   |
| `rm -rf <own worktree>`                | main checkout | deny   | deny (use `scripts/worktree.sh remove`) |
| `rm -rf <projects>/other-project/src`  | own worktree  | deny   | deny                                    |
| `rm -rf ~`                             | own worktree  | deny   | deny                                    |

A guard run that lists worktrees takes about 70 ms. Commands with no delete outside the workspace never call git.

## `scripts/worktree.sh check` (branch renamed from `agent/guard-worktrees` to `fix/guard-worktrees`)

"Before" is `main` `scripts/worktree.sh`, "After" this branch.

| Invocation                                    | Before                                        | After                                                   |
| --------------------------------------------- | --------------------------------------------- | ------------------------------------------------------- |
| `check guard-worktrees` (worktree name)       | exit 1, "no branch ... or agent/..."          | checks `fix/guard-worktrees`, exit 0                    |
| `check fix/guard-worktrees` (branch name)     | exit 128, no message                          | checks the branch, exit 0                               |
| `check fix/guard-worktrees '.cursor/hooks/*'` | lists the file, then exit 128 with no summary | "out of scope: scripts/worktree.sh" and summary, exit 1 |
| `check no-such-thing`                         | exit 1                                        | "no worktree ... and no branch ...", exit 1             |
| `check guard-worktrees --base no-such-ref`    | exit 128, git error only                      | "no merge base ...; pass --base <ref>", exit 1          |
| `check <worktree on a detached HEAD>`         | exit 1, "no branch ..."                       | "... is not on a branch; pass the branch name", exit 1  |

## Gates

- `sh scripts/validate-harness.sh`: OK (structure, shellcheck, hook tests 108/108, visual self-test 22/22, secret scan clean).
- `scripts/gate.sh static`: PASS (secrets, lint, styles, satori, typecheck, build, openapi, db).
- `functional` and `visual` not run: harness-only change with no app code, and other agents' stacks were running on this machine.
