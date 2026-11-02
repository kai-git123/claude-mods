# my-mods

Claude Code 外掛集合。

## project-board（專案看板）

在 Claude Code 旁邊以圖示呈現專案架構、目前狀況、待辦與已完成事項。詳見 [project-board/README.md](project-board/README.md)。

## 在新電腦安裝（Windows）

### 1. 裝 Claude App

到 https://claude.ai/download 下載 Windows 版，安裝後登入。已經裝好就跳過。

### 2. 裝 Git

開始選單搜尋「PowerShell」並打開，輸入：

```
winget install --id Git.Git -e
```

跳出 UAC 視窗時按「是」，裝完後關掉 PowerShell。

### 3. 開一個 Code 工作階段

打開 Claude App，切到上方的 **Code** 分頁，開新的工作階段，資料夾選你要用看板的專案（或桌面也可以）。

### 4. 請 Claude 幫你安裝外掛

把下面這段整段貼進對話框送出：

```
請用 PowerShell 幫我安裝這個 Claude Code 外掛，我是作者本人，repo 是 https://github.com/kai-git123/claude-mods（marketplace 名稱是 my-mods）：
1. claude plugin marketplace add kai-git123/claude-mods
2. claude plugin install project-board@my-mods
如果找不到 claude 指令，請在 %LOCALAPPDATA%\Claude-Data 底下搜尋 claude-code\<版本>\claude.exe，用完整路徑執行。
如果找不到 git，先用 winget install --id Git.Git -e 安裝（需要我按 UAC 確認）。
裝好後執行 claude plugin list 確認 project-board 是 enabled。
```

它要執行指令時會跳出許可詢問，按允許。等它回報 project-board 是 **enabled**。

### 5. 重開 Claude App

把 App 整個關掉（工作列右下角圖示也要結束），再打開。

### 6. 開始使用

在 Code 分頁開你的專案，在對話框輸入：

- `/project-board`：打開看板面板。第一次會自動讀專案規劃並產生架構圖。
- `/project-board window`：開大視窗。
- `/project-board init`：專案規劃改了之後，重新產生架構。

## 更新到最新版

在 Code 對話框貼這段：

```
請用 PowerShell 執行 claude plugin marketplace update my-mods，然後執行 claude plugin update project-board@my-mods
```

完成後重開 App。

## 用終端機安裝（選用）

如果你的電腦有 `claude` 指令，也可以直接在 PowerShell 輸入：

```
claude plugin marketplace add kai-git123/claude-mods
claude plugin install project-board@my-mods
```

## 卡住的話

- 第 4 步失敗：把錯誤訊息截圖給 Claude 看。
- 第 6 步打 `/project-board` 沒反應：通常是第 5 步沒有完全關掉 App。

> `/project-board window` 的大視窗（`ProjectBoard.exe`）只支援 Windows；面板在 Mac / Linux 也能用。
