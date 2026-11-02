# my-mods

Claude Code 外掛集合。

## project-board（專案看板）

在 Claude Code 旁邊以圖示呈現專案架構、目前狀況、待辦與已完成事項。詳見 [project-board/README.md](project-board/README.md)。

### 在新電腦安裝

需求：已安裝 Claude Code 與 Git。

在 Claude Code 裡輸入：

```
/plugin marketplace add kai-git123/claude-mods
```

```
/plugin install project-board@my-mods
```

裝好後重開 Claude Code，在任何專案輸入 `/project-board`。

### 更新到最新版

```
/plugin marketplace update my-mods
```

然後輸入 `/reload-plugins` 或重開 Claude Code。

> `/project-board window` 的大視窗（`ProjectBoard.exe`）只支援 Windows。
