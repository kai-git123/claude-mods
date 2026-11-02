// 專案看板視窗：讀取專案的 .claude/project-board.json（架構、待辦、已完成）
// 與 .claude/project-board-live.json（Claude Code 外掛寫入的即時狀況），
// 在可縮放的大視窗中顯示。以 Windows 內建的 .NET Framework 編譯（C# 5）。
using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

namespace ProjectBoard
{
    class Node
    {
        public string Icon, Name, Desc, Status;
        public int Layer;
        public RectangleF Rect;
    }

    class Layer
    {
        public string Name;
        public List<Node> Nodes = new List<Node>();
        public RectangleF Rect;
    }

    class Link
    {
        public string From, To, Label;
    }

    class PlanItem
    {
        public string Text, Status;
    }

    class BoardData
    {
        public string Name = "", Summary = "", Error;
        public List<Layer> Layers = new List<Layer>();
        public List<Link> Links = new List<Link>();
        public List<string> Todo = new List<string>();
        public List<string> Done = new List<string>();
    }

    class LiveData
    {
        public bool Exists, IsBusy;
        public string Now = "", Task = "";
        public List<string> Recent = new List<string>();
        public List<PlanItem> Plan = new List<PlanItem>();
    }

    static class Json
    {
        static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer();

        public static IDictionary<string, object> Parse(string text)
        {
            return Serializer.DeserializeObject(text) as IDictionary<string, object>;
        }

        public static IDictionary<string, object> Obj(object value)
        {
            return value as IDictionary<string, object>;
        }

        public static string Str(IDictionary<string, object> d, string key)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v) && v is string) return (string)v;
            return "";
        }

        public static bool Bool(IDictionary<string, object> d, string key)
        {
            object v;
            return d != null && d.TryGetValue(key, out v) && v is bool && (bool)v;
        }

        public static object[] Arr(IDictionary<string, object> d, string key)
        {
            object v;
            if (d != null && d.TryGetValue(key, out v))
            {
                object[] a = v as object[];
                if (a != null) return a;
                ArrayList list = v as ArrayList;
                if (list != null) return list.ToArray();
            }
            return new object[0];
        }

        public static List<string> Strings(IDictionary<string, object> d, string key)
        {
            List<string> result = new List<string>();
            foreach (object o in Arr(d, key))
            {
                string s = o as string;
                if (!string.IsNullOrEmpty(s)) result.Add(s);
            }
            return result;
        }
    }

    static class Loader
    {
        public static string ReadShared(string path)
        {
            using (FileStream fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (StreamReader reader = new StreamReader(fs, Encoding.UTF8))
            {
                return reader.ReadToEnd();
            }
        }

        public static BoardData Board(string path)
        {
            BoardData data = new BoardData();
            if (!File.Exists(path))
            {
                data.Error = "這個專案還沒有看板檔（.claude/project-board.json）。\n請在 Claude Code 輸入 /project-board init 產生架構。";
                return data;
            }
            try
            {
                IDictionary<string, object> raw = Json.Parse(ReadShared(path));
                data.Name = Json.Str(raw, "name");
                data.Summary = Json.Str(raw, "summary");
                foreach (object lo in Json.Arr(raw, "layers"))
                {
                    IDictionary<string, object> l = Json.Obj(lo);
                    Layer layer = new Layer();
                    layer.Name = Json.Str(l, "name");
                    foreach (object no in Json.Arr(l, "nodes"))
                    {
                        IDictionary<string, object> n = Json.Obj(no);
                        Node node = new Node();
                        node.Icon = Json.Str(n, "icon");
                        if (node.Icon == "") node.Icon = "📦";
                        node.Name = Json.Str(n, "name");
                        if (node.Name == "") node.Name = "(未命名)";
                        node.Desc = Json.Str(n, "desc");
                        node.Status = Json.Str(n, "status");
                        layer.Nodes.Add(node);
                    }
                    data.Layers.Add(layer);
                }
                foreach (object ko in Json.Arr(raw, "links"))
                {
                    IDictionary<string, object> k = Json.Obj(ko);
                    Link link = new Link();
                    link.From = Json.Str(k, "from");
                    link.To = Json.Str(k, "to");
                    link.Label = Json.Str(k, "label");
                    if (link.From != "" && link.To != "") data.Links.Add(link);
                }
                data.Todo = Json.Strings(raw, "todo");
                data.Done = Json.Strings(raw, "done");
            }
            catch (Exception ex)
            {
                data.Error = "看板檔格式錯誤：" + ex.Message;
            }
            return data;
        }

        public static LiveData Live(string path)
        {
            LiveData live = new LiveData();
            if (!File.Exists(path)) return live;
            try
            {
                IDictionary<string, object> raw = Json.Parse(ReadShared(path));
                IDictionary<string, object> a = null;
                object av;
                if (raw != null && raw.TryGetValue("activity", out av)) a = Json.Obj(av);
                live.Exists = true;
                live.Now = Json.Str(a, "now");
                live.Task = Json.Str(a, "task");
                live.IsBusy = Json.Bool(a, "isBusy");
                live.Recent = Json.Strings(a, "recent");
                foreach (object po in Json.Arr(raw, "plan"))
                {
                    IDictionary<string, object> p = Json.Obj(po);
                    PlanItem item = new PlanItem();
                    item.Text = Json.Str(p, "text");
                    item.Status = Json.Str(p, "status");
                    if (item.Text != "") live.Plan.Add(item);
                }
            }
            catch
            {
                // 寫入中途讀到不完整的檔案：保持上一次的內容。
                return null;
            }
            return live;
        }
    }

    static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(24, 24, 24);
        public static readonly Color Side = Color.FromArgb(30, 31, 34);
        public static readonly Color Bar = Color.FromArgb(36, 37, 40);
        public static readonly Color LayerFill = Color.FromArgb(36, 39, 44);
        public static readonly Color NodeFill = Color.FromArgb(22, 27, 34);
        public static readonly Color Line = Color.FromArgb(64, 68, 75);
        public static readonly Color Text = Color.FromArgb(230, 237, 243);
        public static readonly Color Muted = Color.FromArgb(145, 152, 161);
        public static readonly Color Done = Color.FromArgb(63, 185, 80);
        public static readonly Color Doing = Color.FromArgb(210, 153, 34);
        public static readonly Color Todo = Color.FromArgb(125, 133, 144);
        public const string Ui = "Microsoft JhengHei UI";

        public static Color ForStatus(string status)
        {
            if (status == "done") return Done;
            if (status == "doing") return Doing;
            return Todo;
        }

        public static GraphicsPath Round(RectangleF r, float radius)
        {
            GraphicsPath path = new GraphicsPath();
            float d = radius * 2;
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }

    enum ArchStyle { Flow, Notion }

    // 架構圖：以世界座標排版，滾輪縮放、拖曳平移、雙擊符合視窗。
    // 兩種畫法：Flow（流程圖：泳道、徽章、直角連線）與 Notion（標題、卡片、標籤）。
    class ArchCanvas : Control
    {
        static readonly Color[] Palette =
        {
            Color.FromArgb(88, 166, 255),
            Color.FromArgb(188, 140, 255),
            Color.FromArgb(57, 197, 187),
            Color.FromArgb(255, 166, 87),
            Color.FromArgb(255, 123, 172),
            Color.FromArgb(86, 211, 100),
        };

        public ArchStyle Style = ArchStyle.Notion;

        float nodeW, nodeH, gapX, gapY, headH, layerGap, pad, inner;
        BoardData data;
        float worldW = 800, worldH = 400;
        float scale = 1;
        PointF offset = new PointF(0, 0);
        bool autoFit = true;
        bool dragging;
        Point dragFrom;
        PointF offsetFrom;
        readonly ToolTip tip = new ToolTip();
        Node hovered;

        public ArchCanvas()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = Theme.Bg;
        }

        public void SetData(BoardData value)
        {
            data = value;
            Layout2();
            if (autoFit) Fit();
            Invalidate();
        }

        public void SetStyle(ArchStyle style)
        {
            Style = style;
            Layout2();
            Fit();
        }

        static Color LayerColor(int index)
        {
            return Palette[index % Palette.Length];
        }

        static string StatusText(string status)
        {
            if (status == "done") return "完成";
            if (status == "doing") return "進行中";
            return "未開始";
        }

        void Params()
        {
            if (Style == ArchStyle.Notion)
            {
                nodeW = 270; nodeH = 108; gapX = 14; gapY = 14; headH = 70; layerGap = 34; pad = 40; inner = 0;
            }
            else
            {
                nodeW = 260; nodeH = 96; gapX = 40; gapY = 26; headH = 52; layerGap = 64; pad = 30; inner = 24;
            }
        }

        void Layout2()
        {
            Params();
            if (data == null) return;
            int perRow = 1;
            foreach (Layer layer in data.Layers) perRow = Math.Max(perRow, Math.Min(3, layer.Nodes.Count));
            float gridW = perRow * nodeW + (perRow - 1) * gapX;
            worldW = 2 * pad + 2 * inner + gridW;
            float y = pad;
            for (int li = 0; li < data.Layers.Count; li++)
            {
                Layer layer = data.Layers[li];
                int n = layer.Nodes.Count;
                int cols = Math.Max(1, Math.Min(perRow, n));
                int rows = Math.Max(1, (n + cols - 1) / cols);
                float h = headH + rows * nodeH + (rows - 1) * gapY + inner;
                layer.Rect = new RectangleF(pad, y, worldW - 2 * pad, h);
                for (int i = 0; i < n; i++)
                {
                    int row = i / cols, col = i % cols;
                    int inRow = Math.Min(cols, n - row * cols);
                    float rowW = inRow * nodeW + (inRow - 1) * gapX;
                    float startX = Style == ArchStyle.Notion ? pad + inner : worldW / 2 - rowW / 2;
                    Node node = layer.Nodes[i];
                    node.Layer = li;
                    node.Rect = new RectangleF(startX + col * (nodeW + gapX), y + headH + row * (nodeH + gapY), nodeW, nodeH);
                }
                y += h + layerGap;
            }
            worldH = Math.Max(y - layerGap + pad, 200);
        }

        public void Fit()
        {
            autoFit = true;
            if (ClientSize.Width < 10 || ClientSize.Height < 10) return;
            scale = Math.Min((ClientSize.Width - 20) / worldW, (ClientSize.Height - 20) / worldH);
            scale = Math.Max(0.2f, Math.Min(1.8f, scale));
            offset = new PointF((ClientSize.Width - worldW * scale) / 2, Math.Max(10, (ClientSize.Height - worldH * scale) / 2));
            Invalidate();
        }

        public void ZoomBy(float factor, PointF at)
        {
            autoFit = false;
            float next = Math.Max(0.15f, Math.Min(5f, scale * factor));
            offset = new PointF(at.X - (at.X - offset.X) * (next / scale), at.Y - (at.Y - offset.Y) * (next / scale));
            scale = next;
            Invalidate();
        }

        public void ZoomCenter(float factor)
        {
            ZoomBy(factor, new PointF(ClientSize.Width / 2f, ClientSize.Height / 2f));
        }

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            if (autoFit) Fit();
        }

        protected override void OnMouseWheel(MouseEventArgs e)
        {
            ZoomBy(e.Delta > 0 ? 1.15f : 1 / 1.15f, e.Location);
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            Focus();
            if (e.Button == MouseButtons.Left)
            {
                dragging = true;
                dragFrom = e.Location;
                offsetFrom = offset;
                Cursor = Cursors.SizeAll;
            }
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            dragging = false;
            Cursor = Cursors.Default;
        }

        protected override void OnMouseDoubleClick(MouseEventArgs e)
        {
            Fit();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            if (dragging)
            {
                autoFit = false;
                offset = new PointF(offsetFrom.X + e.X - dragFrom.X, offsetFrom.Y + e.Y - dragFrom.Y);
                Invalidate();
                return;
            }
            if (data == null) return;
            PointF w = new PointF((e.X - offset.X) / scale, (e.Y - offset.Y) / scale);
            Node found = null;
            foreach (Layer layer in data.Layers)
                foreach (Node node in layer.Nodes)
                    if (node.Rect.Contains(w)) found = node;
            if (found != hovered)
            {
                hovered = found;
                tip.SetToolTip(this, found == null ? "" : found.Name + (found.Desc != "" ? "\n" + found.Desc : "") + "\n狀態：" + StatusText(found.Status));
                Invalidate();
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            g.Clear(Style == ArchStyle.Notion ? Color.FromArgb(25, 25, 25) : Color.FromArgb(21, 23, 27));
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;

            if (data == null || data.Error != null || data.Layers.Count == 0)
            {
                string msg = data == null ? "載入中…" : (data.Error ?? "看板檔中沒有架構資料。");
                using (Font f = new Font(Theme.Ui, 13))
                using (SolidBrush b = new SolidBrush(Theme.Muted))
                using (StringFormat sf = new StringFormat())
                {
                    sf.Alignment = StringAlignment.Center;
                    sf.LineAlignment = StringAlignment.Center;
                    g.DrawString(msg, f, b, new RectangleF(20, 20, ClientSize.Width - 40, ClientSize.Height - 40), sf);
                }
                return;
            }

            if (Style == ArchStyle.Flow) DrawDotGrid(g);
            g.TranslateTransform(offset.X, offset.Y);
            g.ScaleTransform(scale, scale);
            if (Style == ArchStyle.Notion) PaintNotion(g);
            else PaintFlow(g);
        }

        void DrawDotGrid(Graphics g)
        {
            float step = 24 * scale;
            while (step < 12) step *= 2;
            float ox = offset.X % step, oy = offset.Y % step;
            using (SolidBrush dot = new SolidBrush(Color.FromArgb(44, 48, 55)))
            {
                for (float x = ox; x < ClientSize.Width; x += step)
                    for (float y = oy; y < ClientSize.Height; y += step)
                        g.FillRectangle(dot, x, y, 1.6f, 1.6f);
            }
        }

        // 小膠囊標籤，回傳寬度。
        static float Pill(Graphics g, string text, Font font, Color fg, Color bg, float x, float y, float padX)
        {
            SizeF size = g.MeasureString(text, font);
            RectangleF r = new RectangleF(x, y, size.Width + padX * 2 - 4, size.Height + 2);
            using (GraphicsPath p = Theme.Round(r, r.Height / 2))
            using (SolidBrush b = new SolidBrush(bg))
            using (SolidBrush t = new SolidBrush(fg))
            {
                g.FillPath(b, p);
                g.DrawString(text, font, t, x + padX - 2, y + 1);
            }
            return r.Width;
        }

        static int DoneCount(Layer layer)
        {
            int done = 0;
            foreach (Node node in layer.Nodes) if (node.Status == "done") done++;
            return done;
        }

        // ---------- Notion ----------

        static void NotionTag(string status, out Color fg, out Color bg)
        {
            if (status == "done") { fg = Color.FromArgb(113, 204, 151); bg = Color.FromArgb(35, 62, 47); }
            else if (status == "doing") { fg = Color.FromArgb(236, 184, 94); bg = Color.FromArgb(82, 61, 25); }
            else { fg = Color.FromArgb(180, 180, 180); bg = Color.FromArgb(55, 55, 55); }
        }

        // Notion 的連線：細的平滑曲線。同一排的元件由卡片下緣往下彎再接回，不穿過中間的卡片。
        void DrawNotionLinks(Graphics g)
        {
            using (Pen link = new Pen(Color.FromArgb(105, 105, 105), 1.5f))
            using (AdjustableArrowCap cap = new AdjustableArrowCap(4, 5))
            using (Font labelFont = new Font(Theme.Ui, 12, GraphicsUnit.Pixel))
            {
                link.CustomEndCap = cap;
                foreach (Link l in data.Links)
                {
                    Node a = Find(l.From), b = Find(l.To);
                    if (a == null || b == null) continue;
                    PointF p1, p2, c1, c2, m;
                    if (Math.Abs(a.Rect.Y - b.Rect.Y) < 1)
                    {
                        float dip = Math.Min(layerGap - 6, 30);
                        p1 = new PointF(a.Rect.X + a.Rect.Width / 2, a.Rect.Bottom);
                        p2 = new PointF(b.Rect.X + b.Rect.Width / 2, b.Rect.Bottom + 3);
                        c1 = new PointF(p1.X, p1.Y + dip * 1.3f);
                        c2 = new PointF(p2.X, p2.Y + dip * 1.3f);
                        m = new PointF((p1.X + p2.X) / 2, p1.Y + dip);
                    }
                    else
                    {
                        bool down = b.Rect.Y > a.Rect.Y;
                        p1 = new PointF(a.Rect.X + a.Rect.Width / 2, down ? a.Rect.Bottom : a.Rect.Top);
                        p2 = new PointF(b.Rect.X + b.Rect.Width / 2, down ? b.Rect.Top - 2 : b.Rect.Bottom + 2);
                        float bend = (p2.Y - p1.Y) * 0.5f;
                        c1 = new PointF(p1.X, p1.Y + bend);
                        c2 = new PointF(p2.X, p2.Y - bend);
                        m = new PointF((p1.X + p2.X) / 2, (p1.Y + p2.Y) / 2);
                    }
                    g.DrawBezier(link, p1, c1, c2, p2);
                    if (l.Label != "")
                    {
                        SizeF s = g.MeasureString(l.Label, labelFont);
                        Pill(g, l.Label, labelFont, Color.FromArgb(170, 170, 170), Color.FromArgb(32, 32, 32), m.X - s.Width / 2 - 6, m.Y - s.Height / 2, 8);
                    }
                }
            }
        }
        void PaintNotion(Graphics g)
        {
            // 連線先畫，標題文字再蓋上（帶底色），線看起來從標題後方穿過。
            DrawNotionLinks(g);
            using (Font title = new Font(Theme.Ui, 20, FontStyle.Bold, GraphicsUnit.Pixel))
            using (Font meta = new Font(Theme.Ui, 13, GraphicsUnit.Pixel))
            using (SolidBrush text = new SolidBrush(Color.FromArgb(235, 235, 235)))
            using (SolidBrush muted = new SolidBrush(Color.FromArgb(155, 155, 155)))
            using (SolidBrush track = new SolidBrush(Color.FromArgb(50, 50, 50)))
            using (SolidBrush fill = new SolidBrush(Color.FromArgb(113, 204, 151)))
            using (Pen rule = new Pen(Color.FromArgb(47, 47, 47), 1))
            {
                using (SolidBrush bg = new SolidBrush(Color.FromArgb(25, 25, 25)))
                foreach (Layer layer in data.Layers)
                {
                    RectangleF r = layer.Rect;
                    int done = DoneCount(layer), n = layer.Nodes.Count;
                    string line = n + " 個元件 · " + done + "/" + n + " 完成";
                    SizeF ts = g.MeasureString(layer.Name, title), ms = g.MeasureString(line, meta);
                    g.FillRectangle(bg, r.X - 6, r.Y - 2, ts.Width + 8, ts.Height + 2);
                    g.FillRectangle(bg, r.X - 6, r.Y + 30, ms.Width + 8, ms.Height + 2);
                    g.DrawString(layer.Name, title, text, r.X - 2, r.Y);
                    g.DrawString(line, meta, muted, r.X, r.Y + 32);
                    float barX = r.X + 170, barW = Math.Min(180, r.Width - 180);
                    if (barW > 40)
                    {
                        g.FillRectangle(track, barX, r.Y + 40, barW, 4);
                        if (n > 0) g.FillRectangle(fill, barX, r.Y + 40, barW * done / n, 4);
                    }
                    g.DrawLine(rule, r.X, r.Y + headH - 10, r.Right, r.Y + headH - 10);
                }
            }

            using (Font icon = new Font("Segoe UI Emoji", 22, GraphicsUnit.Pixel))
            using (Font name = new Font(Theme.Ui, 16, FontStyle.Bold, GraphicsUnit.Pixel))
            using (Font desc = new Font(Theme.Ui, 13, GraphicsUnit.Pixel))
            using (Font tag = new Font(Theme.Ui, 12, GraphicsUnit.Pixel))
            using (SolidBrush text = new SolidBrush(Color.FromArgb(235, 235, 235)))
            using (SolidBrush muted = new SolidBrush(Color.FromArgb(155, 155, 155)))
            using (StringFormat one = new StringFormat(StringFormatFlags.NoWrap))
            {
                one.Trimming = StringTrimming.EllipsisCharacter;
                foreach (Layer layer in data.Layers)
                {
                    foreach (Node node in layer.Nodes)
                    {
                        RectangleF r = node.Rect;
                        bool hot = node == hovered;
                        using (GraphicsPath p = Theme.Round(r, 6))
                        using (SolidBrush card = new SolidBrush(hot ? Color.FromArgb(46, 46, 46) : Color.FromArgb(37, 37, 37)))
                        using (Pen border = new Pen(hot ? Color.FromArgb(80, 80, 80) : Color.FromArgb(50, 50, 50), 1))
                        {
                            g.FillPath(card, p);
                            g.DrawPath(border, p);
                        }
                        g.DrawString(node.Icon, icon, text, r.X + 12, r.Y + 12);
                        g.DrawString(node.Name, name, text, new RectangleF(r.X + 48, r.Y + 15, r.Width - 60, 24), one);
                        if (node.Desc != "")
                            g.DrawString(node.Desc, desc, muted, new RectangleF(r.X + 14, r.Y + 48, r.Width - 28, 20), one);
                        Color fg, bg;
                        NotionTag(node.Status, out fg, out bg);
                        Pill(g, StatusText(node.Status), tag, fg, bg, r.X + 14, r.Bottom - 30, 8);
                    }
                }
            }
        }

        // ---------- 流程圖 ----------

        void PaintFlow(Graphics g)
        {
            using (Font laneFont = new Font(Theme.Ui, 14, FontStyle.Bold, GraphicsUnit.Pixel))
            using (Font meta = new Font(Theme.Ui, 12, GraphicsUnit.Pixel))
            {
                for (int li = 0; li < data.Layers.Count; li++)
                {
                    Layer layer = data.Layers[li];
                    Color c = LayerColor(li);
                    RectangleF r = layer.Rect;
                    using (GraphicsPath p = Theme.Round(r, 14))
                    using (SolidBrush lane = new SolidBrush(Color.FromArgb(16, c)))
                    using (Pen edge = new Pen(Color.FromArgb(70, c), 1.2f))
                    using (SolidBrush strip = new SolidBrush(c))
                    {
                        g.FillPath(lane, p);
                        g.DrawPath(edge, p);
                        Region old = g.Clip;
                        g.SetClip(p, CombineMode.Intersect);
                        g.FillRectangle(strip, r.X, r.Y, 5, r.Height);
                        g.Clip = old;
                    }
                    float pw = Pill(g, layer.Name, laneFont, c, Color.FromArgb(45, c), r.X + 18, r.Y + 14, 12);
                    int done = DoneCount(layer), n = layer.Nodes.Count;
                    using (SolidBrush m = new SolidBrush(Theme.Muted))
                        g.DrawString(done + "/" + n + " 完成", meta, m, r.X + 18 + pw + 12, r.Y + 17);
                    float barX = r.X + 18 + pw + 86, barW = 120;
                    if (barX + barW < r.Right - 10)
                    {
                        using (SolidBrush track = new SolidBrush(Color.FromArgb(45, 49, 56)))
                        using (SolidBrush fill = new SolidBrush(c))
                        {
                            g.FillRectangle(track, barX, r.Y + 24, barW, 5);
                            if (n > 0) g.FillRectangle(fill, barX, r.Y + 24, barW * done / n, 5);
                        }
                    }
                }
            }

            DrawFlowLinks(g);

            using (Font icon = new Font("Segoe UI Emoji", 20, GraphicsUnit.Pixel))
            using (Font name = new Font(Theme.Ui, 16, FontStyle.Bold, GraphicsUnit.Pixel))
            using (Font desc = new Font(Theme.Ui, 12.5f, GraphicsUnit.Pixel))
            using (Font chip = new Font(Theme.Ui, 11.5f, GraphicsUnit.Pixel))
            using (SolidBrush text = new SolidBrush(Theme.Text))
            using (SolidBrush muted = new SolidBrush(Theme.Muted))
            using (StringFormat one = new StringFormat(StringFormatFlags.NoWrap))
            using (StringFormat center = new StringFormat())
            {
                one.Trimming = StringTrimming.EllipsisCharacter;
                center.Alignment = StringAlignment.Center;
                center.LineAlignment = StringAlignment.Center;
                foreach (Layer layer in data.Layers)
                {
                    foreach (Node node in layer.Nodes)
                    {
                        RectangleF r = node.Rect;
                        Color lc = LayerColor(node.Layer);
                        Color sc = Theme.ForStatus(node.Status);
                        bool hot = node == hovered;
                        for (int i = 1; i <= 4; i++)
                        {
                            RectangleF s = new RectangleF(r.X - i + 1, r.Y + i + 1, r.Width + 2 * i - 2, r.Height + i);
                            using (GraphicsPath sp = Theme.Round(s, 12 + i))
                            using (SolidBrush sb = new SolidBrush(Color.FromArgb(22, 0, 0, 0)))
                                g.FillPath(sb, sp);
                        }
                        using (GraphicsPath p = Theme.Round(r, 12))
                        using (SolidBrush card = new SolidBrush(hot ? Color.FromArgb(40, 44, 51) : Color.FromArgb(32, 35, 41)))
                        using (Pen border = new Pen(hot ? lc : Color.FromArgb(58, 62, 70), hot ? 2f : 1.2f))
                        using (SolidBrush accent = new SolidBrush(sc))
                        {
                            g.FillPath(card, p);
                            Region old = g.Clip;
                            g.SetClip(p, CombineMode.Intersect);
                            g.FillRectangle(accent, r.X, r.Y, 5, r.Height);
                            g.Clip = old;
                            g.DrawPath(border, p);
                        }
                        RectangleF badge = new RectangleF(r.X + 18, r.Y + r.Height / 2 - 22, 44, 44);
                        using (SolidBrush bf = new SolidBrush(Color.FromArgb(50, lc)))
                        using (Pen bp = new Pen(Color.FromArgb(150, lc), 1.4f))
                        {
                            g.FillEllipse(bf, badge);
                            g.DrawEllipse(bp, badge);
                        }
                        g.DrawString(node.Icon, icon, text, new RectangleF(badge.X, badge.Y + 1, badge.Width, badge.Height), center);
                        float tx = r.X + 76, tw = r.Right - tx - 12;
                        g.DrawString(node.Name, name, text, new RectangleF(tx, r.Y + 14, tw, 24), one);
                        if (node.Desc != "") g.DrawString(node.Desc, desc, muted, new RectangleF(tx, r.Y + 40, tw, 20), one);
                        Pill(g, StatusText(node.Status), chip, sc, Color.FromArgb(38, sc), tx, r.Bottom - 30, 8);
                    }
                }
            }
        }

        void DrawFlowLinks(Graphics g)
        {
            using (Pen pen = new Pen(Color.FromArgb(128, 136, 148), 2f))
            using (AdjustableArrowCap cap = new AdjustableArrowCap(5, 6))
            using (Font labelFont = new Font(Theme.Ui, 12, GraphicsUnit.Pixel))
            {
                pen.CustomEndCap = cap;
                pen.LineJoin = LineJoin.Round;
                if (data.Links.Count == 0)
                {
                    for (int i = 0; i + 1 < data.Layers.Count; i++)
                    {
                        float x = worldW / 2;
                        g.DrawLine(pen, x, data.Layers[i].Rect.Bottom + 6, x, data.Layers[i + 1].Rect.Top - 6);
                    }
                    return;
                }
                int index = 0;
                foreach (Link l in data.Links)
                {
                    Node a = Find(l.From), b = Find(l.To);
                    if (a == null || b == null) continue;
                    float off = ((index++ % 3) - 1) * 8;
                    float ax = a.Rect.X + a.Rect.Width / 2 + off, bx = b.Rect.X + b.Rect.Width / 2 + off;
                    PointF[] pts;
                    if (Math.Abs(a.Rect.Y - b.Rect.Y) < 1)
                    {
                        float yUp = a.Rect.Top - gapY / 2 - 4;
                        if (a.Layer == b.Layer && a.Rect.Top - headH < data.Layers[a.Layer].Rect.Top + 1) yUp = a.Rect.Top - 10;
                        pts = new PointF[] { new PointF(ax, a.Rect.Top), new PointF(ax, yUp), new PointF(bx, yUp), new PointF(bx, b.Rect.Top - 3) };
                    }
                    else if (b.Rect.Y > a.Rect.Y)
                    {
                        float yMid = a.Layer == b.Layer ? a.Rect.Bottom + gapY / 2 : data.Layers[a.Layer].Rect.Bottom + layerGap / 2;
                        yMid += off * 0.6f;
                        pts = new PointF[] { new PointF(ax, a.Rect.Bottom), new PointF(ax, yMid), new PointF(bx, yMid), new PointF(bx, b.Rect.Top - 3) };
                    }
                    else
                    {
                        float yMid = a.Layer == b.Layer ? a.Rect.Top - gapY / 2 : data.Layers[a.Layer].Rect.Top - layerGap / 2;
                        yMid += off * 0.6f;
                        pts = new PointF[] { new PointF(ax, a.Rect.Top), new PointF(ax, yMid), new PointF(bx, yMid), new PointF(bx, b.Rect.Bottom + 3) };
                    }
                    if (Math.Abs(ax - bx) < 1) pts = new PointF[] { pts[0], pts[3] };
                    g.DrawLines(pen, pts);
                    if (l.Label != "")
                    {
                        PointF m = pts.Length == 4
                            ? new PointF((pts[1].X + pts[2].X) / 2, pts[1].Y)
                            : new PointF(pts[0].X, (pts[0].Y + pts[1].Y) / 2);
                        SizeF s = g.MeasureString(l.Label, labelFont);
                        float lx = m.X - s.Width / 2 - 8, ly = m.Y - s.Height / 2 - 1;
                        RectangleF lr = new RectangleF(lx, ly, s.Width + 12, s.Height + 2);
                        using (GraphicsPath lp = Theme.Round(lr, lr.Height / 2))
                        using (Pen lb = new Pen(Color.FromArgb(72, 77, 86), 1))
                        {
                            Pill(g, l.Label, labelFont, Color.FromArgb(190, 197, 207), Color.FromArgb(36, 40, 47), lx, ly, 8);
                            g.DrawPath(lb, lp);
                        }
                    }
                }
            }
        }

        Node Find(string name)
        {
            foreach (Layer layer in data.Layers)
                foreach (Node node in layer.Nodes)
                    if (node.Name == name) return node;
            return null;
        }
    }

    // 右側欄：目前狀況、待辦事項、已完成（點標題收合／展開）。
    class SidePanel : Control
    {
        BoardData board;
        LiveData live = new LiveData();
        readonly HashSet<string> folded = new HashSet<string>(new string[] { "todo", "done" });
        readonly Dictionary<string, RectangleF> headers = new Dictionary<string, RectangleF>();

        public SidePanel()
        {
            DoubleBuffered = true;
            ResizeRedraw = true;
            BackColor = Theme.Side;
            Cursor = Cursors.Default;
        }

        public void SetData(BoardData b, LiveData l)
        {
            board = b;
            if (l != null) live = l;
            Relayout();
        }

        void Relayout()
        {
            using (Graphics g = CreateGraphics())
            {
                int h = (int)Math.Ceiling(Render(g, false)) + 20;
                Control host = Parent;
                int min = host != null ? host.ClientSize.Height : 0;
                Height = Math.Max(h, min);
            }
            Invalidate();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            bool over = false;
            foreach (RectangleF r in headers.Values)
                if (r.Contains(e.Location)) over = true;
            Cursor = over ? Cursors.Hand : Cursors.Default;
        }

        protected override void OnMouseClick(MouseEventArgs e)
        {
            foreach (KeyValuePair<string, RectangleF> pair in headers)
            {
                if (!pair.Value.Contains(e.Location)) continue;
                if (folded.Contains(pair.Key)) folded.Remove(pair.Key);
                else folded.Add(pair.Key);
                Relayout();
                return;
            }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Theme.Side);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;
            e.Graphics.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
            Render(e.Graphics, true);
        }

        // 一次排版兼繪圖：draw 為 false 時只量高度。
        float Render(Graphics g, bool draw)
        {
            headers.Clear();
            float x = 18, w = Math.Max(120, ClientSize.Width - 36), y = 16;
            using (Font title = new Font(Theme.Ui, 18, FontStyle.Bold, GraphicsUnit.Pixel))
            using (Font head = new Font(Theme.Ui, 15, FontStyle.Bold, GraphicsUnit.Pixel))
            using (Font body = new Font(Theme.Ui, 14, GraphicsUnit.Pixel))
            using (Font small = new Font(Theme.Ui, 12.5f, GraphicsUnit.Pixel))
            {
                string name = board != null && board.Name != "" ? board.Name : "專案看板";
                y = Para(g, draw, name, title, Theme.Text, x, y, w) + 4;
                if (board != null && board.Summary != "") y = Para(g, draw, board.Summary, body, Theme.Muted, x, y, w);
                y += 16;

                // 目前狀況
                y = Header(g, draw, "status", "目前狀況", head, x, y, w);
                if (!folded.Contains("status"))
                {
                    if (!live.Exists)
                    {
                        y = Para(g, draw, "尚未連線。在 Claude Code 輸入 /project-board window 開啟此視窗，即可顯示即時狀況。", small, Theme.Muted, x, y, w);
                    }
                    else
                    {
                        Color c = live.IsBusy ? Theme.Doing : Theme.Done;
                        if (draw)
                            using (SolidBrush dot = new SolidBrush(c))
                                g.FillEllipse(dot, x, y + 5, 10, 10);
                        y = Para(g, draw, (live.IsBusy ? "進行中　" : "閒置　") + live.Now, body, c, x + 16, y, w - 16);
                        if (live.Task != "") y = Para(g, draw, "任務：" + live.Task, small, Theme.Muted, x, y + 2, w);
                        for (int i = 1; i < live.Recent.Count; i++)
                            y = Para(g, draw, "· " + live.Recent[i], small, Theme.Muted, x, y + 1, w);
                    }
                }
                y += 18;

                // 待辦事項
                List<KeyValuePair<string, Color>> todo = new List<KeyValuePair<string, Color>>();
                List<KeyValuePair<string, Color>> done = new List<KeyValuePair<string, Color>>();
                foreach (PlanItem item in live.Plan)
                {
                    if (item.Status == "completed") done.Add(new KeyValuePair<string, Color>(item.Text, Theme.Done));
                    else todo.Add(new KeyValuePair<string, Color>(item.Text, item.Status == "in_progress" ? Theme.Doing : Theme.Todo));
                }
                if (board != null)
                {
                    foreach (string t in board.Todo) todo.Add(new KeyValuePair<string, Color>(t, Theme.Todo));
                    foreach (string t in board.Done) done.Add(new KeyValuePair<string, Color>(t, Theme.Done));
                }

                y = Header(g, draw, "todo", "待辦事項（" + todo.Count + "）", head, x, y, w);
                if (!folded.Contains("todo"))
                    y = todo.Count == 0 ? Para(g, draw, "目前沒有待辦", small, Theme.Muted, x, y, w) : Chips(g, draw, todo, body, x, y, w);
                y += 18;

                y = Header(g, draw, "done", "已完成（" + done.Count + "）", head, x, y, w);
                if (!folded.Contains("done"))
                    y = done.Count == 0 ? Para(g, draw, "尚無完成項目", small, Theme.Muted, x, y, w) : Chips(g, draw, done, body, x, y, w);
                y += 18;

                y = Para(g, draw, "架構圖：滾輪縮放、拖曳移動、雙擊符合視窗。\n上方「樣式」按鈕可切換流程圖／Notion。", small, Theme.Muted, x, y + 6, w);
            }
            return y;
        }

        float Para(Graphics g, bool draw, string text, Font font, Color color, float x, float y, float w)
        {
            SizeF size = g.MeasureString(text, font, (int)w);
            if (draw)
                using (SolidBrush b = new SolidBrush(color))
                    g.DrawString(text, font, b, new RectangleF(x, y, w, size.Height + 2));
            return y + size.Height + 2;
        }

        float Header(Graphics g, bool draw, string id, string text, Font font, float x, float y, float w)
        {
            float h = font.Height + 6;
            headers[id] = new RectangleF(x - 6, y - 2, w + 12, h);
            if (draw)
            {
                using (SolidBrush b = new SolidBrush(Theme.Text))
                using (SolidBrush arrow = new SolidBrush(Theme.Muted))
                {
                    float cy = y + h / 2 - 1;
                    PointF[] tri = folded.Contains(id)
                        ? new PointF[] { new PointF(x, cy - 5), new PointF(x + 8, cy), new PointF(x, cy + 5) }
                        : new PointF[] { new PointF(x - 1, cy - 4), new PointF(x + 9, cy - 4), new PointF(x + 4, cy + 4) };
                    g.FillPolygon(arrow, tri);
                    g.DrawString(text, font, b, x + 16, y);
                }
            }
            return y + h + 4;
        }

        float Chips(Graphics g, bool draw, List<KeyValuePair<string, Color>> items, Font font, float x, float y, float w)
        {
            float cx = x, rowH = font.Height + 12, gap = 6;
            using (StringFormat one = new StringFormat(StringFormatFlags.NoWrap))
            {
                one.Trimming = StringTrimming.EllipsisCharacter;
                foreach (KeyValuePair<string, Color> item in items)
                {
                    float tw = Math.Min(g.MeasureString(item.Key, font).Width, w - 34);
                    float cw = tw + 32;
                    if (cx > x && cx + cw > x + w)
                    {
                        cx = x;
                        y += rowH + gap;
                    }
                    if (draw)
                    {
                        RectangleF r = new RectangleF(cx, y, cw, rowH);
                        using (GraphicsPath p = Theme.Round(r, rowH / 2))
                        using (Pen pen = new Pen(item.Value, 1.4f))
                        using (SolidBrush dot = new SolidBrush(item.Value))
                        using (SolidBrush text = new SolidBrush(Theme.Text))
                        {
                            g.DrawPath(pen, p);
                            g.FillEllipse(dot, cx + 10, y + rowH / 2 - 4, 8, 8);
                            g.DrawString(item.Key, font, text, new RectangleF(cx + 22, y + 5, tw + 4, rowH - 6), one);
                        }
                    }
                    cx += cw + gap;
                }
            }
            return y + rowH + 4;
        }
    }

    class MainForm : Form
    {
        string dir;
        readonly ArchCanvas canvas = new ArchCanvas();
        readonly SidePanel side = new SidePanel();
        readonly Panel sideHost = new Panel();
        readonly Label pathLabel = new Label();
        readonly Timer timer = new Timer();
        DateTime boardStamp = DateTime.MinValue, liveStamp = DateTime.MinValue;
        BoardData board;
        LiveData live;

        public MainForm(string folder)
        {
            Text = "專案看板";
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = new Font(Theme.Ui, 10);
            Size = new Size(1400, 860);
            StartPosition = FormStartPosition.CenterScreen;
            KeyPreview = true;

            FlowLayoutPanel bar = new FlowLayoutPanel();
            bar.Dock = DockStyle.Top;
            bar.Height = 44;
            bar.BackColor = Theme.Bar;
            bar.Padding = new Padding(8, 6, 8, 6);
            bar.WrapContents = false;
            bar.Controls.Add(MakeButton("選擇專案…", delegate { Choose(); }));
            bar.Controls.Add(MakeButton("重新整理", delegate { Reload(true); }));
            bar.Controls.Add(MakeButton("符合視窗", delegate { canvas.Fit(); }));
            bar.Controls.Add(MakeButton("放大 +", delegate { canvas.ZoomCenter(1.2f); }));
            bar.Controls.Add(MakeButton("縮小 −", delegate { canvas.ZoomCenter(1 / 1.2f); }));
            canvas.Style = Program.SavedStyle();
            Button styleButton = MakeButton(StyleLabel(), null);
            styleButton.Click += delegate
            {
                canvas.SetStyle(canvas.Style == ArchStyle.Flow ? ArchStyle.Notion : ArchStyle.Flow);
                Program.SaveStyle(canvas.Style);
                styleButton.Text = StyleLabel();
            };
            styleButton.Margin = new Padding(12, 0, 6, 0);
            bar.Controls.Add(styleButton);
            pathLabel.AutoSize = true;
            pathLabel.ForeColor = Theme.Muted;
            pathLabel.Margin = new Padding(12, 8, 0, 0);
            bar.Controls.Add(pathLabel);

            SplitContainer split = new SplitContainer();
            split.Dock = DockStyle.Fill;
            split.BackColor = Theme.Line;
            split.SplitterWidth = 2;
            split.FixedPanel = FixedPanel.Panel2;
            canvas.Dock = DockStyle.Fill;
            split.Panel1.Controls.Add(canvas);
            sideHost.Dock = DockStyle.Fill;
            sideHost.AutoScroll = true;
            sideHost.BackColor = Theme.Side;
            side.Location = new Point(0, 0);
            sideHost.Controls.Add(side);
            sideHost.Resize += delegate
            {
                side.Width = sideHost.ClientSize.Width;
                side.SetData(board, null);
            };
            split.Panel2.Controls.Add(sideHost);

            Controls.Add(split);
            Controls.Add(bar);
            Load += delegate
            {
                split.SplitterDistance = Math.Max(300, split.Width - 380);
                Open(folder);
            };

            timer.Interval = 1500;
            timer.Tick += delegate { Reload(false); };
            timer.Start();
        }

        [DllImport("dwmapi.dll")]
        static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

        // 深色標題列（Windows 10 1809 以後；舊版忽略）。
        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            int on = 1;
            try
            {
                if (DwmSetWindowAttribute(Handle, 20, ref on, 4) != 0) DwmSetWindowAttribute(Handle, 19, ref on, 4);
            }
            catch { }
        }

        string StyleLabel()
        {
            return canvas.Style == ArchStyle.Flow ? "樣式：流程圖 ⇄" : "樣式：Notion ⇄";
        }

        Button MakeButton(string text, EventHandler onClick)
        {
            Button b = new Button();
            b.Text = text;
            b.AutoSize = true;
            b.FlatStyle = FlatStyle.Flat;
            b.FlatAppearance.BorderColor = Theme.Line;
            b.BackColor = Theme.LayerFill;
            b.ForeColor = Theme.Text;
            b.Margin = new Padding(0, 0, 6, 0);
            if (onClick != null) b.Click += onClick;
            return b;
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            if (keyData == Keys.F5) { Reload(true); return true; }
            if (keyData == (Keys.Control | Keys.D0)) { canvas.Fit(); return true; }
            if (keyData == (Keys.Control | Keys.Oemplus)) { canvas.ZoomCenter(1.2f); return true; }
            if (keyData == (Keys.Control | Keys.OemMinus)) { canvas.ZoomCenter(1 / 1.2f); return true; }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        void Choose()
        {
            using (FolderBrowserDialog dialog = new FolderBrowserDialog())
            {
                dialog.Description = "選擇專案資料夾";
                if (dir != null && Directory.Exists(dir)) dialog.SelectedPath = dir;
                if (dialog.ShowDialog(this) == DialogResult.OK) Open(dialog.SelectedPath);
            }
        }

        void Open(string folder)
        {
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder))
            {
                Choose();
                return;
            }
            dir = folder;
            Program.Remember(folder);
            pathLabel.Text = folder;
            board = null;
            live = null;
            Reload(true);
            canvas.Fit();
        }

        void Reload(bool force)
        {
            if (dir == null) return;
            string boardPath = Path.Combine(dir, ".claude", "project-board.json");
            string livePath = Path.Combine(dir, ".claude", "project-board-live.json");
            DateTime bs = File.Exists(boardPath) ? File.GetLastWriteTimeUtc(boardPath) : DateTime.MinValue;
            DateTime ls = File.Exists(livePath) ? File.GetLastWriteTimeUtc(livePath) : DateTime.MinValue;
            bool changed = false;
            if (force || bs != boardStamp || board == null)
            {
                BoardData next = Loader.Board(boardPath);
                if (next.Error == null || board == null || force || bs == DateTime.MinValue)
                {
                    board = next;
                    canvas.SetData(board);
                }
                boardStamp = bs;
                changed = true;
            }
            if (force || ls != liveStamp || live == null)
            {
                LiveData next = Loader.Live(livePath);
                if (next != null) live = next;
                liveStamp = ls;
                changed = true;
            }
            if (changed)
            {
                side.Width = sideHost.ClientSize.Width;
                side.SetData(board, live);
                string name = board != null && board.Name != "" ? board.Name : Path.GetFileName(dir);
                Text = "專案看板 - " + name;
            }
        }
    }

    static class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        static string AppFile(string name)
        {
            string folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ProjectBoard");
            Directory.CreateDirectory(folder);
            return Path.Combine(folder, name);
        }

        static string StatePath
        {
            get { return AppFile("last-project.txt"); }
        }

        // 命令列 --style notion|flow 優先，其次是上次選的樣式。
        static string styleArg;

        public static ArchStyle SavedStyle()
        {
            string value = styleArg;
            if (value == null)
            {
                try { if (File.Exists(AppFile("style.txt"))) value = File.ReadAllText(AppFile("style.txt")).Trim(); }
                catch { }
            }
            return value == "flow" ? ArchStyle.Flow : ArchStyle.Notion;
        }

        public static void SaveStyle(ArchStyle style)
        {
            try { File.WriteAllText(AppFile("style.txt"), style == ArchStyle.Notion ? "notion" : "flow"); }
            catch { }
        }

        public static void Remember(string folder)
        {
            try { File.WriteAllText(StatePath, folder, Encoding.UTF8); }
            catch { }
        }

        [STAThread]
        static void Main(string[] args)
        {
            try { SetProcessDPIAware(); }
            catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string folder = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--style" && i + 1 < args.Length) styleArg = args[++i];
                else folder = args[i].Trim('"');
            }
            if (folder == null)
            {
                try { if (File.Exists(StatePath)) folder = File.ReadAllText(StatePath, Encoding.UTF8).Trim(); }
                catch { }
            }
            Application.Run(new MainForm(folder));
        }
    }
}
