package site

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func (s *Site) writeOutput() error {
	outDir := filepath.Join(s.Root, s.Cfg.Str("outDir"))
	if err := os.RemoveAll(outDir); err != nil {
		return err
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		return err
	}
	for _, p := range s.AllPages {
		rel := URLToFilePath(p.URL)
		target := filepath.Join(outDir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(target, []byte(p.HTML), 0o644); err != nil {
			return err
		}
		s.Stats.Written++
	}

	// 主题资源 → dist/assets
	assetsSrc := filepath.Join(s.ThemeDir, "assets")
	if dirExists(assetsSrc) {
		n, err := copyDir(assetsSrc, filepath.Join(outDir, "assets"))
		if err != nil {
			return err
		}
		s.Stats.Assets += n
	}
	// public → dist 根
	publicSrc := filepath.Join(s.Root, s.Cfg.Str("publicDir"))
	if dirExists(publicSrc) {
		n, err := copyDir(publicSrc, outDir)
		if err != nil {
			return err
		}
		s.Stats.Assets += n
	}
	// 内容附件（Page Bundle）
	for _, a := range s.contentAssets {
		target := filepath.Join(outDir, filepath.FromSlash(a.Dest))
		if err := copyFile(a.Src, target); err != nil {
			return err
		}
		s.Stats.Assets++
	}
	return nil
}

func copyDir(src, dst string) (int, error) {
	count := 0
	err := filepath.Walk(src, func(p string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(src, p)
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		if strings.HasPrefix(info.Name(), ".") {
			return nil
		}
		if err := copyFile(p, target); err != nil {
			return err
		}
		count++
		return nil
	})
	return count, err
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}

// Serve 启动一个静态文件服务器（用于浏览器预览）。
func Serve(distDir string, port int) (string, *http.Server, error) {
	mux := http.NewServeMux()
	fs := http.FileServer(http.Dir(distDir))
	mux.Handle("/", fs)
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return "", nil, err
	}
	srv := &http.Server{Handler: mux}
	go srv.Serve(ln)
	return "http://" + addr, srv, nil
}
