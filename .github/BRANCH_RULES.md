# Branches and pull requests

```
feature branch  --PR-->  develop  --PR (release)-->  master
```

- **All work targets `develop`.** Push a feature branch and open the pull request
  into `develop`. `develop` is the repository's default branch, so new pull
  requests target it automatically.
- **`master` only accepts pull requests from `develop`.** The workflow
  `.github/workflows/pr-source.yml` runs on every pull request into `master` and
  fails unless the source is this repository's `develop` branch. The `master`
  ruleset requires that check ("master accepts develop only"), so a pull request
  from any other branch cannot be merged into `master`. Retarget it to `develop`.

## Protection on both `develop` and `master`

- Changes arrive only through pull requests. Direct pushes, force pushes and
  branch deletion are blocked.
- Pull requests require approval from the code owner, `@Xender007`. New commits
  dismiss earlier approvals, the latest push must be approved by someone other
  than its pusher, and review conversations must be resolved.

## The owner bypass

Only `@Xender007` can bypass the rulesets, and only when merging a pull request.
The bypass does not allow direct pushes, force pushes or branch deletion.

GitHub does not let a pull request's author approve it, and the owner is the only
code owner, so the owner uses the bypass option in GitHub's merge controls to
merge their own pull requests. The bypass covers the whole ruleset for that merge,
including the "master accepts develop only" check, so it is a deliberate choice
each time, never automatic. Other contributors have no bypass: `CODEOWNERS`
requests the owner's review on their pull requests.

## Where the real settings live

`master-ruleset.json` and `develop-ruleset.json` are reviewable copies of the
GitHub rulesets. Editing them does not change GitHub. Apply them in
[Settings → Rules → Rulesets](https://github.com/Xender007/fishtank-ai/settings/rules)
("New ruleset → Import a ruleset" accepts these files). The default branch is set
in Settings → General. This is a personal-account repository; the owner controls
its administrative settings.

These are server-side protections. They reject changes pushed to GitHub; they do
not prevent commits in a local checkout.
