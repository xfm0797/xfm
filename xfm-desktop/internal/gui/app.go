// Package gui 提供 Fyne 桌面工作台：站点管理、Markdown 编辑、实时预览与构建。
package gui

import (
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

// Run 启动桌面应用。
func Run() {
	a := &App{fyneApp: app.NewWithID("pw.lovou.xfm.desktop")}
	a.win = a.fyneApp.NewWindow("xfm 桌面版 · 静态博客工作台")
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
	toolbar := widget.NewToolbar(
		widget.NewToolbarAction(theme.FolderOpenIcon(), a.openSite),
		widget.NewToolbarAction(theme.DocumentCreateIcon(), a.newSite),
		widget.NewToolbarSeparator(),
		widget.NewToolbarAction(theme.DocumentSaveIcon(), a.saveFile),
		widget.NewToolbarAction(theme.ConfirmIcon(), a.buildSite),
		widget.NewToolbarAction(theme.MediaPlayIcon(), a.previewBrowser),
		widget.NewToolbarSeparator(),
		widget.NewToolbarAction(theme.ViewRefreshIcon(), a.refreshFiles),
	)

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
