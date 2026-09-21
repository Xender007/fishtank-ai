# Changes to master

Push changes to a feature branch and open a pull request into `master`.

- Every pull request requires approval from the code owner, `@Xender007`.
- New reviewable commits dismiss previous approvals. The latest push must be
  approved by someone other than the person who pushed it.
- Review conversations must be resolved before merging.
- Direct pushes, force pushes, and deletion of `master` are blocked.
- The ruleset has no bypass actors, including the repository owner.

GitHub does not allow a pull request author to approve their own pull request.
Because the owner is the only code owner, owner-authored pull requests cannot
satisfy owner review under this policy. The owner must explicitly change the
rules in GitHub Settings before making an exception, then restore protection.

Manage the enforced rules in
[GitHub Settings → Rules → Rulesets](https://github.com/Xender007/fishtank-ai/settings/rules).
This is a personal-account repository; the owner controls its administrative
settings. This policy does not add collaborators or grant administrative access.

`master-ruleset.json` is a reviewable copy of the intended GitHub ruleset.
Editing that file alone does not update GitHub settings. `CODEOWNERS` determines
the required owner and also protects changes to the ownership file itself.

These are server-side protections. They reject changes pushed directly to
GitHub's `master`; they do not prevent making commits in a local checkout.
