package publish

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// GitHubSettings 等结构是单个平台的生效设置：
// 站点配置 > 环境变量 > 本机保存值。
type GitHubSettings struct {
	Repo   string
	Branch string
	Token  string
}

type CloudflareSettings struct {
	AccountID string
	Project   string
	Branch    string
	Token     string
}

type NetlifySettings struct {
	SiteID string
	Token  string
}

type VercelSettings struct {
	Project string
	TeamID  string
	Target  string
	Token   string
}

// Settings 汇总四个平台的生效设置。
type Settings struct {
	GitHub     GitHubSettings
	Cloudflare CloudflareSettings
	Netlify    NetlifySettings
	Vercel     VercelSettings
}

// 磁盘格式：Token 全局保存，非敏感字段按站点目录保存。
type diskStore struct {
	Tokens map[string]string           `json:"tokens,omitempty"`
	Sites  map[string]storedSiteConfig `json:"sites,omitempty"`
}

type storedSiteConfig struct {
	GitHub     storedGitHub     `json:"github,omitempty"`
	Cloudflare storedCloudflare `json:"cloudflare,omitempty"`
	Netlify    storedNetlify    `json:"netlify,omitempty"`
	Vercel     storedVercel     `json:"vercel,omitempty"`
}

type storedGitHub struct {
	Repo   string `json:"repo,omitempty"`
	Branch string `json:"branch,omitempty"`
}

type storedCloudflare struct {
	AccountID string `json:"accountId,omitempty"`
	Project   string `json:"project,omitempty"`
	Branch    string `json:"branch,omitempty"`
}

type storedNetlify struct {
	SiteID string `json:"siteId,omitempty"`
}

type storedVercel struct {
	Project string `json:"project,omitempty"`
	TeamID  string `json:"teamId,omitempty"`
}

func (s storedSiteConfig) empty() bool {
	return s.GitHub == storedGitHub{} &&
		s.Cloudflare == storedCloudflare{} &&
		s.Netlify == storedNetlify{} &&
		s.Vercel == storedVercel{}
}

var storeMu sync.Mutex

// StorePath 返回本机发布配置路径（用户配置目录/xfm/publish.json）。
func StorePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "xfm", "publish.json"), nil
}

func loadStore() diskStore {
	var st diskStore
	p, err := StorePath()
	if err != nil {
		return st
	}
	data, err := os.ReadFile(p)
	if err != nil {
		return st
	}
	_ = json.Unmarshal(data, &st)
	return st
}

func (s diskStore) site(root string) storedSiteConfig {
	if root == "" || s.Sites == nil {
		return storedSiteConfig{}
	}
	return s.Sites[filepath.Clean(root)]
}

// Settings 计算四个平台的生效设置。
func (c *Config) Settings() Settings {
	st := loadStore()
	site := st.site(c.Root)

	gh := c.Section(TargetGitHub)
	cf := c.Section(TargetCloudflare)
	nf := c.Section(TargetNetlify)
	vc := c.Section(TargetVercel)

	return Settings{
		GitHub: GitHubSettings{
			Repo:   pick(str(gh["repo"]), os.Getenv("GITHUB_REPO"), site.GitHub.Repo),
			Branch: pick(str(gh["branch"]), site.GitHub.Branch),
			Token:  pick(os.Getenv("GITHUB_TOKEN"), os.Getenv("GH_TOKEN"), st.Tokens[TargetGitHub]),
		},
		Cloudflare: CloudflareSettings{
			AccountID: pick(str(cf["accountId"]), os.Getenv("CLOUDFLARE_ACCOUNT_ID"), site.Cloudflare.AccountID),
			Project:   pick(str(cf["project"]), site.Cloudflare.Project),
			Branch:    pick(str(cf["branch"]), site.Cloudflare.Branch),
			Token:     pick(os.Getenv("CLOUDFLARE_API_TOKEN"), os.Getenv("CF_API_TOKEN"), st.Tokens[TargetCloudflare]),
		},
		Netlify: NetlifySettings{
			SiteID: pick(str(nf["siteId"]), os.Getenv("NETLIFY_SITE_ID"), site.Netlify.SiteID),
			Token:  pick(os.Getenv("NETLIFY_AUTH_TOKEN"), os.Getenv("NETLIFY_ACCESS_TOKEN"), st.Tokens[TargetNetlify]),
		},
		Vercel: VercelSettings{
			Project: pick(str(vc["project"]), str(vc["name"]), site.Vercel.Project),
			TeamID:  pick(str(vc["teamId"]), os.Getenv("VERCEL_TEAM_ID"), site.Vercel.TeamID),
			Target:  str(vc["target"]),
			Token:   pick(os.Getenv("VERCEL_TOKEN"), os.Getenv("VERCEL_ACCESS_TOKEN"), st.Tokens[TargetVercel]),
		},
	}
}

// SaveSettings 保存设置：Token 全局保存，其余字段按站点目录保存。
// 文件权限为 0600，不写入站点配置。
func SaveSettings(root string, s Settings) error {
	root = strings.TrimSpace(root)
	if root == "" {
		return errors.New("缺少站点目录")
	}
	p, err := StorePath()
	if err != nil {
		return err
	}

	storeMu.Lock()
	defer storeMu.Unlock()

	st := loadStore()
	if st.Tokens == nil {
		st.Tokens = map[string]string{}
	}
	setToken := func(platform, token string) {
		token = strings.TrimSpace(token)
		if token == "" {
			delete(st.Tokens, platform)
			return
		}
		st.Tokens[platform] = token
	}
	setToken(TargetGitHub, s.GitHub.Token)
	setToken(TargetCloudflare, s.Cloudflare.Token)
	setToken(TargetNetlify, s.Netlify.Token)
	setToken(TargetVercel, s.Vercel.Token)

	if st.Sites == nil {
		st.Sites = map[string]storedSiteConfig{}
	}
	key := filepath.Clean(root)
	site := storedSiteConfig{
		GitHub: storedGitHub{
			Repo:   strings.TrimSpace(s.GitHub.Repo),
			Branch: strings.TrimSpace(s.GitHub.Branch),
		},
		Cloudflare: storedCloudflare{
			AccountID: strings.TrimSpace(s.Cloudflare.AccountID),
			Project:   strings.TrimSpace(s.Cloudflare.Project),
			Branch:    strings.TrimSpace(s.Cloudflare.Branch),
		},
		Netlify: storedNetlify{SiteID: strings.TrimSpace(s.Netlify.SiteID)},
		Vercel: storedVercel{
			Project: strings.TrimSpace(s.Vercel.Project),
			TeamID:  strings.TrimSpace(s.Vercel.TeamID),
		},
	}
	if site.empty() {
		delete(st.Sites, key)
	} else {
		st.Sites[key] = site
	}

	data, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
		return err
	}
	tmp := p + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o600); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, p)
}

func pick(values ...string) string {
	for _, v := range values {
		if s := strings.TrimSpace(v); s != "" {
			return s
		}
	}
	return ""
}
