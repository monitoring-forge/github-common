# monitoring-forge-github-common

このリポジトリは、 monitoring-forge 組織で管理している GitHub リポジトリの共通設定や同期対象をまとめたものです。

## 対象ファイル

- .github/workflows/pr-agent.yml
- .github/workflows/dependabot-auto-merge.yml
- .github/dependabot.yml
- .golangci.yml


## Songmu/tagpr 更新の自動マージ

`.github/workflows/dependabot-auto-merge.yml` を各リポジトリに同期します。
Dependabot の GitHub Actions 更新では `Songmu/tagpr` を専用の `tagpr` グループに分離し、
他の依存関係を含む PR は自動マージしません。既存の `dependencies` グループの PR でも、
実際の差分が tagpr の参照更新だけなら対象になります。メジャー更新も対象です。

次の条件をすべて満たす場合、テスト完了後にマージします。

- PR の作成者が `dependabot[bot]` で、同じリポジトリのブランチからデフォルトブランチへの PR である。
- `.github/workflows/test.yml` または `.github/workflows/ci.yml` の `test` / `Tests` / `CI` が成功した。
- 成功した実行が PR の最新コミットに対応し、再実行や新しい実行で置き換えられていない。
- 変更ファイルは既存の `.github/workflows/*.yml` / `*.yaml` のみで、変更内容は `uses: Songmu/tagpr@...` の参照と同行のコメントのみである。

`workflow_run` でテスト終了後に起動し、PR のコード・成果物・キャッシュは実行しません。
GitHub API にマージ対象のコミット SHA を渡し、判定後に追加されたコミットのマージを防ぎます。
App をブランチ保護・ruleset の bypass 対象に追加する必要はありません。既存の保護を維持してください。保護設定などでマージが拒否された場合は
Actions の実行が失敗します。条件を解消した後、対象 PR のテストを再実行してください。
GitHub の「Allow auto-merge」設定には依存しません。

### 導入

事前に、既存 GitHub App を全対象リポジトリへインストールし、Actions Secrets の
`CLIENT_ID` と `APP_PRIVATE_KEY` を各リポジトリから利用可能にしてください。
Organization Secrets の場合は対象リポジトリへの公開範囲も確認してください。
App は Contents / Pull requests の読み書き権限を使用します。Issues の権限は不要です。
Actions の読み取りは標準の `GITHUB_TOKEN` で行うため、App への追加権限は不要です。

1. この変更を `main` にマージし、通常の tagpr リリースを行います。
2. リリース時の既存のファイル同期により、36リポジトリに同期 PR が作成されます。
3. 各同期 PR をマージすると有効になります。`github-common` 自身はこの変更のマージで有効になります。
4. すでにテストが終了している Dependabot PR は、導入後にテストを再実行すると判定されます。

テストが存在しない、または成功しない場合は自動マージされません。
テストと差分の確認には読み取り専用の `GITHUB_TOKEN` を使い、対象が見つかった場合のみ、
現在のリポジトリに限定した GitHub App トークンを発行してマージします。
そのため、マージ後の `push` を起点とするテスト・tagpr も起動します。
tagpr 側のトークン設定は変更しません。Secrets が未設定の場合はマージせず失敗します。
他の必須チェックがテストより遅れて終了する場合も、完了後にテストを再実行してください。

### 検証

`github-common` で `node --test tests/*.test.cjs` を実行します。
実際に同期するワークフロー内のスクリプトを、GitHub API の応答を模擬して検証します。
この検証用の `test.yml` と `tests/` は他のリポジトリには同期しません。
