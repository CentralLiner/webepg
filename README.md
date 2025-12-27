# Web番組表（EPG）埋め込みモジュール

既存Webサイトにテレビ番組表を埋め込むためのクライアントサイドJSモジュールです。
Bootstrap 5.3（ダークモード）に馴染むデザインで、GR/BS/CS切替・8日分連続表示・遅延レンダリングに対応しています。

## 使い方

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

## 設定項目

| 項目 | 型 | 既定値 | 説明 |
| --- | --- | --- | --- |
| endpoints.servicesUrl | string | 必須 | サービス一覧API |
| endpoints.channelsUrl | string | 必須 | チャンネル束API |
| endpoints.programsUrl | string | 必須 | 番組一覧API（8日分） |
| days | number | 8 | 表示する日数 |
| initialTab | "GR"\|"BS"\|"CS" | "GR" | 初期タブ |
| includeServiceTypes | number[] | [1] | 表示対象の service.type |
| timezone | string | "Asia/Tokyo" | 日付・時間のタイムゾーン |
| pxPerMinute | number | 1.2 | 1分あたりの高さ（px） |
| onProgramClick | function | null | 番組クリック時コールバック |
| logoResolver | function | null | サービス情報からロゴURLを返す関数 |
| nowLine | boolean | true | 現在時刻ライン表示 |

## APIレスポンス形式（期待値）

### servicesUrl
`serviceId`, `name`, `type`, `remoteControlKeyId`, `channel.type` などを含む配列。

### channelsUrl
`type`（GR/BS/CS）、`name`、`services`（serviceId を含む配列）を持つ配列。

### programsUrl
`serviceId`, `startAt`（UNIX ms）, `duration`（ms）, `name`, `description`, `relatedItems` を含む配列。

- `relatedItems.type === "shared"` を優先的にサイマル判定へ利用します。
- `relatedItems` が不足する場合は `(startAt, duration, name)` が一致する番組を共通扱いにします。

## デモ

`demo/index.html` をブラウザで開きます。`api-sample` を参照するため、ローカルサーバーで配信してください。

```bash
python -m http.server 8000
```

## 既知の制限

- GR/BSのサブチャンネル統合は、`startAt` と `duration` が一致する時間枠で横分割します。異なる開始時刻が重なるケースは単純化しています。
- タイムゾーンの境界計算はブラウザの `Intl` に依存しています。実装環境によっては日付境界がずれる可能性があります。
- BootstrapのJSは前提にせず、番組詳細は簡易モーダルで表示します。

## 開発メモ

- 遅延レンダリング: 日付セクションが近づいたタイミングで DOM を生成します（IntersectionObserver）。
- タブ切替時はスクロール位置を保存・復元します。
