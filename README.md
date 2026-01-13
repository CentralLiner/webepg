# Web番組表（EPG）埋め込みモジュール

既存Webサイトに「テレビ番組表」を埋め込むクライアントサイドJSモジュールです。Bootstrap 5.3（ダークモード）に馴染むUIを提供し、GR/BS/CSタブと前日を含む連続縦スクロール表示に対応します。

## 使い方

### 1. HTMLに配置

```html
<div id="epg-root"></div>
<link rel="stylesheet" href="/assets/epg-widget.css">
<script src="/assets/epg-widget.js"></script>
<script>
  EPGWidget.mount("#epg-root", {
    endpoints: {
      servicesUrl: "https://example.com/api/services",
      channelsUrl: "https://example.com/api/channels",
      programsUrl: "https://example.com/api/programs"
    }
  });
</script>
```

### 2. 設定項目

| 項目 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| endpoints.servicesUrl | string | 必須 | サービス一覧API |
| endpoints.channelsUrl | string | 必須 | チャンネル束API |
| endpoints.programsUrl | string | 必須 | 番組一覧API（service/期間指定クエリ対応） |
| programsFetchMode | "range" \| "bulk" | "range" | 番組取得方式（"range"は期間クエリで逐次取得、"bulk"は全件一括） |
| days | number | 8 | 今日から先の表示日数 |
| daysBefore | number | 1 | 今日より前に表示する日数（前日は表示されますが日付リンクは追加しません） |
| initialTab | "GR" \| "BS" \| "CS" | "GR" | 初期タブ |
| includeServiceTypes | number[] | [1] | 表示対象のservice.type |
| timezone | string | "Asia/Tokyo" | 表示時刻のタイムゾーン |
| pxPerMinute | number | 4 | 1分あたりの高さ |
| channelWidth | number \| string | 160 | 通常チャンネル列の幅（数値はpx） |
| channelMinWidth | number \| string | 144 | 通常チャンネル列の最小幅（数値はpx） |
| multiServiceWidth | number \| string | 192 | 複数serviceを含む列のうち、同時刻に別番組がある場合（マルチ編成）の列幅（数値はpx） |
| multiServiceMinWidth | number \| string | 176 | 複数serviceを含む列のうち、同時刻に別番組がある場合（マルチ編成）の最小幅（数値はpx） |
| nowLine | boolean | true | 現在時刻ラインを表示 |
| onProgramClick | function | null | 番組クリック時に呼び出されるコールバック |
| logoResolver | function | null | serviceからロゴURLを返す関数（未指定時はhasLogoDataがtrueのときに https://celive.cela.me/static/logo/<networkId>_<logoId>.png を使用） |
| sources | array | null | 複数APIセットを指定する場合に使用（`endpoints`の代替） |
| tabs | array | null | タブの定義（フィルター条件付きで追加可能） |

`channelWidth` / `channelMinWidth` / `multiServiceWidth` / `multiServiceMinWidth` は数値指定でpx、文字列指定でCSSの長さ指定（例: `"12rem"`）が使えます。`channelMinWidth` と `multiServiceMinWidth` を省略した場合はそれぞれ `channelWidth` / `multiServiceWidth` と同じ値が使われます。
マルチ編成の判定は、同一列で同時刻に別番組があるかどうかを各日付セクション描画時に確認して反映します。

### 2.1 複数API / カスタムタブの例

```html
<script>
  EPGWidget.mount("#epg-root", {
    sources: [
      {
        id: "main",
        label: "本編",
        endpoints: {
          servicesUrl: "https://example.com/api/services",
          channelsUrl: "https://example.com/api/channels",
          programsUrl: "https://example.com/api/programs",
        },
      },
      {
        id: "sub",
        label: "別データ",
        endpoints: {
          servicesUrl: "https://example.com/api2/services",
          channelsUrl: "https://example.com/api2/channels",
          programsUrl: "https://example.com/api2/programs",
        },
      },
    ],
    tabs: [
      { id: "GR", label: "GR", sourceId: "main", channelTypes: ["GR"], mode: "grouped" },
      { id: "BS", label: "BS", sourceId: "main", channelTypes: ["BS"], mode: "grouped" },
      { id: "CS", label: "CS", sourceId: "main", channelTypes: ["CS"], mode: "service" },
      {
        id: "MAIN-ALL",
        label: "本編まとめ",
        sourceId: "main",
        channelFilter: (channel) => ["GR", "BS"].includes(channel.type),
        mode: "grouped",
      },
      {
        id: "SUB-CS",
        label: "別データCS",
        sourceId: "sub",
        channelTypes: ["CS"],
        mode: "service",
      },
    ],
  });
</script>
```

`tabs` を省略すると、各ソースごとに `GR/BS/CS` のデフォルトタブを生成します（単一ソースの場合は従来どおり `GR/BS/CS` を利用）。

`tabs` の主な項目は以下のとおりです。

- `id`: タブID（`initialTab` と合わせる）
- `label`: 表示ラベル
- `sourceId`: `sources` のID
- `channelTypes`: `channel.type` の条件配列（省略時は全件）
- `channelFilter`: `channel` を受け取るフィルター関数（`channelTypes` より優先）
- `serviceFilter`: `service` を受け取るフィルター関数
- `mode`: `"grouped"`（GR/BS統合列）または `"service"`（サービス単位）

### 3. API期待形式（概要）

- `servicesUrl`: サービス一覧（ロゴ・リモコン番号など）
- `channelsUrl`: 物理チャンネル束（GR/BSは1要素=1列の基準）
- `programsUrl`: 番組リスト（`startAt`はUNIXミリ秒）

`programsFetchMode: "range"` の場合、以下のクエリでサービス・日付ごとに取得します（`since`/`until` は `startAt` を含む範囲、UNIXミリ秒）。

```
programsUrl?network_id=<networkId>&service_id=<serviceId>&since=<since>&until=<until>
```

`programsFetchMode: "bulk"` を指定した場合は、`programsUrl` が表示範囲（`daysBefore + days` 日分）を返す前提で動作します。

`programsUrl` は `relatedItems` の `type="shared"` を優先してサイマル判定し、無い場合は `(startAt, duration, name)` が一致する番組を同一扱いにします。

### 4. デモ

`demo/index.html` は `fetch` でサンプルJSONを取得するため、簡易HTTPサーバを起動して確認します。

```bash
python -m http.server 8000
```

その後 `http://localhost:8000/demo/` にアクセスしてください。

## 既知の制限

- タブ切り替え時はスクロール位置の維持を試みますが、ブラウザ環境によっては再描画時に若干ずれる場合があります。
- timezone指定は `Intl.DateTimeFormat` を利用します。ブラウザが指定タイムゾーンをサポートしない場合はローカル時刻にフォールバックします。
- 番組の跨日表示は「開始日のセクションに属する」仕様のため、日付境界を跨ぐ番組は次日のセクションには重複表示しません。

## 配布物

- `dist/epg-widget.js`
- `dist/epg-widget.css`
- `demo/index.html`
