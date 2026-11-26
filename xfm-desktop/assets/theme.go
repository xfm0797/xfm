// Package assets 提供主题/插件等运行时外部资源的搜索与加载。
//
// 主题不再嵌入二进制，而是从一组搜索路径里解析：
//  1. 环境变量 XFM_THEMES_DIR（整个目录，而非 themes/<name>/）
//  2. 可执行文件旁的 themes/ 子目录（分发目录）
//  3. XDG_DATA_HOME/xfm/themes 或 ~/.local/share/xfm/themes（用户级缓存）
//  4. ~/.xfm/themes（home 回退）
//  5. 目标站点自身的 themes/ 子目录
//
// 运行时命令 `xfm install-themes <src>` 可把任意 themes 目录复制到
// 用户级缓存，`xfm themes` 列出所有可用主题。
package assets

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SearchPath 描述一个候选主题目录。
// 每个路径下应包含多个子目录，子目录名即主题名。
type SearchPath struct {
	Dir      string // 绝对路径
	Writable bool   // 是否允许写入（install / cache 回退）
	Source   bool   // 是否可以作为 install 的"源"（如 exe 旁的 themes/）
	Label    string // 展示用标签
}

// ThemeResolver 持有当前进程的搜索路径链。
type ThemeResolver struct {
	SiteRoot string
	paths    []SearchPath
}

// NewThemeResolver 构建默认的搜索路径链。
// 传入空的 siteRoot 时跳过站点本地路径。
func NewThemeResolver(siteRoot string) *ThemeResolver {
	r := &ThemeResolver{SiteRoot: siteRoot}

	// 1. 环境变量（最高优先级）
	if env := os.Getenv("XFM_THEMES_DIR"); env != "" {
		if abs, err := filepath.Abs(env); err == nil {
			if dirExists(abs) {
				r.paths = append(r.paths, SearchPath{Dir: abs, Label: "$XFM_THEMES_DIR"})
			}
		}
	}

	// 2. 可执行文件旁 themes/
	if exe, err := os.Executable(); err == nil {
		near := filepath.Join(filepath.Dir(exe), "themes")
		if abs, err := filepath.Abs(near); err == nil {
			if dirExists(abs) {
				r.paths = append(r.paths, SearchPath{Dir: abs, Source: true, Label: "<exe>/themes"})
			}
		}
	}

	// 3. 用户级缓存（XDG）
	xdgData := os.Getenv("XDG_DATA_HOME")
	if xdgData == "" {
		if home, err := os.UserHomeDir(); err == nil {
			xdgData = filepath.Join(home, ".local", "share")
		}
	}
	if xdgData != "" {
		xdgPath := filepath.Join(xdgData, "xfm", "themes")
		r.paths = append(r.paths, SearchPath{Dir: xdgPath, Writable: true, Label: "$XDG_DATA_HOME/xfm/themes"})
	}

	// 4. Home 回退
	if home, err := os.UserHomeDir(); err == nil {
		homePath := filepath.Join(home, ".xfm", "themes")
		r.paths = append(r.paths, SearchPath{Dir: homePath, Writable: true, Label: "~/.xfm/themes"})
	}

	// 5. 站点自身 themes/
	if siteRoot != "" {
		local := filepath.Join(siteRoot, "themes")
		r.paths = append(r.paths, SearchPath{Dir: local, Writable: true, Label: "site themes/"})
	}

	return r
}

// Resolve 在搜索路径链里查找名为 name 的主题，返回绝对目录。
// 找不到返回空字符串。name 可以是纯名字 "default" 或路径片段 "themes/default"。
func (r *ThemeResolver) Resolve(name string) string {
	clean := filepath.Base(filepath.ToSlash(name)) // 允许 themes/default / default 两种
	for _, p := range r.paths {
		candidate := filepath.Join(p.Dir, clean)
		if dirExists(candidate) {
			// 基本验证：主题目录至少要有 layouts/ 或 partials/ 或 base.html
			if hasThemeLayout(candidate) {
				return candidate
			}
		}
	}
	return ""
}

// List 扫描所有搜索路径，返回去重后的主题列表。
// 返回：name → 绝对路径。多个路径有同名主题时，优先级高的胜出。
func (r *ThemeResolver) List() map[string]string {
	out := map[string]string{}
	for _, p := range r.paths {
		entries, err := os.ReadDir(p.Dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			if _, dup := out[name]; dup {
				continue // 已被更高优先级路径占住
			}
			full := filepath.Join(p.Dir, name)
			if hasThemeLayout(full) {
				out[name] = full
			}
		}
	}
	return out
}

// ListDetailed 和 List 相同，但返回详情（带来源标签）。
func (r *ThemeResolver) ListDetailed() []ThemeInfo {
	seen := map[string]bool{}
	var out []ThemeInfo
	for _, p := range r.paths {
		entries, err := os.ReadDir(p.Dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			if seen[name] {
				continue
			}
			full := filepath.Join(p.Dir, name)
			if !hasThemeLayout(full) {
				continue
			}
			seen[name] = true
			out = append(out, ThemeInfo{Name: name, Path: full, Source: p.Label})
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

// SearchPaths 返回已解析的搜索路径（展示/调试用）。
func (r *ThemeResolver) SearchPaths() []SearchPath { return r.paths }

// WritablePath 返回第一个可写的搜索路径（用于 install / cache）。
func (r *ThemeResolver) WritablePath() (string, error) {
	for _, p := range r.paths {
		if !p.Writable {
			continue
		}
		if dirExists(p.Dir) {
			if testWritable(p.Dir) {
				return p.Dir, nil
			}
			continue
		}
		// 尝试创建
		if err := os.MkdirAll(p.Dir, 0o755); err == nil {
			return p.Dir, nil
		}
	}
	return "", fmt.Errorf("没有可用的可写主题目录；请设置 XFM_THEMES_DIR 或检查权限")
}

// CopyTheme 把已解析的 src 复制到 destDir/<name>/。
// src 必须是一个已存在的主题绝对目录（通常来自 Resolve 的返回值）。
func CopyTheme(src, destDir, name string) error {
	if !dirExists(src) {
		return fmt.Errorf("主题目录不存在：%s", src)
	}
	if name == "" {
		name = filepath.Base(src)
	}
	target := filepath.Join(destDir, name)
	if dirExists(target) {
		// 不覆盖已存在，除非用户自己删
		return fmt.Errorf("目标已存在：%s（如需覆盖请先手动删除）", target)
	}
	return copyDir(src, target)
}

// InstallTheme 从任意源目录安装主题到 resolver 的可写路径。
func (r *ThemeResolver) InstallTheme(src, destDirOverride string) (string, error) {
	if !dirExists(src) {
		return "", fmt.Errorf("源目录不存在：%s", src)
	}
	name := filepath.Base(filepath.Clean(src))
	destDir := destDirOverride
	if destDir == "" {
		d, err := r.WritablePath()
		if err != nil {
			return "", err
		}
		destDir = d
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return "", err
	}
	if err := CopyTheme(src, destDir, name); err != nil {
		return "", err
	}
	return filepath.Join(destDir, name), nil
}

// InstallFromResolver 把"源"路径里的所有主题复制到 destDir（install-themes 命令核心）。
func (r *ThemeResolver) InstallFromResolver(destDir string) ([]string, error) {
	if destDir == "" {
		d, err := r.WritablePath()
		if err != nil {
			return nil, err
		}
		destDir = d
	}
	if err := os.MkdirAll(destDir, 0o755); err != nil {
		return nil, err
	}
	var installed []string
	for _, p := range r.paths {
		if !p.Source {
			continue
		}
		entries, err := os.ReadDir(p.Dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			name := e.Name()
			src := filepath.Join(p.Dir, name)
			if !hasThemeLayout(src) {
				continue
			}
			target := filepath.Join(destDir, name)
			if dirExists(target) {
				continue // 已有，跳过
			}
			if err := copyDir(src, target); err != nil {
				return installed, err
			}
			installed = append(installed, name)
		}
	}
	return installed, nil
}

// ThemeInfo 主题详情。
type ThemeInfo struct {
	Name   string
	Path   string
	Source string // 来自哪个搜索路径
}

// ---------- 内部工具 ----------

func dirExists(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

// DirExists 公开的目录存在检查。
func DirExists(p string) bool { return dirExists(p) }

// HasThemeLayout 判断目录像不像主题。
func HasThemeLayout(p string) bool { return hasThemeLayout(p) }

// hasThemeLayout 简单判断目录像不像主题：有 layouts/ 或根目录有 base.html。
func hasThemeLayout(p string) bool {
	for _, probe := range []string{
		filepath.Join(p, "layouts"),
		filepath.Join(p, "base.html"),
	} {
		if dirExists(probe) {
			return true
		}
	}
	return false
}

func testWritable(p string) bool {
	tmp := filepath.Join(p, ".xfm-write-test")
	f, err := os.Create(tmp)
	if err != nil {
		return false
	}
	f.Close()
	os.Remove(tmp)
	return true
}

func copyDir(src, dst string) error {
	srcAbs, err := filepath.Abs(src)
	if err != nil {
		return err
	}
	return filepath.WalkDir(srcAbs, func(p string, d fs.DirEntry, werr error) error {
		if werr != nil {
			return werr
		}
		rel, rerr := filepath.Rel(srcAbs, p)
		if rerr != nil {
			return rerr
		}
		target := filepath.Join(dst, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		// 跳过 dotfile / hidden（如 .DS_Store）
		if strings.HasPrefix(filepath.Base(p), ".") {
			return nil
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}
