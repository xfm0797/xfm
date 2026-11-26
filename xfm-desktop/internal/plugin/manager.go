package plugin

import (
	"strings"
)

// manifest 是站点 plugins/<name>.json 的声明式清单。
type manifest struct {
	Name    string         `json:"name"`
	Enabled *bool          `json:"enabled"`
	Config  map[string]any `json:"config,omitempty"`
}

// Manager 持有当前站点启用的插件，并按顺序派发钩子。
type Manager struct {
	host    Host
	plugins []*Instance
	names   []string

	extraFiles []ExtraFile
	warnings   []string
}

// NewManager 创建插件管理器。
func NewManager(h Host) *Manager { return &Manager{host: h} }

// Load 读取 config.plugins 与站点 plugins/*.json 清单，实例化插件。
//
// 加载顺序：
//  1. config.plugins 里的顺序（先）；
//  2. plugins/ 清单里新增的插件，按文件名排序（后）。
//
// 清单里有 "enabled": false 时，即使配置里写了也会被关闭；
// 清单里的 "config" 会覆盖站点配置中的同名段。
func (m *Manager) Load() error {
	cfg := m.host.Config()
	order := make([]string, 0)
	seen := map[string]bool{}
	enabled := map[string]bool{}

	for _, name := range StrList(cfg["plugins"]) {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			continue
		}
		seen[name] = true
		order = append(order, name)
		enabled[name] = true
	}

	// 扫描声明式清单
	mfs := scanManifests(m.host.Root())
	for _, mf := range mfs {
		if mf.Enabled != nil && !*mf.Enabled {
			enabled[mf.Name] = false
			continue
		}
		if mf.Config != nil {
			m.host.MergePluginConfig(mf.Name, mf.Config)
		}
		if !seen[mf.Name] {
			seen[mf.Name] = true
			order = append(order, mf.Name)
		}
		enabled[mf.Name] = true
	}

	for _, name := range order {
		if !enabled[name] {
			continue
		}
		f, ok := registry[name]
		if !ok {
			// 站点里可能有 Node 版 .js 插件，Go 内核无法执行；这里只记录，不阻断构建。
			m.warnings = append(m.warnings, "未找到内置插件 "+name+"（已跳过）")
			continue
		}
		inst := f(m.host)
		if inst == nil {
			continue
		}
		if inst.Name == "" {
			inst.Name = name
		}
		m.plugins = append(m.plugins, inst)
		m.names = append(m.names, inst.Name)
	}
	return nil
}

// Names 返回已启用插件名（按加载顺序）。
func (m *Manager) Names() []string { return append([]string(nil), m.names...) }

// Warnings 返回加载期间的非致命提示。
func (m *Manager) Warnings() []string { return append([]string(nil), m.warnings...) }

// Enabled 判断某插件是否已启用。
func (m *Manager) Enabled(name string) bool {
	for _, n := range m.names {
		if n == name {
			return true
		}
	}
	return false
}

// ExtraFiles 返回 afterBuild 期间累积的附加文件路径（不含内容）。
func (m *Manager) ExtraFiles() []ExtraFile {
	return append([]ExtraFile(nil), m.extraFiles...)
}

// ExtendContext 依次调用 extendContext，返回可能是新对象的上下文。
func (m *Manager) ExtendContext(ctx map[string]any) map[string]any {
	for _, p := range m.plugins {
		if p.ExtendContext == nil {
			continue
		}
		if next := p.ExtendContext(ctx); next != nil {
			ctx = next
		}
	}
	return ctx
}

// Markdown 依次调用 markdown 钩子。
func (m *Manager) Markdown(src string, page *Doc) string {
	for _, p := range m.plugins {
		if p.Markdown == nil {
			continue
		}
		src = p.Markdown(src, page)
	}
	return src
}

// TransformHTML 依次调用 transformHtml 钩子。
func (m *Manager) TransformHTML(html string, page *Doc) string {
	for _, p := range m.plugins {
		if p.TransformHTML == nil {
			continue
		}
		html = p.TransformHTML(html, page)
	}
	return html
}

// AfterCollect 在全部页面生成后、渲染前调用。
func (m *Manager) AfterCollect() {
	for _, p := range m.plugins {
		if p.AfterCollect != nil {
			p.AfterCollect(m.host)
		}
	}
}

// AfterBuild 收集附加产物；排在前面的插件产物路径会暴露给后面的插件。
func (m *Manager) AfterBuild() []ExtraFile {
	m.extraFiles = nil
	var out []ExtraFile
	for _, p := range m.plugins {
		if p.AfterBuild == nil {
			continue
		}
		items := p.AfterBuild(m.host)
		for _, it := range items {
			if it.Path == "" {
				continue
			}
			it.Path = strings.TrimLeft(strings.ReplaceAll(it.Path, "\\", "/"), "/")
			out = append(out, it)
			// 只把路径共享给后续插件（内容可能是大块二进制，没必要复制）。
			m.extraFiles = append(m.extraFiles, ExtraFile{Path: it.Path})
		}
	}
	return out
}

// Finish 在所有文件写盘后调用。
func (m *Manager) Finish() {
	for _, p := range m.plugins {
		if p.Finish != nil {
			p.Finish(m.host)
		}
	}
}
