// Package plugin 实现 xfm 桌面版的插件内核。
//
// 与 Node 版一致，一个插件就是一组钩子：
//
//	extendContext(ctx)      注入站点全局上下文（渲染前）
//	markdown(src, page)     改写 Markdown 源
//	transformHtml(html,page) 改写整页 HTML（ApplyBase 之后）
//	afterCollect(site)      全部页面就位后、渲染前，往 page.data 写跨页数据
//	afterBuild(site)        产出附加文件（sitemap/feed/search…）
//	finish(site)            收尾
//
// 插件来源：
//  1. 内置 Go 注册表（编译进二进制），通过在 config.plugins 里写名字启用；
//  2. 站点 plugins/ 目录下的声明式清单 <name>.json：
//     {"name":"rss","enabled":true,"config":{"limit":10}}
//     既能启用未写进配置的插件，也能在不改动配置文件的情况下关闭插件。
package plugin

// Doc 是暴露给插件的页面视图。Data 与 Page.Data 指向同一张 map，
// 因此 afterCollect 里写 Doc.Data 会直接影响随后的渲染。
type Doc struct {
	URL          string
	Title        string
	Description  string
	Desc         string
	Date         string // 2006-01-02（本地日历日，与站内展示一致）
	Updated      string
	Tags         []string
	Category     string
	Series       string
	Lang         string
	Weight       int
	Layout       string
	Excerpt      string
	ReadTime     int
	TOC          []map[string]any
	Translations any
	Data         map[string]any

	// HTML 仅在 Documents 中填充：正文 HTML（不含布局）。
	HTML string
	// InStream 仅在 Documents 中填充：是否属于站点默认文章流。
	InStream bool
}

// Asset 是资源清单中的一项。
type Asset struct {
	Src  string
	Dest string // 相对输出目录的 posix 路径
}

// Assets 汇总三类资源，供 pwa / deadlinks 等插件使用。
type Assets struct {
	Theme   []Asset
	Public  []Asset
	Content []Asset
}

// ExtraFile 是插件产出的附加文件。
type ExtraFile struct {
	Path     string
	Contents []byte
}

// Helpers 是插件可用的稳定工具集（对齐 Node 版 site.helpers）。
type Helpers struct {
	NormalizeBase func(string) string
	WithBase      func(base, url string) string
	AbsoluteURL   func(siteCfg map[string]any, url string) string
	ApplyBase     func(html, base string) string
	PlainText     func(string) string
	MarkdownPlain func(string) string
	EscapeHTML    func(string) string
}

// Host 是插件访问宿主站点的只读/有限写入接口，由 site.Site 实现。
type Host interface {
	Root() string
	Mode() string
	ThemeDir() string

	Config() map[string]any
	SiteConfig() map[string]any
	Section(name string) map[string]any
	SiteContext() map[string]any
	MergePluginConfig(name string, cfg map[string]any)

	Helpers() Helpers

	// Pages 返回全部页面（内容页 + 聚合/分页/索引/集合页），
	// 用于 afterCollect / afterBuild 里的跨页计算。
	Pages() []*Doc
	// Documents 返回带正文 HTML 的文档列表（afterBuild 专用）。
	Documents() []*Doc
	// ExtraFiles 返回同一轮 afterBuild 中，排在前面的插件已产出的路径。
	ExtraFiles() []ExtraFile

	Assets() Assets

	// Fail 记录一个致命错误，宿主在插件阶段结束后终止构建（deadlinks.strict 使用）。
	Fail(err error)
}

// Instance 是一个已实例化的插件。
type Instance struct {
	Name string

	ExtendContext func(ctx map[string]any) map[string]any
	Markdown      func(src string, page *Doc) string
	TransformHTML func(html string, page *Doc) string
	AfterCollect  func(h Host)
	AfterBuild    func(h Host) []ExtraFile
	Finish        func(h Host)
}

// Factory 在启用插件时被调用；插件通常在这里读取配置。
type Factory func(h Host) *Instance

var registry = map[string]Factory{}

// Register 注册一个内置插件（通常在 init 中调用）。
func Register(name string, f Factory) {
	if name == "" || f == nil {
		return
	}
	registry[name] = f
}

// Builtins 返回全部内置插件名（按字母序），供 CLI / GUI 列举。
func Builtins() []string {
	names := make([]string, 0, len(registry))
	for n := range registry {
		names = append(names, n)
	}
	sortStrings(names)
	return names
}

// HasBuiltin 判断是否内置了某个插件。
func HasBuiltin(name string) bool {
	_, ok := registry[name]
	return ok
}
