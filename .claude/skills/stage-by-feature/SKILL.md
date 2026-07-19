---
name: stage-by-feature
description: Commit ONE feature's hunks out of a working tree that mixes several features (parallel seats editing concurrently) — including splitting a single file's hunks between commits. Use whenever git status shows work from more than one author/feature and you must not bundle foreign hunks into your commit.
---

# Stage by feature — clean commits from a mixed tree

Parallel seats mean the working tree routinely holds several features at
once. A commit must tell ONE story; foreign hunks riding along is how a
tooltip fix ends up bundled with someone's half-built script tag.

## 1. Map ownership before staging anything

```bash
git status --short
git diff <file> | grep -E "^[+-][^+-]" | head   # per suspect file: whose change is this?
```

Anything you can't attribute: read the hunk. A drill/test file appearing
alongside a feature usually belongs to that feature.

## 2. Whole files that are all-one-feature: plain `git add <files>`

## 3. A file that MIXES features: split its hunks via a filtered patch

`git add -p` is interactive (not available to seats). The scriptable
equivalent:

```bash
git diff -U1 <file> > /tmp/f.patch
python - <<'EOF'
import re
body = open('/tmp/f.patch', encoding='utf8').read()
head, rest = body.split('@@', 1)
hunks = re.split(r'(?m)^(?=@@)', '@@' + rest)
keep = [h for h in hunks if 'MARKER' in h]   # a string unique to YOUR feature's hunks
open('/tmp/f-keep.patch', 'w', encoding='utf8', newline='').write(head + ''.join(keep))
print(len(keep), 'of', len(hunks), 'hunks kept')
EOF
git apply --cached /tmp/f-keep.patch
```

- `-U1` keeps hunks small so features don't merge into one hunk.
- Verify the split before committing:
  `git diff --cached <file>` (what ships) vs `git diff <file>` (what stays).
  Count a marker string on both sides: your marker in cached only, the
  foreign feature's marker in unstaged only.

## 4. Committing foreign work (when asked to "push it all")

Commit it SEPARATELY with an honest message — say it was built by a parallel
session and committed as-left, and confirm its drills pass in the full suite
before pushing. Never fold foreign hunks into your feature's commit.

## 5. Traps

- `git checkout upstream/<branch> -- <path>` STAGES what it brings in — a
  later broad `git commit` sweeps it into whatever you commit next. After a
  subtree checkout, commit that work first or `git reset` before staging
  your own groups. (This exact trap forced a 3-commit redo on 2026-07-19.)
- Windows/git-bash: python can't open `/tmp/...` paths — use a real Windows
  path for the patch files.
- Nothing pushed is nothing lost: a mis-grouped local commit is fixed with
  `git reset --soft HEAD~N` and a redo, never force-push after pushing.
