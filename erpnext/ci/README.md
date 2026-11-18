# CI snippets for Dev ERPNext cut-over

`deploy-development.yml` is the full Actions workflow that should replace
`.github/workflows/deploy-development.yml` on `development`.

PATs without the `workflow` scope cannot `git push` that path. To land it:

1. Open the feature branch on GitHub → Edit `.github/workflows/deploy-development.yml`
2. Paste contents of `erpnext/ci/deploy-development.yml`
3. Commit on the branch, then open/merge the PR into `development`

Or regenerate a classic PAT with `repo` + `workflow`, then:
`git add .github/workflows/deploy-development.yml && git commit && git push`
