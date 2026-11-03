# ローカル拡張機能を使う開発手順

この手順は Windows 開発環境用です。通常の配布 URL は CrispStrobe のままです。NHtoyo 側の一覧切り替えは `NODE_ENV=development` のときだけ表示されます。

## 起動

両リポジトリの `node_modules` がある場合は再インストールせず、そのまま使います。未作成のチェックアウトでは各リポジトリ内で一度 `npm ci` を実行します。

1. PowerShell を開き、拡張機能リポジトリで開発サーバーを起動します。

   ```powershell
   Set-Location D:\Cordex_Projects\brickwright-jp-extensions
   npm start
   ```

   サーバーは `http://localhost:8000/` で拡張機能を配信します。

2. 別の PowerShell で本体を起動します。

   ```powershell
   Set-Location D:\Cordex_Projects\brickwright-jp
   npm start
   ```

3. ブラウザーで `http://localhost:8601/editor.html` を開きます。
4. 拡張機能ギャラリーを開き、読み込み元で `NHtoyo開発版 (localhost:8000)` を選択します。元の `CrispStrobe公式` ギャラリーにもいつでも切り替えられます。
5. 名前に `NHtoyo開発版` が付いた SPIKE Prime カードを選びます。現在の開発ビルドIDと読み込み済み実装は、ギャラリー上部に表示されます。

## 実装の切り替えとキャッシュ

拡張機能一覧の選択はこのブラウザーの `localStorage` に保存されます。開発版のメタデータはキャッシュせず取得し、スクリプトURLにはページごとの `bwDevBuild` 識別子を付けます。拡張機能開発サーバーも `no-store` を返します。

Scratch VM は同じ拡張IDを現在のセッション内で別URLから置き換えられません。CrispStrobe版などが既に読み込み済みの場合は、実装元・スクリプトパス・開発ビルドIDを示す案内が出ます。選択を切り替えてからエディター全体を再読み込みしてください。ソース変更後に同じタブで読み込み済みの場合も、エディターを再読み込みして新しいビルドIDを確認します。

ローカルで信頼なしに読み込む対象は、開発モードの `http://localhost:8000/CrispStrobe/legospike_turbowarp_transpile.js` に限定しています。その他のローカル拡張機能は既存のセキュリティ確認を通ります。

## 停止

各 PowerShell で `Ctrl+C` を押して拡張機能サーバーと本体を停止します。この開発手順だけではハブに接続しません。SPIKE Prime の実機確認は、拡張機能リポジトリの `development/SPIKEPRIME_HARDWARE_VERIFICATION_JA.md` に従って別途行います。
