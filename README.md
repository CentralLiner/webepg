# Web番組表（EPG）埋め込みモジュール

既存Webサイトに「テレビ番組表」を埋め込むクライアントサイドJSモジュールです。Bootstrap 5.3（ダークモード）に馴染むUIを提供し、GR/BS/CSタブと8日連続の縦スクロール表示に対応します。

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
| endpoints.programsUrl | string | 必須 | 番組一覧API（8日分一括） |
| days | number | 8 | 表示する日数 |
| initialTab | "GR" \| "BS" \| "CS" | "GR" | 初期タブ |
| includeServiceTypes | number[] | [1] | 表示対象のservice.type |
| timezone | string | "Asia/Tokyo" | 表示時刻のタイムゾーン |
| pxPerMinute | number | 2 | 1分あたりの高さ |
| nowLine | boolean | true | 現在時刻ラインを表示 |
| onProgramClick | function | null | 番組クリック時に呼び出されるコールバック |
| logoResolver | function | null | serviceからロゴURLを返す関数 |

### 3. API期待形式（概要）

- `servicesUrl`: サービス一覧（ロゴ・リモコン番号など）
- `channelsUrl`: 物理チャンネル束（GR/BSは1要素=1列の基準）
- `programsUrl`: 8日分番組リスト（`startAt`はUNIXミリ秒）

`programsUrl` は `relatedItems` の `type="shared"` を優先してサイマル判定し、無い場合は `(startAt, duration, name)` が一致する番組を同一扱いにします。

### 4. デモ

`demo/index.html` をブラウザで開くか、簡易HTTPサーバを起動して確認します。

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
