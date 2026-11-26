package publish

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"sort"
)

type fileEntry struct {
	Rel  string
	Abs  string
	Size int64
}

// walkFiles 列出 dist 下的全部普通文件（相对路径用 /）。
func walkFiles(dist string) ([]fileEntry, error) {
	info, err := os.Stat(dist)
	if err != nil {
		return nil, fmt.Errorf("找不到构建产物目录 %s（先执行 xfm build）：%w", dist, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("构建产物路径不是目录：%s", dist)
	}
	var out []fileEntry
	err = filepath.WalkDir(dist, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, relErr := filepath.Rel(dist, p)
		if relErr != nil {
			return relErr
		}
		fi, fiErr := d.Info()
		if fiErr != nil {
			return fiErr
		}
		out = append(out, fileEntry{
			Rel:  filepath.ToSlash(rel),
			Abs:  p,
			Size: fi.Size(),
		})
		return nil
	})
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("构建产物为空：%s", dist)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rel < out[j].Rel })
	return out, nil
}

// copyTree 把 src 完整复制到 dst，返回文件数。
func copyTree(src, dst string) (int, error) {
	files, err := walkFiles(src)
	if err != nil {
		return 0, err
	}
	for _, f := range files {
		target := filepath.Join(dst, filepath.FromSlash(f.Rel))
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return 0, err
		}
		if err := copyFile(f.Abs, target); err != nil {
			return 0, err
		}
	}
	return len(files), nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// zipDist 把 dist 打包成 zip（文件位于压缩包根部），返回文件大小。
func zipDist(dist, target string) (int64, error) {
	files, err := walkFiles(dist)
	if err != nil {
		return 0, err
	}
	f, err := os.Create(target)
	if err != nil {
		return 0, err
	}
	zw := zip.NewWriter(f)
	for _, e := range files {
		info, statErr := os.Stat(e.Abs)
		if statErr != nil {
			zw.Close()
			f.Close()
			return 0, statErr
		}
		hdr, hdrErr := zip.FileInfoHeader(info)
		if hdrErr != nil {
			zw.Close()
			f.Close()
			return 0, hdrErr
		}
		hdr.Name = e.Rel
		hdr.Method = zip.Deflate
		w, createErr := zw.CreateHeader(hdr)
		if createErr != nil {
			zw.Close()
			f.Close()
			return 0, createErr
		}
		in, openErr := os.Open(e.Abs)
		if openErr != nil {
			zw.Close()
			f.Close()
			return 0, openErr
		}
		_, copyErr := io.Copy(w, in)
		in.Close()
		if copyErr != nil {
			zw.Close()
			f.Close()
			return 0, copyErr
		}
	}
	if err := zw.Close(); err != nil {
		f.Close()
		return 0, err
	}
	if err := f.Close(); err != nil {
		return 0, err
	}
	st, err := os.Stat(target)
	if err != nil {
		return 0, err
	}
	return st.Size(), nil
}

func sha256Hex(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// hashDist 生成 Cloudflare 直传所需的清单：/路径 → sha256。
func hashDist(files []fileEntry) (manifest map[string]string, byHash map[string]fileEntry, err error) {
	manifest = map[string]string{}
	byHash = map[string]fileEntry{}
	for _, e := range files {
		h, hErr := sha256Hex(e.Abs)
		if hErr != nil {
			return nil, nil, hErr
		}
		manifest["/"+e.Rel] = h
		if _, ok := byHash[h]; !ok {
			byHash[h] = e
		}
	}
	return manifest, byHash, nil
}

func mimeFor(name string) string {
	if t := mime.TypeByExtension(filepath.Ext(name)); t != "" {
		return t
	}
	return "application/octet-stream"
}
