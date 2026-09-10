# Project working agreement

## Core product value

For every change, make the experience easy to use, intuitive to use, desirable to use, and faster than paper or other online services.

- Remove calculation and translation work from the user whenever the product can do it reliably.
- Put explanations and recovery paths at the point where they are needed.
- Preserve user intent across saving, reopening, offline use, and role-specific views.
- Fix the underlying rule or workflow so an entire class of errors disappears; do not stop at a one-off symptom patch.
- QA the complete affected workflow, including valid use, invalid use, persistence, permissions, regressions, and the deployed experience.

## Production deployment safety

The Netlify site at `pipsprojects.com` is Git-connected. Prefer deploying by pushing a reviewed commit to `main`; do not run a manual `netlify deploy` unless the task specifically requires one.

Before every production deployment:

1. Run `git fetch origin` and `git pull --ff-only origin main` in `D:\CODEX\pipsprojects`.
2. If the pull cannot fast-forward because of local work, commit and push it first or rebase it onto the current `origin/main`. Never deploy a working copy that is behind `origin/main`.

After every production deployment, verify the shared homepage was not rolled back:

```sh
curl -s -L https://pipsprojects.com/ | grep -c battlemapdb
```

The result must be `1`. If it is `0`, stop, update from `origin/main`, and restore through the Git-connected build before considering the deployment complete.
