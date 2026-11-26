// Package gui 提供 Fyne 桌面工作台：站点管理、Markdown 编辑、实时预览与构建。
package gui

import (
	"context"
	_ "embed"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"xfmdesk/internal/frontmatter"
	"xfmdesk/internal/plugin"
	"xfmdesk/internal/publish"
	"xfmdesk/internal/scaffold"
	xsite "xfmdesk/internal/site"
)

// App 是桌面应用状态。
type App struct {
	fyneApp fyne.App
	win     fyne.Window

	root    string
	files   []string
	current string
	loading bool

	list   *widget.List
	editor *widget.Entry
	rich   *widget.RichText
	status *widget.Label

	previewSrv *http.Server
	previewURL string
	debounce   *time.Timer
}

//go:embed assets/icon.png
var iconPNG []byte

// Run 启动桌面应用。
func Run() {
	// 确保存在可用的 D-Bus 会话总线，避免 Fyne 启动时因缺少 dbus-launch 报错。
	cleanupSession := ensureDesktopSession()
	defer cleanupSession()

	a := &App{fyneApp: app.NewWithID("pw.lovou.xfm.desktop")}
	icon := fyne.NewStaticResource("icon.png", iconPNG)
	a.fyneApp.SetIcon(icon)
	a.win = a.fyneApp.NewWindow("xfm 桌面版 · 静态博客工作台")
	a.win.SetIcon(icon)
	a.buildUI()
	a.win.Resize(fyne.NewSize(1180, 760))
	a.win.SetOnClosed(func() {
		if a.previewSrv != nil {
			_ = a.previewSrv.Close()
		}
	})
	a.win.ShowAndRun()
}

func (a *App) buildUI() {
	toolbar := a.buildToolbar()

	a.list = widget.NewList(
		func() int { return len(a.files) },
		func() fyne.CanvasObject { return widget.NewLabel("") },
		func(id widget.ListItemID, o fyne.CanvasObject) {
			if id >= 0 && id < len(a.files) {
				o.(*widget.Label).SetText(a.files[id])
			}
		},
	)
	a.list.OnSelected = func(id widget.ListItemID) {
		if id >= 0 && id < len(a.files) {
			a.openFile(a.files[id])
		}
	}

	a.editor = widget.NewMultiLineEntry()
	a.editor.TextStyle = fyne.TextStyle{Monospace: true}
	a.editor.Wrapping = fyne.TextWrapWord
	a.editor.OnChanged = func(string) { a.schedulePreview() }

	a.rich = widget.NewRichText()
	a.rich.Wrapping = fyne.TextWrapWord

	a.status = widget.NewLabel("请打开一个站点（工具栏 → 打开文件夹），或新建站点")

	left := container.NewBorder(
		widget.NewLabelWithStyle("内容文件", fyne.TextAlignLeading, fyne.TextStyle{Bold: true}),
		nil, nil, nil,
		a.list,
	)
	right := container.NewHSplit(
		container.NewMax(a.editor),
		container.NewVScroll(a.rich),
	)
	right.SetOffset(0.52)
	body := container.NewHSplit(container.NewMax(left), right)
	body.SetOffset(0.2)

	a.win.SetContent(container.NewBorder(toolbar, a.status, nil, nil, body))
}

// buildToolbar 用「图标 + 文字」的按钮，鼠标悬停不再是唯一线索；
// 窗口变窄时整行可以横向滚动。
func (a *App) buildToolbar() fyne.CanvasObject {
	btn := func(label string, icon fyne.Resource, fn func()) fyne.CanvasObject {
		b := widget.NewButtonWithIcon(label, icon, fn)
		b.Importance = widget.LowImportance
		return b
	}
	row := container.NewHBox(
		btn("打开站点", theme.FolderOpenIcon(), a.openSite),
		btn("新建文章", theme.DocumentCreateIcon(), a.newPost),
		btn("新建站点", theme.FolderNewIcon(), a.newSite),
		btn("保存", theme.DocumentSaveIcon(), a.saveFile),
		btn("构建", theme.ConfirmIcon(), a.buildSite),
		btn("预览", theme.MediaPlayIcon(), a.previewBrowser),
		btn("发布", theme.UploadIcon(), a.publishSite),
		btn("发布设置", theme.AccountIcon(), a.editPublishSettings),
		btn("刷新", theme.ViewRefreshIcon(), a.refreshFiles),
		btn("插件", theme.SettingsIcon(), a.managePlugins),
	)
	return container.NewHScroll(row)
}

// ---------- 站点 ----------

func (a *App) openSite() {
	dialog.ShowFolderOpen(func(lu fyne.ListableURI, err error) {
		if err != nil || lu == nil {
			return
		}
		a.setRoot(lu.Path())
	}, a.win)
}

func (a *App) setRoot(root string) {
	a.root = root
	a.current = ""
	a.refreshFiles()
	a.setStatus("已打开：" + root)
}

func (a *App) refreshFiles() {
	if a.root == "" {
		a.setStatus("尚未打开站点")
		return
	}
	contentDir := filepath.Join(a.root, "content")
	var files []string
	_ = filepath.Walk(contentDir, func(p string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(p))
		if ext == ".md" || ext == ".markdown" || ext == ".html" || ext == ".htm" {
			if rel, e := filepath.Rel(a.root, p); e == nil {
				files = append(files, filepath.ToSlash(rel))
			}
		}
		return nil
	})
	sort.Strings(files)
	a.files = files
	a.list.Refresh()
	a.setStatus(fmt.Sprintf("共 %d 个内容文件", len(files)))
}

func (a *App) openFile(rel string) {
	if a.root == "" {
		return
	}
	abs := filepath.Join(a.root, filepath.FromSlash(rel))
	data, err := os.ReadFile(abs)
	if err != nil {
		a.setStatus("读取失败：" + err.Error())
		return
	}
	a.loading = true
	a.editor.SetText(string(data))
	a.loading = false
	a.current = abs
	a.win.SetTitle("xfm 桌面版 · " + rel)
	a.updatePreviewNow()
	a.setStatus("编辑：" + rel)
}

func (a *App) saveFile() {
	if a.current == "" {
		a.setStatus("没有打开的文件")
		return
	}
	if err := os.WriteFile(a.current, []byte(a.editor.Text), 0o644); err != nil {
		a.setStatus("保存失败：" + err.Error())
		return
	}
	a.setStatus("已保存：" + a.current)
}

func (a *App) newSite() {
	dirEntry := widget.NewEntry()
	dirEntry.SetPlaceHolder("例如：/home/me/my-blog")
	titleEntry := widget.NewEntry()
	titleEntry.SetPlaceHolder("我的博客")
	form := widget.NewForm(
		widget.NewFormItem("目录", dirEntry),
		widget.NewFormItem("标题", titleEntry),
	)
	dialog.ShowCustomConfirm("新建站点", "创建", "取消", form, func(ok bool) {
		if !ok {
			return
		}
		dir := strings.TrimSpace(dirEntry.Text)
		if dir == "" {
			a.setStatus("请填写站点目录")
			return
		}
		a.setStatus("正在创建站点…")
		go func() {
			err := scaffold.Create(scaffold.CreateOptions{Dir: dir, Title: strings.TrimSpace(titleEntry.Text), Template: "blog"})
			fyne.Do(func() {
				if err != nil {
					dialog.ShowError(err, a.win)
					a.setStatus("创建失败：" + err.Error())
					return
				}
				a.setRoot(dir)
			})
		}()
	}, a.win)
}

// ---------- 新建文章 ----------

// newPost 在 content/<目录> 下创建一篇带 front matter 的 Markdown 文章。
func (a *App) newPost() {
	if a.root == "" {
		a.setStatus("请先打开站点")
		return
	}
	cfg, err := xsite.LoadConfig(a.root)
	if err != nil {
		dialog.ShowError(err, a.win)
		return
	}
	contentDir := cfg.Str("contentDir")
	if contentDir == "" {
		contentDir = "content"
	}
	root := a.root

	dirEntry := widget.NewEntry()
	dirEntry.SetText("posts")
	dirEntry.SetPlaceHolder("posts")
	titleEntry := widget.NewEntry()
	titleEntry.SetPlaceHolder("文章标题")
	slugEntry := widget.NewEntry()
	slugEntry.SetPlaceHolder("留空则按标题生成")
	tagsEntry := widget.NewEntry()
	tagsEntry.SetPlaceHolder("用逗号分隔，可留空")
	draftCheck := widget.NewCheck("存为草稿（draft: true）", nil)
	draftCheck.SetChecked(true)

	form := widget.NewForm(
		widget.NewFormItem("目录", dirEntry),
		widget.NewFormItem("标题", titleEntry),
		widget.NewFormItem("文件名", slugEntry),
		widget.NewFormItem("标签", tagsEntry),
		widget.NewFormItem("", draftCheck),
	)
	dialog.ShowCustomConfirm("新建文章", "创建", "取消", form, func(ok bool) {
		if !ok {
			return
		}
		title := strings.TrimSpace(titleEntry.Text)
		if title == "" {
			dialog.ShowError(fmt.Errorf("标题不能为空"), a.win)
			return
		}
		slug := slugify(slugEntry.Text)
		if slug == "" {
			slug = slugify(title)
		}
		if slug == "" {
			slug = time.Now().Format("20060102-150405")
		}
		relDir := contentDir
		if sub := strings.Trim(strings.TrimSpace(dirEntry.Text), "/"); sub != "" {
			relDir = filepath.ToSlash(filepath.Join(contentDir, sub))
		}
		dirAbs := filepath.Join(root, filepath.FromSlash(relDir))
		if err := os.MkdirAll(dirAbs, 0o755); err != nil {
			dialog.ShowError(err, a.win)
			return
		}
		abs := filepath.Join(dirAbs, uniquePostName(dirAbs, slug))
		doc := buildPostDocument(title, tagsEntry.Text, draftCheck.Checked)
		if err := os.WriteFile(abs, []byte(doc), 0o644); err != nil {
			dialog.ShowError(err, a.win)
			return
		}
		a.refreshFiles()
		rel, _ := filepath.Rel(root, abs)
		rel = filepath.ToSlash(rel)
		a.openFile(rel)
		a.setStatus("已创建：" + rel)
	}, a.win)
}

func uniquePostName(dir, slug string) string {
	name := slug + ".md"
	for i := 2; i < 1000; i++ {
		if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
			return name
		}
		name = fmt.Sprintf("%s-%d.md", slug, i)
	}
	return fmt.Sprintf("%s-%d.md", slug, time.Now().Unix())
}

// slugify 保留数字、英文字母与中文，空白和连接符转为单个短横线。
func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	var b strings.Builder
	dash := false
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			dash = false
		case r > 127:
			b.WriteRune(r)
			dash = false
		case r == ' ' || r == '-' || r == '_':
			if !dash && b.Len() > 0 {
				b.WriteByte('-')
				dash = true
			}
		}
	}
	return strings.Trim(b.String(), "-")
}

func buildPostDocument(title, tags string, draft bool) string {
	var b strings.Builder
	b.WriteString("---\n")
	fmt.Fprintf(&b, "title: %q\n", title)
	b.WriteString("date: " + time.Now().Format("2006-01-02 15:04") + "\n")
	var list []string
	for _, t := range strings.FieldsFunc(tags, func(r rune) bool { return r == ',' || r == '，' }) {
		t = strings.Trim(strings.TrimSpace(t), "[]")
		if t != "" {
			list = append(list, t)
		}
	}
	if len(list) > 0 {
		b.WriteString("tags: [" + strings.Join(list, ", ") + "]\n")
	}
	if draft {
		b.WriteString("draft: true\n")
	}
	b.WriteString("---\n\n")
	b.WriteString("# " + title + "\n\n")
	return b.String()
}

// ---------- 构建 / 预览 ----------

func (a *App) buildSite() {
	if a.root == "" {
		a.setStatus("请先打开或新建站点")
		return
	}
	a.setStatus("正在构建…")
	root := a.root
	go func() {
		s, err := xsite.BuildSite(root, "production")
		fyne.Do(func() {
			if err != nil {
				dialog.ShowError(err, a.win)
				a.setStatus("构建失败：" + err.Error())
				return
			}
			a.setStatus(fmt.Sprintf("构建完成：%d 页，%d 个静态资源，输出 %d 个文件", s.Stats.Pages, s.Stats.Assets, s.Stats.Written))
		})
	}()
}

func (a *App) previewBrowser() {
	if a.root == "" {
		a.setStatus("请先打开或新建站点")
		return
	}
	root := a.root
	a.setStatus("正在构建并启动预览…")
	go func() {
		_, err := xsite.BuildSite(root, "production")
		if err != nil {
			fyne.Do(func() { a.setStatus("构建失败：" + err.Error()) })
			return
		}
		port := 4173
		dist := filepath.Join(root, "dist")
		fyne.Do(func() {
			if a.previewURL == "" {
				u, srv, serr := xsite.Serve(dist, port)
				if serr != nil {
					a.setStatus("预览服务启动失败：" + serr.Error())
					return
				}
				a.previewURL = u
				a.previewSrv = srv
			}
			if pu, perr := url.Parse(a.previewURL); perr == nil {
				_ = a.fyneApp.OpenURL(pu)
			}
			a.setStatus("浏览器预览：" + a.previewURL)
		})
	}()
}

// ---------- 实时预览 ----------

func (a *App) schedulePreview() {
	if a.loading {
		return
	}
	if a.debounce != nil {
		a.debounce.Stop()
	}
	a.debounce = time.AfterFunc(250*time.Millisecond, func() {
		fyne.Do(a.updatePreviewNow)
	})
}

func (a *App) updatePreviewNow() {
	fm := frontmatter.Parse(a.editor.Text)
	body := fm.Content
	title := ""
	if t, ok := fm.Data["title"]; ok {
		title = fmt.Sprintf("%v", t)
	}
	md := body
	if title != "" {
		md = "# " + title + "\n\n" + body
	}
	a.rich.ParseMarkdown(md)
	a.rich.Refresh()
}

func (a *App) setStatus(msg string) {
	a.status.SetText(msg)
}

// managePlugins 打开插件管理面板：勾选即启用，写入 plugins/<name>.json。
func (a *App) managePlugins() {
	if a.root == "" {
		a.setStatus("请先打开站点")
		return
	}
	cfg, err := xsite.LoadConfig(a.root)
	if err != nil {
		dialog.ShowError(err, a.win)
		return
	}
	entries := plugin.Status(a.root, cfg.Raw)
	checks := make([]*widget.Check, len(entries))
	box := container.NewVBox()
	for i, e := range entries {
		label := e.Name
		if e.Core {
			label += "（核心）"
		}
		c := widget.NewCheck(label, nil)
		c.SetChecked(e.Enabled)
		checks[i] = c
		box.Add(c)
	}
	content := container.NewVScroll(box)
	content.SetMinSize(fyne.NewSize(320, 420))
	d := dialog.NewCustomConfirm("插件管理（勾选即启用）", "保存", "取消", content, func(ok bool) {
		if !ok {
			return
		}
		changed := 0
		for i, e := range entries {
			if checks[i].Checked == e.Enabled {
				continue
			}
			if err := plugin.SetEnabled(a.root, e.Name, checks[i].Checked); err != nil {
				dialog.ShowError(err, a.win)
				return
			}
			changed++
		}
		a.setStatus(fmt.Sprintf("插件配置已更新（%d 项），重新构建后生效", changed))
	}, a.win)
	d.Resize(fyne.NewSize(360, 520))
	d.Show()
}

// publishLabels 是平台标识 → 展示名。
var publishLabels = map[string]string{
	publish.TargetGitHub:     "GitHub Pages",
	publish.TargetCloudflare: "Cloudflare Pages",
	publish.TargetNetlify:    "Netlify",
	publish.TargetVercel:     "Vercel",
}

func publishLabel(name string) string {
	if l, ok := publishLabels[name]; ok {
		return l
	}
	return name
}

// publishSite 构建站点并分发到勾选的平台；凭据从环境变量读取。
func (a *App) publishSite() {
	if a.root == "" {
		a.setStatus("请先打开站点")
		return
	}
	root := a.root
	cfg, err := publish.Load(root)
	if err != nil {
		dialog.ShowError(err, a.win)
		return
	}
	// 面板总是列出全部平台，配置文件里的 publish.targets 作为默认勾选
	names := publish.All()
	checks := make([]*widget.Check, len(names))
	box := container.NewVBox(widget.NewLabel("选择要发布的平台（凭据可在「发布设置」中填写，环境变量优先）："))
	for i, name := range names {
		c := widget.NewCheck(publishLabel(name), nil)
		c.SetChecked(containsStr(cfg.Targets, name))
		checks[i] = c
		box.Add(c)
	}
	content := container.NewVScroll(box)
	content.SetMinSize(fyne.NewSize(320, 220))
	d := dialog.NewCustomConfirm("发布站点", "构建并发布", "取消", content, func(ok bool) {
		if !ok {
			return
		}
		var selected []string
		for i, name := range names {
			if checks[i].Checked {
				selected = append(selected, name)
			}
		}
		if len(selected) == 0 {
			a.setStatus("没有选择发布平台")
			return
		}
		a.setStatus("正在构建…")
		go func() {
			s, buildErr := xsite.BuildSite(root, "production")
			if buildErr != nil {
				fyne.Do(func() {
					dialog.ShowError(buildErr, a.win)
					a.setStatus("发布中止：构建失败")
				})
				return
			}
			dist := filepath.Join(root, s.Cfg.Str("outDir"))
			fyne.Do(func() {
				a.setStatus(fmt.Sprintf("构建完成（%d 页），开始发布…", s.Stats.Pages))
			})
			outcomes := publish.Run(context.Background(), cfg, publish.Options{
				DistDir: dist,
				Root:    root,
				Targets: selected,
				Log: func(msg string) {
					fyne.Do(func() { a.setStatus(msg) })
				},
			})
			fyne.Do(func() { a.showPublishResults(outcomes) })
		}()
	}, a.win)
	d.Resize(fyne.NewSize(380, 300))
	d.Show()
}

// editPublishSettings 配置各平台凭据：Token 存本机，其余字段按站点保存。
func (a *App) editPublishSettings() {
	if a.root == "" {
		a.setStatus("请先打开站点")
		return
	}
	cfg, err := publish.Load(a.root)
	if err != nil {
		dialog.ShowError(err, a.win)
		return
	}
	s := cfg.Settings()
	root := a.root

	ghRepo := settingEntry(s.GitHub.Repo, "owner/repo")
	ghBranch := settingEntry(s.GitHub.Branch, "gh-pages")
	ghToken := secretEntry(s.GitHub.Token)

	cfAccount := settingEntry(s.Cloudflare.AccountID, "Account ID")
	cfProject := settingEntry(s.Cloudflare.Project, "项目名")
	cfBranch := settingEntry(s.Cloudflare.Branch, "main")
	cfToken := secretEntry(s.Cloudflare.Token)

	nfSite := settingEntry(s.Netlify.SiteID, "Site ID")
	nfToken := secretEntry(s.Netlify.Token)

	vcProject := settingEntry(s.Vercel.Project, "项目名")
	vcTeam := settingEntry(s.Vercel.TeamID, "Team ID（可选）")
	vcToken := secretEntry(s.Vercel.Token)

	hint := widget.NewLabel("Token 保存在用户配置目录（权限 0600），不写入站点；站点配置与环境变量优先级更高。")
	hint.Wrapping = fyne.TextWrapWord

	form := container.NewVBox(
		settingTitle("GitHub Pages"),
		widget.NewForm(
			widget.NewFormItem("仓库", ghRepo),
			widget.NewFormItem("分支", ghBranch),
			widget.NewFormItem("Token", ghToken),
		),
		widget.NewSeparator(),
		settingTitle("Cloudflare Pages"),
		widget.NewForm(
			widget.NewFormItem("Account ID", cfAccount),
			widget.NewFormItem("项目", cfProject),
			widget.NewFormItem("分支", cfBranch),
			widget.NewFormItem("Token", cfToken),
		),
		widget.NewSeparator(),
		settingTitle("Netlify"),
		widget.NewForm(
			widget.NewFormItem("Site ID", nfSite),
			widget.NewFormItem("Token", nfToken),
		),
		widget.NewSeparator(),
		settingTitle("Vercel"),
		widget.NewForm(
			widget.NewFormItem("项目", vcProject),
			widget.NewFormItem("Team ID", vcTeam),
			widget.NewFormItem("Token", vcToken),
		),
		widget.NewSeparator(),
		hint,
	)
	content := container.NewVScroll(form)
	content.SetMinSize(fyne.NewSize(520, 560))
	d := dialog.NewCustomConfirm("发布设置", "保存", "取消", content, func(ok bool) {
		if !ok {
			return
		}
		out := publish.Settings{
			GitHub: publish.GitHubSettings{
				Repo:   ghRepo.Text,
				Branch: ghBranch.Text,
				Token:  ghToken.Text,
			},
			Cloudflare: publish.CloudflareSettings{
				AccountID: cfAccount.Text,
				Project:   cfProject.Text,
				Branch:    cfBranch.Text,
				Token:     cfToken.Text,
			},
			Netlify: publish.NetlifySettings{
				SiteID: nfSite.Text,
				Token:  nfToken.Text,
			},
			Vercel: publish.VercelSettings{
				Project: vcProject.Text,
				TeamID:  vcTeam.Text,
				Token:   vcToken.Text,
			},
		}
		if err := publish.SaveSettings(root, out); err != nil {
			dialog.ShowError(err, a.win)
			return
		}
		a.setStatus("发布设置已保存（Token 存于本机配置目录）")
	}, a.win)
	d.Resize(fyne.NewSize(560, 660))
	d.Show()
}

func settingEntry(value, placeholder string) *widget.Entry {
	e := widget.NewEntry()
	e.SetText(value)
	e.SetPlaceHolder(placeholder)
	return e
}

func secretEntry(value string) *widget.Entry {
	e := widget.NewPasswordEntry()
	e.SetText(value)
	return e
}

func settingTitle(text string) fyne.CanvasObject {
	return widget.NewLabelWithStyle(text, fyne.TextAlignLeading, fyne.TextStyle{Bold: true})
}

func (a *App) showPublishResults(outcomes []publish.Outcome) {
	var lines []string
	failed := 0
	for _, o := range outcomes {
		if o.Err != nil {
			lines = append(lines, fmt.Sprintf("✗ %s\n%s", publishLabel(o.Target), o.Err.Error()))
			failed++
			continue
		}
		lines = append(lines, fmt.Sprintf("✓ %s\n%s", publishLabel(o.Target), o.Result.URL))
	}
	title := "发布完成"
	if failed > 0 {
		title = fmt.Sprintf("发布完成（%d 个失败）", failed)
		a.setStatus(title)
	} else {
		a.setStatus("发布完成")
	}
	label := widget.NewLabel(strings.Join(lines, "\n\n"))
	label.Wrapping = fyne.TextWrapWord
	dialog.ShowCustom(title, "关闭", container.NewVScroll(label), a.win)
}

func containsStr(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
