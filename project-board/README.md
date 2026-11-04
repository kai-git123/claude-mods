# 專案看板 (project-board)

Claude Code 的常駐面板：在對話旁邊以圖示呈現專案架構，並即時顯示目前狀況、待辦事項與已完成事項（小標籤）。

## 用法

在任何專案裡輸入：

- `/project-board`：打開面板。如果這個專案還沒有看板檔，會自動請 Claude 讀專案的規劃文件（README、docs、規劃文件、設定檔、程式碼結構）並產生架構。
- `/project-board init`：重新依專案規劃產生或更新架構。
- `/project-board window`：開啟獨立的大視窗（`window/ProjectBoard.exe`），可自由拉大、最大化。

## 大視窗

- 左邊是架構圖：滑鼠滾輪縮放、拖曳移動、雙擊符合視窗；也可以用上方按鈕或 Ctrl + / Ctrl − / Ctrl 0。
- 架構圖有三種樣式，用工具列的「樣式」按鈕依序切換並記住：架構圖（預設：虛線分層、彩色圖示方塊、進度環）、流程圖（彩色泳道、圖示徽章、直角連線）與立體（等角樓層：每層一塊立體平台由上往下疊，元件是立在平台上的方塊，底部色帶與頂角燈號表示狀態，未開始的方塊半透明）。面板內的架構圖固定為架構圖樣式。
- 右邊是目前狀況、待辦事項、已完成，點標題收合或展開（待辦與已完成預設收起）。
- 每 1.5 秒自動讀檔更新，F5 或「重新整理」立即更新；「選擇專案…」可以切換資料夾。
- 也可以直接雙擊 `ProjectBoard.exe`，會開啟上次看的專案。
- 即時狀況來自 `.claude/project-board-live.json`，由外掛在輸入 `/project-board window` 之後持續寫入。
- 程式以 Windows 內建的 .NET Framework 編譯，修改 `ProjectBoard.cs` 後重新編譯：
  `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /target:winexe /codepage:65001 /out:ProjectBoard.exe /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll ProjectBoard.cs`

## 面板內容

- 🏷️ 專案名稱與簡介
- 🧭 目前狀況：進行中或閒置、這一輪的任務、Claude 正在做的事、最近的動作
- 🏗️ 架構圖：最上方是專案整體進度環；每層一個虛線框（標籤上有該層進度環），元件是彩色圖示方塊，右上角圓點綠色表示完成、橘色表示進行中、灰色表示未開始；箭頭顏色跟來源那一層相同
- 📋 待辦事項、✅ 已完成：看板檔中的項目，加上 Claude 當下的工作清單

架構圖會依面板寬度排版（窄時每排 1 個元件，寬時 2–3 個）。按「🔍 放大架構圖」會另開一個只有架構圖的大面板；點各區塊標題（▾／▸）可以收合，讓出空間給架構圖。

## 資料

每個專案的架構存在該專案的 `.claude/project-board.json`。Claude 完成工作時會自動更新這個檔案；你手動修改後，面板也會在幾秒內更新。
