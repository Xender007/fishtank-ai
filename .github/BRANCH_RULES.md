# Changes to master

Push changes to a feature branch and open a pull request into `master`.

- Pull requests require approval from the code owner, `@Xender007`, unless the
  owner explicitly uses the pull-request-only bypass described below.
- New reviewable commits dismiss previous approvals. The latest push must be
  approved by someone other than the person who pushed it.
- Review conversations must be resolved before merging.
- Direct pushes, force pushes, and deletion of `master` are blocked.
- Only `@Xender007` can bypass the ruleset, and only when merging a pull request.
  The bypass does not allow direct pushes, force pushes, or branch deletion.

GitHub does not allow a pull request author to approve their own pull request.
When the owner opens a pull request, GitHub will not list them as a reviewer.
The owner can use the bypass option in GitHub's merge controls to merge their own
pull request without self-approval. This bypass applies to the whole ruleset for
pull-request merges, so it can also override review requirements on other pull
requests. It does not automatically approve or merge anything.

For ready-for-review pull requests opened by other contributors, `CODEOWNERS`
automatically requests the owner's review. Other contributors have no bypass.

Manage the enforced rules in
[GitHub Settings → Rules → Rulesets](https://github.com/Xender007/fishtank-ai/settings/rules).
This is a personal-account repository; the owner controls its administrative
settings. This policy does not add collaborators or grant administrative access.

`master-ruleset.json` is a reviewable copy of the intended GitHub ruleset.
Editing that file alone does not update GitHub settings. `CODEOWNERS` determines
the required owner and also protects changes to the ownership file itself.

These are server-side protections. They reject changes pushed directly to
GitHub's `master`; they do not prevent making commits in a local checkout.
