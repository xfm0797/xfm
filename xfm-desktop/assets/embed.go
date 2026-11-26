// Package assets 内嵌官方主题（default / docs），供桌面端离线脚手架与构建使用。
package assets

import (
	"embed"
	"io/fs"
	"os"
	"path/filepath"
)

//go:embed default docs
var themes embed.FS

// ThemeNames 返回内嵌主题名列表。
func ThemeNames() []string {
	return []string{"default", "docs"}
}

// WriteEmbeddedTheme 把内嵌主题写入目标目录。
func WriteEmbeddedTheme(dest, name string) error {
	return fs.WalkDir(themes, name, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(name, p)
		target := filepath.Join(dest, rel)
		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := themes.ReadFile(p)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

// ReadFile 读取内嵌主题文件。
func ReadFile(theme, name string) ([]byte, error) {
	return themes.ReadFile(theme + "/" + name)
}
