// xfm 桌面版：基于 Fyne 的静态博客工作台 + CLI（纯 Go 重写内核）。
// 主题/插件等资源从外部目录动态加载，不再嵌入二进制。
package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"xfmdesk/assets"
	"xfmdesk/internal/gui"
	"xfmdesk/internal/plugin"
	"xfmdesk/internal/scaffold"
	xsite "xfmdesk/internal/site"
)

func main() {
	if len(os.Args) > 1 {
		if err := runCLI(os.Args[1:]); err != nil {
			fmt.Fprintln(os.Stderr, "xfm:", err)
			os.Exit(1)
		}
		return
	}
	gui.Run()
}

func runCLI(args []string) error {
	cmd := args[0]
	rest := args[1:]
	switch cmd {
	case "build":
		dir := "."
		if len(rest) > 0 {
			dir = rest[0]
		}
		return cmdBuild(dir)
	case "create", "new", "init":
		if len(rest) < 1 {
			return fmt.Errorf("用法：xfm create <目录> [blog|docs]")
		}
		tpl := "blog"
		if len(rest) > 1 {
			tpl = rest[1]
		}
		return cmdCreate(rest[0], tpl)
	case "serve", "dev":
		dir := "."
		if len(rest) > 0 {
			dir = rest[0]
		}
		return cmdServe(dir)
	case "themes":
		return cmdThemes(rest)
	case "plugins":
		return cmdPlugins(rest)
	case "install-themes", "install":
		var src, dest string
		if len(rest) > 0 {
			src = rest[0]
		}
		if len(rest) > 1 {
			dest = rest[1]
		}
		return cmdInstallThemes(src, dest)
	case "version", "-v", "--version":
		fmt.Println("xfm 桌面版 · 纯 Go 重写内核（主题从外部目录加载）")
		return nil
	case "help", "-h", "--help":
		printHelp()
		return nil
	default:
		return fmt.Errorf("未知命令 %q，可用：build / create / serve / themes / install-themes", cmd)
	}
}

func cmdBuild(dir string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	fmt.Printf("⚡ xfm build  %s\n\n", abs)
	s, err := xsite.BuildSite(abs, "production")
	if err != nil {
		return fmt.Errorf("构建失败：%w", err)
	}
	fmt.Printf("  ✓ 页面      %d 个\n", s.Stats.Pages)
	fmt.Printf("  ✓ 静态资源  %d 个\n", s.Stats.Assets)
	fmt.Printf("  ✓ 输出文件  %d 个\n", s.Stats.Written)
	if s.Plugins != nil {
		if names := s.Plugins.Names(); len(names) > 0 {
			fmt.Printf("  ✓ 插件      %d 个（%s）\n", len(names), strings.Join(names, ", "))
		}
		for _, w := range s.Plugins.Warnings() {
			fmt.Println("  ⚠ " + w)
		}
	}
	fmt.Println()
	return nil
}

func cmdCreate(dir, tpl string) error {
	fmt.Printf("⚡ xfm create  %s (模板：%s)\n", dir, tpl)
	err := scaffold.Create(scaffold.CreateOptions{Dir: dir, Template: tpl})
	if err != nil {
		return fmt.Errorf("创建失败：%w", err)
	}
	abs, _ := filepath.Abs(dir)
	fmt.Printf("  ✓ 脚手架已创建：%s\n", abs)
	fmt.Println("  下一步：cd", dir, "&& xfm build")
	return nil
}

func cmdServe(dir string) error {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	fmt.Printf("⚡ xfm build  %s\n\n", abs)
	s, err := xsite.BuildSite(abs, "production")
	if err != nil {
		return fmt.Errorf("构建失败：%w", err)
	}
	fmt.Printf("  ✓ 页面 %d 个，资源 %d 个\n\n", s.Stats.Pages, s.Stats.Assets)
	dist := filepath.Join(abs, "dist")
	url, srv, err := xsite.Serve(dist, 4173)
	if err != nil {
		return fmt.Errorf("启动预览服务器失败：%w", err)
	}
	fmt.Printf("⚡ xfm serve  %s\n", url)
	fmt.Println("  Ctrl+C 停止")
	defer srv.Close()
	select {}
}

func cmdPlugins(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("用法：xfm plugins <站点目录> [enable|disable <插件名>]")
	}
	dir, err := filepath.Abs(args[0])
	if err != nil {
		return err
	}
	if len(args) >= 3 {
		name := args[2]
		var enabled bool
		switch args[1] {
		case "enable", "on", "启用":
			enabled = true
		case "disable", "off", "关闭":
			enabled = false
		default:
			return fmt.Errorf("未知操作 %q（可用：enable / disable）", args[1])
		}
		if err := plugin.SetEnabled(dir, name, enabled); err != nil {
			return err
		}
		state := "关闭"
		if enabled {
			state = "启用"
		}
		fmt.Printf("✓ 已%s插件 %s（写入 plugins/%s.json）\n", state, name, name)
	}

	cfg, err := xsite.LoadConfig(dir)
	if err != nil {
		return err
	}
	entries := plugin.Status(dir, cfg.Raw)
	fmt.Printf("⚡ 插件  %s\n\n", dir)
	for _, e := range entries {
		mark := "○"
		state := "关闭"
		if e.Enabled {
			mark = "●"
			state = "启用"
		}
		extra := ""
		if e.Core {
			extra += "  [核心]"
		}
		if e.HasManifest {
			extra += "  [清单]"
		}
		fmt.Printf("  %s %-14s %s%s\n", mark, e.Name, state, extra)
	}
	fmt.Println("\n用法：xfm plugins <站点目录> enable|disable <插件名>")
	fmt.Println("说明：核心插件（rss/sitemap/search/seo/minify）默认启用；其余默认关闭。")
	fmt.Println("      也可在 xfm.config.json 的 plugins 数组里启用；plugins/<name>.json 优先。")
	return nil
}

func cmdThemes(_ []string) error {
	resolver := assets.NewThemeResolver(".")
	fmt.Println("=== 主题搜索路径 ===")
	for i, p := range resolver.SearchPaths() {
		st := "不存在"
		if _, err := os.Stat(p.Dir); err == nil {
			st = "存在"
		}
		w := "只读"
		if p.Writable {
			w = "可写"
		}
		s := ""
		if p.Source {
			s = " · source"
		}
		fmt.Printf("  %d. [%s] %s  %s %s%s\n", i+1, w, st, p.Dir, p.Label, s)
	}
	fmt.Println()
	themes := resolver.ListDetailed()
	if len(themes) == 0 {
		fmt.Println("⚠  没有找到任何可用主题。请运行 `xfm install-themes` 安装官方主题。")
		fmt.Println("   也可以设置环境变量 XFM_THEMES_DIR=/path/to/themes 指定主题目录。")
		return nil
	}
	fmt.Printf("=== 可用主题 (%d) ===\n", len(themes))
	for _, t := range themes {
		fmt.Printf("  • %-12s  %s\n      ↳ 来自 %s\n", t.Name, t.Path, t.Source)
	}
	return nil
}

func cmdInstallThemes(src, dest string) error {
	resolver := assets.NewThemeResolver(".")
	destDir := dest
	if destDir == "" {
		d, err := resolver.WritablePath()
		if err != nil {
			return err
		}
		destDir = d
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return err
	}

	if src == "" {
		// 不带参数：把 exe 旁 source 路径里打包好的主题复制过来
		installed, err := resolver.InstallFromResolver(destDir)
		if err != nil {
			return err
		}
		if len(installed) == 0 {
			fmt.Println("⚠  没有可复制的内置主题。")
			fmt.Println("   请用 `xfm install-themes <src>` 指定一个包含 default/、docs/ 等子目录的 themes/ 目录。")
			return nil
		}
		fmt.Printf("✓ 已从 exe 旁 source 路径安装 %d 个主题到 %s：\n", len(installed), destDir)
		for _, n := range installed {
			fmt.Printf("  • %s\n", n)
		}
		return nil
	}

	// 带 src：判断它是单个主题还是主题集合目录
	absSrc, err := filepath.Abs(src)
	if err != nil {
		return err
	}
	if !assets.DirExists(absSrc) {
		return fmt.Errorf("源目录不存在：%s", absSrc)
	}

	// 集合目录：直接子目录里有主题布局
	if entries, err := os.ReadDir(absSrc); err == nil {
		var subThemes []string
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			sub := filepath.Join(absSrc, e.Name())
			if assets.HasThemeLayout(sub) {
				subThemes = append(subThemes, sub)
			}
		}
		if len(subThemes) > 0 {
			fmt.Printf("检测到主题集合目录，将安装 %d 个主题到 %s：\n", len(subThemes), destDir)
			for _, t := range subThemes {
				name := filepath.Base(t)
				target := filepath.Join(destDir, name)
				if assets.DirExists(target) {
					fmt.Printf("  • %s  (已存在，跳过)\n", name)
					continue
				}
				if err := assets.CopyTheme(t, destDir, name); err != nil {
					return fmt.Errorf("复制 %s 失败：%w", name, err)
				}
				fmt.Printf("  ✓ %s\n", name)
			}
			return nil
		}
	}

	// 单个主题
	if !assets.HasThemeLayout(absSrc) {
		return fmt.Errorf("%s 既不是主题目录也不是主题集合目录", absSrc)
	}
	name := filepath.Base(filepath.Clean(absSrc))
	target := filepath.Join(destDir, name)
	if assets.DirExists(target) {
		return fmt.Errorf("目标已存在：%s（如需覆盖请先删除）", target)
	}
	if err := assets.CopyTheme(absSrc, destDir, name); err != nil {
		return err
	}
	fmt.Printf("✓ 已安装主题 %s → %s\n", name, target)
	return nil
}

func printHelp() {
	fmt.Println(`xfm 桌面版 — 基于 Fyne 的静态博客工作台（纯 Go 重写，主题外部加载）

用法：
  xfm                         启动桌面 GUI
  xfm build [目录]            构建站点（默认当前目录）
  xfm create <目录> [模板]    新建站点脚手架（blog 或 docs，默认 blog）
  xfm serve [目录]            构建并启动预览服务器（http://127.0.0.1:4173）
  xfm themes                  列出所有可加载的主题及搜索路径
  xfm plugins <目录> [enable|disable <插件>]
                              查看内置插件并启用/关闭（写入 plugins/<name>.json）
  xfm install-themes [src] [dest]
                              安装外部主题：
                                不带参数 — 把可执行文件旁 themes/ 安装到用户缓存
                                xfm install-themes ./themes
                                xfm install-themes ./themes ~/my-themes
  xfm version                 版本信息
  xfm help                    本帮助

主题搜索路径（优先级从高到低）：
  1. 环境变量 XFM_THEMES_DIR
  2. 可执行文件旁的 themes/（分发目录）
  3. $XDG_DATA_HOME/xfm/themes 或 ~/.local/share/xfm/themes
  4. ~/.xfm/themes
  5. 站点自己的 themes/`)
}
