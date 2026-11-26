// Package publish 把构建产物（dist）分发到多个静态托管平台。
//
// 目前支持 GitHub Pages、Cloudflare Pages、Netlify、Vercel。
// 凭据只从环境变量读取，不写入站点配置：
//
//	GitHub Pages     GITHUB_TOKEN 或 GH_TOKEN（也可复用 git 凭据）
//	Cloudflare Pages CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
//	Netlify          NETLIFY_AUTH_TOKEN（站点 ID 写在配置或 NETLIFY_SITE_ID）
//	Vercel           VERCEL_TOKEN（团队 ID 写在配置或 VERCEL_TEAM_ID）
package publish

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	xsite "xfmdesk/internal/site"
)

// 支持的平台标识。
const (
	TargetGitHub     = "github"
	TargetCloudflare = "cloudflare"
	TargetNetlify    = "netlify"
	TargetVercel     = "vercel"
)

// All 返回全部内置平台（展示顺序）。
func All() []string {
	return []string{TargetGitHub, TargetCloudflare, TargetNetlify, TargetVercel}
}

// IsKnown 判断平台标识是否受支持。
func IsKnown(name string) bool {
	for _, n := range All() {
		if n == name {
			return true
		}
	}
	return false
}

// Config 是站点配置里的 publish 段。
type Config struct {
	Root    string
	Targets []string       // 已选平台（配置里的 publish.targets）
	Raw     map[string]any // publish 段原始配置
}

// Load 读取站点配置中的 publish 段。
func Load(root string) (*Config, error) {
	cfg, err := xsite.LoadConfig(root)
	if err != nil {
		return nil, err
	}
	sec := cfg.Section("publish")
	c := &Config{Root: root, Raw: sec}
	for _, n := range strList(sec["targets"]) {
		n = strings.ToLower(strings.TrimSpace(n))
		if n == "" {
			continue
		}
		if !IsKnown(n) {
			return nil, fmt.Errorf("publish.targets 里有未知平台 %q（可用：%s）", n, strings.Join(All(), ", "))
		}
		c.Targets = append(c.Targets, n)
	}
	return c, nil
}

// Section 返回某个平台的配置段。
func (c *Config) Section(name string) map[string]any {
	if m, ok := c.Raw[name].(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

// Str 读取平台的字符串配置，空值时回退到环境变量。
func (c *Config) Str(name, key string, envs ...string) string {
	if v := str(c.Section(name)[key]); v != "" {
		return v
	}
	return firstEnv(envs...)
}

// Options 是一次发布的参数。
type Options struct {
	DistDir string
	Root    string
	Targets []string // 本次要发布的平台（按顺序）
	DryRun  bool
	Message string
	Log     func(string)
}

// Result 是单个平台的成功结果。
type Result struct {
	Target string
	URL    string
	Detail string
	Files  int
}

// Outcome 是单个平台的执行结果（成功或失败）。
type Outcome struct {
	Target string
	Result Result
	Err    error
}

type adapter func(ctx context.Context, cfg *Config, opts Options, name string) (Result, error)

var adapters = map[string]adapter{
	TargetGitHub:     publishGitHub,
	TargetCloudflare: publishCloudflare,
	TargetNetlify:    publishNetlify,
	TargetVercel:     publishVercel,
}

// Run 依次发布到指定平台；单个失败不会中断后续平台。
func Run(ctx context.Context, cfg *Config, opts Options) []Outcome {
	if opts.Log == nil {
		opts.Log = func(string) {}
	}
	if opts.Root == "" {
		opts.Root = cfg.Root
	}
	var out []Outcome
	for _, name := range opts.Targets {
		name = strings.ToLower(strings.TrimSpace(name))
		if name == "" {
			continue
		}
		fn, ok := adapters[name]
		if !ok {
			out = append(out, Outcome{Target: name, Err: fmt.Errorf("未知发布平台 %q", name)})
			continue
		}
		opts.Log("开始发布到 " + name)
		res, err := fn(ctx, cfg, opts, name)
		res.Target = name
		if err != nil {
			opts.Log(fmt.Sprintf("%s 失败：%v", name, err))
		} else {
			opts.Log(fmt.Sprintf("%s 完成：%s", name, res.URL))
		}
		out = append(out, Outcome{Target: name, Result: res, Err: err})
	}
	return out
}

// Files 返回将要上传的文件数量（供预览）。
func Files(distDir string) (int, error) {
	files, err := walkFiles(distDir)
	return len(files), err
}

// ---------- 小工具 ----------

func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func strList(v any) []string {
	switch x := v.(type) {
	case []any:
		out := make([]string, 0, len(x))
		for _, e := range x {
			out = append(out, str(e))
		}
		return out
	case []string:
		return x
	case string:
		if x == "" {
			return nil
		}
		return strings.Split(x, ",")
	}
	return nil
}

func firstEnv(names ...string) string {
	for _, n := range names {
		if v := strings.TrimSpace(os.Getenv(n)); v != "" {
			return v
		}
	}
	return ""
}

func nowMessage() string { return "xfm publish " + time.Now().Format("2006-01-02 15:04:05") }

// trimURL 去掉首尾空白与结尾斜杠。
func trimURL(s string) string { return strings.TrimRight(strings.TrimSpace(s), "/") }
