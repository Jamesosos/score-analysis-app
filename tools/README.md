# tools/ — 示範資料的產生與驗證腳本

這些是**開發時用的 Python 腳本**，跟 App 本身無關。App 是純前端，不需要 Python。
刪掉整個 `tools/` 也不影響程式運作。

需要 Python 3.9+，以及 `openpyxl`、`Pillow`、`XlsxWriter`。

所有路徑都是**相對於這個檔案的位置**解析，所以從任何工作目錄執行都可以。

---

## 會寫入檔案的腳本（執行前請注意）

| 腳本 | 做什麼 | 副作用 |
|---|---|---|
| `gen_data.py` | 產生 `demo-data/` 的 54 個示範 Excel 與 `manifest.json` | ⚠️ **會覆寫 demo-data/** |
| `gen_icons.py` | 產生 `icons/` 的三個 PWA 圖示 | ⚠️ **會覆寫 icons/** |

```bash
python tools/gen_data.py     # 重新產生示範資料
python tools/gen_icons.py    # 重新產生圖示
```

兩支都有固定亂數種子，所以重跑會得到相同的資料內容。
（但 `.xlsx` 是 ZIP，內部時間戳可能不同，所以檔案雜湊不保證一致。）

---

## 唯讀的驗證腳本（安全，可隨時執行）

| 腳本 | 檢查什麼 |
|---|---|
| `verify_data.py` | 逐檔逐欄位驗證：人數、缺考、0 分、操行分佈、總分＝各科加總、名次為並列競賽排名、`manifest.json` 與磁碟上的檔案完全一致 |
| `verify_cohort.py` | 跨學年同一批學生是否延續（升級後學號、姓名一致），以及同一個年級的三個班是否為互斥的學生群 |
| `verify_ids.py` | 學號編碼規則（`學年3碼 + 班號字母 + 座號3碼`），以及同一學年內學號不重複 |
| `verify_icons.py` | 圖示的尺寸、色彩模式、圓角外是否透明、漸層取樣 |
| `stats_data.py` | 分數統計：各科平均／標準差、能力值相關性、前 5 名與後 5 名的對比 |

```bash
python tools/verify_data.py
```

---

## 歷史探索腳本（會印出 "problems: N"，但那**不是**失敗）

這兩支是當初在推導示範資料版面時寫的探索工具，它們印出的數字是**分析發現**，不是測試失敗：

| 腳本 | 輸出 | 為什麼看起來像失敗 |
|---|---|---|
| `analyze_cohorts.py` | `0/9 cells can hold three different cohorts` | 它要求「同一個年級的三個班各由不同入學班群組成」。實際上一個年級的三個班是**同一個入學班群拆出來的平行班**，所以永遠是 0/9。這是設計事實，不是錯誤。 |
| `solve_layout.py` | `problems: 9` | 同樣的緣故：它把「一個年級只有一個入學班群」列為問題。最後採用的版面正是這樣，所以那 9 筆是已知且預期的。 |

如果你在 CI 或別的地方看到這兩個數字，**不要當成測試失敗**。
真正代表性質的驗證是 `verify_data.py`、`verify_cohort.py`、`verify_ids.py`、`verify_icons.py`，它們都會印 `problems: 0`。

---

## 前端語法檢查

`tools/syntax-check.mjs` 不屬於 Python 的部分，它是 Node 腳本：

```bash
npm run check
# 或
node tools/syntax-check.mjs
```

它會用 `node --check` 檢查 `js/` 底下所有 ES module 的語法。
用途：抓出「重複宣告」這類致命語法錯誤——那種錯誤會讓整個模組不執行，畫面變成一片空白，
而且瀏覽器只給你一行訊息。詳見 [README 的測試段落](../README.md#測試)。
