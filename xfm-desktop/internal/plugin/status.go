package plugin

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// StatusEntry 描述一个内置插件的启用状态。
type StatusEntry struct {
	Name        string
	Enabled     bool
	Core        bool // 核心插件：默认启用
	HasManifest bool
}

// scanManifests 读取站点 plugins/*.json 清单，按名称排序。
func scanManifests(root string) []manifest {
	dir := filepath.Join(root, "plugins")
	entries, _ := os.ReadDir(dir)
	var mfs []manifest
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		if !strings.HasSuffix(strings.ToLower(e.Name()), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var mf manifest
		if json.Unmarshal(data, &mf) != nil {
			continue
		}
		if mf.Name == "" {
			mf.Name = strings.TrimSuffix(e.Name(), filepath.Ext(e.Name()))
		}
		mfs = append(mfs, mf)
	}
	sort.SliceStable(mfs, func(i, j int) bool { return mfs[i].Name < mfs[j].Name })
	return mfs
}

// Status 计算全部内置插件的启用情况（配置 + 清单）。
func Status(root string, cfg map[string]any) []StatusEntry {
	state := map[string]bool{}
	for _, n := range StrList(cfg["plugins"]) {
		state[strings.TrimSpace(n)] = true
	}
	hasManifest := map[string]bool{}
	for _, mf := range scanManifests(root) {
		hasManifest[mf.Name] = true
		if mf.Enabled != nil && !*mf.Enabled {
			state[mf.Name] = false
		} else {
			state[mf.Name] = true
		}
	}
	out := make([]StatusEntry, 0, len(registry))
	for _, n := range Builtins() {
		out = append(out, StatusEntry{Name: n, Enabled: state[n], Core: IsCore(n), HasManifest: hasManifest[n]})
	}
	return out
}

// SetEnabled 写入 plugins/<name>.json 来启用/关闭插件（保留已有 config）。
func SetEnabled(root, name string, enabled bool) error {
	if !HasBuiltin(name) {
		return fmt.Errorf("未知插件 %q（可用：%s）", name, strings.Join(Builtins(), " / "))
	}
	dir := filepath.Join(root, "plugins")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	path := filepath.Join(dir, name+".json")
	mf := manifest{Name: name}
	if data, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(data, &mf)
	}
	mf.Name = name
	mf.Enabled = &enabled
	b, _ := json.MarshalIndent(mf, "", "  ")
	return os.WriteFile(path, append(b, '\n'), 0o644)
}
