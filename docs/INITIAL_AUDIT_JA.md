# Brickwright 日本語版 初期調査・設計メモ

調査日: 2026-11-03

対象: `NHtoyo/brickwright-jp`、および参照用の `CrispStrobe/extensions`
段階: 初期導入・現状調査。製品コードの修正、実機操作、ファームウェア更新は行っていない。

## 1. リポジトリ導入と作業ブランチ

- 空だった `NHtoyo/brickwright-jp` の `main` に、オリジナル `CrispStrobe/brickwright` の `develop` を履歴付きで導入した。
- 導入元の先端は `7d8cb378769e090a40e92acbaab2f43331e4ffc4`。`main`、`upstream/develop`、`origin/main` は同じコミットを指す。Git履歴は 15,598 コミット。
- `origin` は `https://github.com/NHtoyo/brickwright-jp.git`、`upstream` は `https://github.com/CrispStrobe/brickwright.git`。
- 作業ブランチ `work/initial-audit` を `main` から作成した。
- 既存の GPL-3.0 ライセンス、著作権表示、README、商標に関する注意事項は導入元の内容を維持した。
- 作業中にソースや依存ロックファイルを変更していない。この資料だけが調査成果物。

## 2. リポジトリ構造と依存関係

このリポジトリは TurboWarp `scratch-gui` を土台にした React/Redux の Scratch 3 エディターで、主な境界は次のとおり。

| 領域 | 主な場所 | 役割 |
|---|---|---|
| エディター UI | `src/components/`, `src/containers/`, `src/reducers/` | React の画面、ブロック編集、プロジェクト管理、設定 |
| Scratch VM・描画・保存 | npm の `scratch-vm`、Scratch/TurboWarp の renderer/storage 群 | ブロック実行、レンダリング、Scratch プロジェクト形式の入出力 |
| Brickwright のコード表示・変換 | `src/components/tw-pseudocode/`, `src/lib/sb3-creator*.js` | ブロック、疑似コード、Python、JavaScript 間の表示・変換 |
| 標準拡張 | `src/lib/libraries/extensions/` と各サブディレクトリ | Music、Pen、EV3、BOOST、WeDo 2.0、micro:bit 等の GUI 側登録 |
| 外部拡張ギャラリー | `src/containers/extension-library.jsx` | 起動後に JSON と JavaScript 拡張を外部 HTTPS から取得 |
| ビルドと同期 | `webpack.config.js`, `scripts/`, `.github/workflows/` | 静的 Web 版、配布用ライブラリ、別リポジトリ vendored code の同期 |

依存の中心は React、Redux、Scratch VM、Blockly、TurboWarp の各パッケージ、webpack 4、Jest、Selenium である。拡張ギャラリーのコードはアプリ本体に内包されず、起動後に取得する。したがって本体だけを fork しても、外部拡張の配布元 URL・拡張の信頼設定・ギャラリーの公開先は独立している。

Brickwright 固有の `sb3-creator` は別リポジトリのコードを複数ファイルとして `src/lib/` に vendoring し、`scripts/sync-sb3creator.mjs` と `sync:sb3creator:check` で同期する。Git の `upstream` 同期とは別の更新経路である。

## 3. ビルド、テスト、配布

### ビルドと実行

- `npm start` は webpack-dev-server を `http://localhost:8601` で起動する。
- `npm run build` は `build/` に Web 版を出力し、`dist/` にライブラリ版を生成する。
- ビルドチェーンは Node 22 を前提としているが、`.nvmrc` は `v24`、README と CI は Node 22 を指定しており食い違う。
- micro:bit ファームウェア取得処理を含む install script はネットワーク失敗しやすい。CI と README は install script を抑止し、`src/generated/microbit-hex-url.cjs` を空 URL で仮置きしている。この状態では通常ビルドを確認できるが、micro:bit ファームウェア書き込み経路は検証できない。

### 実施した確認

| 項目 | 結果 | 条件・制限 |
|---|---|---|
| `npm ci` | 失敗 | 現行 `package.json` と `package-lock.json` が一致せず、lock にない依存や Babel 系バージョン差が報告された。lock は変更していない。 |
| 依存導入 | 完了 | CI に合わせ `npm install --ignore-scripts --include=dev --legacy-peer-deps --package-lock=false` を使用。さらに既存 CI 手順と同じく `@babel/eslint-parser` を lock 無変更で追加した。 |
| `npm run test:lint` | 失敗 | ESLint 8 の `import/namespace` ルールが `Missing required argument: node` で停止。現在の CI でも lint は情報表示のみで非ゲート。 |
| `npm run test:unit` | 成功 | 1 suite、33 tests。スクリプトが `test/unit/addons` のみを対象にしている。 |
| `test/unit` 全体 | 失敗 | 通常スクリプトの範囲外を追加実行。45 suites 中16成功・29失敗、214 tests 中150成功・61失敗・3 skip。失敗には未解決 `scratch-render-fonts`、Jest 環境での `document` 不在、webpack loader alias の未設定、3 snapshot 差分が含まれる。依存構成・Jest 設定を整えて再評価が必要。 |
| `npm run build` | 成功 | Node 22、production webpack 4。`index.html`、`editor.html`、`player.html` 等を生成。webpack の大容量 asset/entrypoint 警告あり。上記 micro:bit URL 仮置きの条件付き。 |
| `npm run test:integration` | 完了確認できず | 初回は ChromeDriver 不在。Chrome 156.0.8078.74 に合う一時 ChromeDriver を別ディレクトリに置いて再実行したところ、現行 Chrome が `file://` からの font/manifest fetch を CORS 拒否し、エディターが初期化されず UI 待ちがタイムアウトした。原因を確認後に実行を中断したため、統合テスト全体の成功・件数は不明。 |
| smoke test | 未実施 | Sauce Labs の認証情報と公開先 URL を要する外部ブラウザーテスト。 |
| SPIKE 拡張の単体テスト | 成功 | オリジナル拡張リポジトリの `development/test-spikeprime-movement.js` を実行し 18/18 成功。VM 内の stub を使うテストであり、BLE transport・実機・Hub OS 1.6.62 の確認ではない。組み込み Python 構文チェックは `python3` がなく実行されなかった。 |

`test:unit` の範囲は package script 上で addons のみに絞られている。`test/unit` には GUI、プロジェクト保存、ロケール等のテストも存在するが、現在の標準コマンドでは実行されない。CI workflow は lint、production build、出力確認、上記の限定された unit test を実行する。Web Bluetooth、実機、SPIKE ファームウェア互換性は CI の対象外。

README はコード変換について built-in examples の round-trip 検証を CI で行うと説明している。一方、このリポジトリの現行 workflow からはその変換テストの起動を確認できず、別リポジトリ `sb3-creator` の CI や開発時テストとの境界も要整理である。README の説明を、この checkout の CI で再現済みの証拠とは扱わない。

統合テストの現在の失敗は、ブラウザー UI が起動してからの製品機能の合否を示していない。再実行する場合は `file://` 前提の Selenium helper をローカル HTTP 配信に合わせるか、Chrome の安全性を不用意に下げない形で CI と揃えたブラウザー条件を用意する。

### 配布経路

現在の GitHub Pages と Vercel の設定はオリジナルの `develop` をデプロイする前提で、オリジナルのドメインを参照している。将来一般公開する際は、NHtoyo 側で使うブランチ、公開ドメイン、CORS、拡張ギャラリー URL、信頼する拡張の URL を一緒に設計し、初期状態のまま公開しない。

## 4. 日本語対応の現状

- 本体は `@turbowarp/scratch-l10n` の locale を利用し、Brickwright/TurboWarp 追加文字列を `src/lib/tw-translations/generated-translations.json` からマージする。`ja` は選択可能な locale に含まれ、追加文字列も存在する。統合テストには `?locale=ja` の確認ケースがある。
- これは「日本語が全画面・全ブロックで完訳済み」という意味ではない。Transifex 設定 `.tx/config` は `translations/<lang>.json` を参照する一方、この checkout には翻訳元・言語別ファイル一式がない。Brickwright 固有 UI の網羅率・未翻訳 fallback・Scratch ブロック名とコード変換語彙の整合性は別途棚卸しが必要。
- オリジナル拡張の SPIKE Prime JavaScript に埋め込まれているブロック表示ラベルは `en`、`de`、`fr`。ギャラリーの name/description 翻訳メタデータと拡張内の block labels は別物であり、現状の SPIKE ブロック表示に日本語があるとは確認できない。
- したがって本体の日本語を正式対応として整える作業は残る。拡張 UI、接続モード、ハードウェアブロック、ヘルプ、エラー、コード変換、Web 公開後の初期言語を一体で確認する。

## 5. 拡張機能とハードウェアの境界

アプリ本体に登録される LEGO 系標準拡張は EV3、BOOST、WeDo 2.0。SPIKE Prime、NXT、Powered Up と EV3 の複数ドライバー/変換経路などは、外部 `CrispStrobe/extensions` のギャラリーからロードされる。README には本体側 117 拡張、拡張側 README には 27 拡張と記載されており、対象範囲・集計時点に不一致がある。公開メタデータと各コードを基準に再集計すべきである。

オリジナル拡張リポジトリのコード構成には、少なくとも以下の LEGO 実装ファイルがある。

| 系統 | オリジナル側実装例 | 調査時に確認できた自動テスト | 動作確認の判断 |
|---|---|---|---|
| EV3 | direct commands、LMS transpile、universal、ev3dev Python、bridge | direct commands の開発テストあり | コードとテストが存在することのみ確認。各センサー、モーター、接続路、brick firmware の実機試験は未確認。 |
| NXT | universal transpile | direct commands の開発テストあり | 同上。 |
| WeDo 2.0 | universal extension | connection と lights の開発テストあり | 同上。 |
| BOOST / Powered Up | universal extension、LWP3 | LWP3 の hub send テストあり | 同上。 |
| SPIKE Prime | 旧 BLE/BT/bridge と現行統合 transpile extension | movement の 18 テスト | 下記 6 節。物理通信・主要ブロック全体の確認は未実施。 |

拡張側の開発テストは extension-specific な Node script 群で、アプリ本体の Jest/CI とは分離している。テストの存在は全ブロックが正しいことや、特定ファームウェアの動作を証明しない。今後はハードウェア・接続方法・firmware・機能ブロックごとに「コードあり」「stub test 済み」「仮想デバイス確認」「実機確認」を分けたマトリクスを作る。

## 6. SPIKE Prime / Web Bluetooth の調査

### コード上の経路

参照した拡張ソースは `CrispStrobe/extensions` の `d8827ea07bd4f3f6c28a588d7b03942488363f24`。現行統合拡張には旧 2.x REPL 経路と SPIKE 3 binary protocol 経路がある。接続モード `web-ble` はコード上、後者の `spike3` protocol を選択する。

Web Bluetooth 実装は LEGO の FD02 GATT service、RX characteristic (hub 受信)、TX characteristic (hub 送信) を取得し、TX notifications を開始する。イベントから届く `DataView` は `buffer` 全体ではなく `byteOffset` と `byteLength` を保った `Uint8Array` にコピーされる。送信は RX characteristic に `writeValueWithoutResponse` があればそれを使用し、InfoResponse の packet size に従って分割し、write を直列化する。

接続イベントの後に `InfoRequest (0x00)` を送り、応答 `InfoResponse (0x01)` から firmware version と packet/chunk sizes を読み取る。応答時に `DeviceNotificationRequest (0x28)` を 100 ms 間隔で送る。応答がなければ 1 秒後にも通知要求を試みる。受信 parser は COBS + `0x02` delimiter の frame を組み立て、`DeviceNotification (0x3C)` 中の device records を解析する。IMU record `0x01` は 21 bytes を期待し、yaw/pitch/roll を little-endian int16 として読む。

LEGO の公開 SPIKE Prime protocol 文書はこの FD02 service/notification と handshake、InfoResponse の version/packet size、IMU record の layout を説明している ([接続と GATT](https://lego.github.io/spike-prime-docs/connect.html), [protocol messages](https://lego.github.io/spike-prime-docs/messages.html))。ただし公開文書や拡張の stub test は Hub OS 1.6.62 上でこの通知要求が受理されること、通知が定期到達することを証明しない。

### 角度がすべて 0 の症状

SPIKE3 parser の初期角度は pitch/roll/yaw のすべて 0 で、正常な IMU notification を解析したときだけ更新される。したがって「接続済み」と「firmware version が読めた」は GATT・InfoResponse の一部が動いた証拠だが、通知要求の応答、TX event の到達、frame COBS 復号、IMU record 解釈の成功までは示さない。受信通知がない／frame を復号できない／record length や layout が異なる場合にはゼロ表示が残り得る。

現行 Web BLE handler の `DataView` offset 処理には明白な欠落は見つからなかった。旧 `legospike_ble.js` には `new Uint8Array(value.buffer)` のみを使う実装があり、offset/length を無視するため、古い拡張 JS やキャッシュが配信されていないかも確認対象となる。ただし今回のユーザー環境でどの JS build が実行されたかは不明。

### 「write Hello」でハブ停止との報告

現行 `displayText` block は `scratch.display_text` の標準コマンドと、Python `import hub; hub.display.show("Hello")` を使う代替コマンドを用意する。実装では代替コマンドを `.catch()` の中で遅延生成せず、標準コマンドと同時に呼び出している。Web BLE は SPIKE3 protocol を選び、SPIKE3 の標準コマンド経路は未対応 method を reject するため、現行経路では代替 Python command が TunnelMessage (`0x32`) として送信される。2.x REPL 経路では両方の呼び出しが始まり、重複実行の可能性がある。

ソースだけから「write Hello」がハブ停止の原因だと断定できない。Hub OS 1.6.62 での TunnelMessage/Python API の受理・戻り・失敗時の挙動を実機確認していないため、安全とも互換とも判断しない。今回、Hub への接続、BLE read/write、テスト用コマンド送信、firmware update/flash は一切実施していない。

### 次段階で必要な安全な切り分け

1. 実機を使わない fake transport テストで、InfoResponse、通知要求、複数 BLE packet に分割された COBS frame、複数 frame、破損 frame、IMU record、古い/短い record を検証する。
2. `DataView` の byteOffset/byteLength と event lifecycle を fake Web Bluetooth characteristic で確認し、接続状態と「IMUデータ受信済み」を別状態として表示できるか設計する。
3. `displayText` の標準/代替コマンドを遅延 fallback にする設計をレビューし、fake transport でコマンド内容・回数を確認する。現状は実機送信しない。
4. Hub OS 1.6.62 の受動的な通知/InfoResponse capture が取得できる場合、その frame を匿名化して parser に再生する。比較前に実機への通知要求や任意コマンドは行わない。
5. mock とログ再生を通った後、ユーザー立会いの安全手順・事前バックアップ・停止時復旧策を決めてから最小の無害な読み取り確認を計画する。ファームウェア更新は対象外。

## 7. 拡張リポジトリ fork が未作成であること

指定の `NHtoyo/brickwright-jp-extensions` はこの作業時点で未作成として扱った。新規作成、空リポジトリ作成、ソースコピー、公開設定の変更は行っていない。参照用にオリジナル `CrispStrobe/extensions` を read-only で調査した。

別途必要な作業は次のとおり。

1. GitHub 上で拡張リポジトリをオリジナルから fork し、履歴・各ファイルの著作権・複数ライセンス・依存ライセンスを維持する。`origin` を NHtoyo fork、`upstream` を CrispStrobe/extensions にする。
2. 拡張側の GitHub Pages / metadata build / CI / domain と将来の公開先を決める。拡張配布先を本体の `extension-library.jsx` と `tw-security-manager.jsx` の両方で変更・レビューする。
3. ギャラリーの translation metadata、拡張 JavaScript 内のブロック翻訳、LEGO 商標表示、unsandboxed code の信頼境界を個別に監査する。
4. Web 公開前に本体・拡張それぞれで同期元、配布 tag、動作確認済み firmware/hardware を記録する。

## 8. 将来の同期と初回修正範囲案

### Git 同期

- `upstream/develop` を定期 fetch する。独自変更がなく fast-forward 可能な場合は、その履歴を保って更新できる。独自版の履歴が分岐している場合は `sync/upstream-*` などの更新ブランチで `upstream/develop` を取り込み、競合を解決して回帰テストを実行した後、PRを通じて `main` に反映する。常に fast-forward 可能とはみなさない。
- 独自作業は `work/*` などの短命 branch で行い、upstream からの更新を先に `main` に入れてから作業 branch に取り込む。履歴を squash して導入元の ancestry を切らない。
- vendored `sb3-creator`、画像/ランタイム資産、拡張ギャラリーは別同期元・別手順として記録し、Git upstream fetch だけで更新済みと扱わない。
- fork で release を始める前に、workflow の `develop` branch 条件を `main`/release branch に合わせ、NHtoyo の Pages/Vercel/domain へ向ける。

### 次の小さな作業候補

大規模リファクタや機能削除は行わず、まず次の二つを独立 PR にする案がある。

1. 開発再現性: Node version の不一致と lockfile/install の不一致を解消し、CI が意図するテスト範囲を明文化する。現行アプリ機能には触れない。
2. SPIKE 計測可能性: transport/parser に対する fake-device regression tests と、通知未受信をゼロ値と区別する診断設計を先に実装する。物理デバイスに任意の write command を送らない。

どちらを先に行うかは、次段階で優先度を決める。今回のブランチにはまだ実装修正を入れていない。
