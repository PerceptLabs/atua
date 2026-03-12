## Git Workflow — Snapshots

When I say "push", "snapshot", or "checkpoint":

1. `git add -A`
2. `git commit -m "Snapshot: <description>"` — use context from recent work
3. Create snapshot branch using **today's actual date**:
   ```bash
   git branch "snapshot-$(date +%Y-%m-%d)-<short-description>"
   ```
4. Push it:
   ```bash
   git push origin "snapshot-$(date +%Y-%m-%d)-<short-description>"
   ```
5. **Stay on current branch** — do NOT checkout the snapshot
6. Tell me: what was committed, the snapshot branch name, and confirm I'm still on my working branch

These are frozen checkpoints. Never switch to them. Keep working on main.

**Always use `$(date +%Y-%m-%d)` for the date. Never hardcode a date.**
**Use kebab-case for short descriptions** (e.g., `shell-improvements`, not `shell improvements`).

**Example** — if I say "push - shell stuff done":
- Commit: `Snapshot: shell improvements complete`
- Branch: `snapshot-<TODAY>-shell-improvements`
- Push it
- Stay on main
