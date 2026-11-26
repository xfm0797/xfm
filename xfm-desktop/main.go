// xfm 桌面版：基于 Fyne 的静态博客工作台 + CLI 入口（纯 Go 重写内核）。
package main

import (
	"fmt"
	"os"
	"path/filepath"

	xsite "xfmdesk/internal/site"
	"xfmdesk/internal/gui"
	"xfmdesk/internal/scaffold"
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
	switch cmd {
	case "build":
		dir := "."
		if len(args) > 1 {
			dir = args[1]
		}
		return cmdBuild(dir)
	case "create", "new", "init":
		if len(args) < 2 {
			return fmt.Errorf("用法：xfm create <目录> [blog|docs]")
		}
		dir := args[1]
		tpl := "blog"
		if len(args) > 2 {
			tpl = args[2]
		}
		return cmdCreate(dir, tpl)
	case "serve", "dev":
		dir := "."
		if len(args) > 1 {
			dir = args[1]
		}
		return cmdServe(dir)
	case "version", "-v", "--version":
		fmt.Println("xfm 桌面版 · 纯 Go 重写内核")
		return nil
	case "help", "-h", "--help":
		printHelp()
		return nil
	default:
		return fmt.Errorf("未知命令 %q，可用：build / create / serve", cmd)
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

func printHelp() {
	fmt.Println(`xfm 桌面版 — 基于 Fyne 的静态博客工作台（纯 Go 重写）

用法：
  xfm                  启动桌面 GUI
  xfm build [目录]     构建站点（默认当前目录）
  xfm create <目录> [模板]  新建站点脚手架（blog 或 docs，默认 blog）
  xfm serve [目录]     构建并启动预览服务器（默认 http://127.0.0.1:4173）
  xfm version          版本信息
  xfm help             本帮助`)
}
