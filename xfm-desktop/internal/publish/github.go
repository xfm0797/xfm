package publish

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// publishGitHub 把 dist 作为一次提交强制推送到 gh-pages 分支。
// 凭据优先级：GITHUB_TOKEN / GH_TOKEN > 本机 git 凭据（credential helper / SSH）。
func publishGitHub(ctx context.Context, cfg *Config, opts Options, name string) (Result, error) {
	if opts.Log == nil {
		opts.Log = func(string) {}
	}
	sec := cfg.Section(name)

	repo := strings.TrimSpace(str(sec["repo"]))
	if repo == "" {
		repo = strings.TrimSpace(os.Getenv("GITHUB_REPO"))
	}
	if repo == "" {
		repo = detectGitHubRepo(ctx, opts.Root)
	}
	if repo == "" {
		return Result{}, errors.New("未配置 github.repo，且无法从 git remote 推断仓库（格式：owner/name）")
	}
	branch := strings.TrimSpace(str(sec["branch"]))
	if branch == "" {
		branch = "gh-pages"
	}
	message := opts.Message
	if message == "" {
		message = str(sec["message"])
	}
	if message == "" {
		message = nowMessage()
	}

	files, err := walkFiles(opts.DistDir)
	if err != nil {
		return Result{}, err
	}
	res := Result{
		URL:    githubPagesURL(repo),
		Detail: fmt.Sprintf("%s → %s 分支", repo, branch),
		Files:  len(files),
	}
	if opts.DryRun {
		opts.Log(fmt.Sprintf("将推送 %d 个文件到 %s 的 %s 分支", len(files), repo, branch))
		return res, nil
	}

	token := firstEnv("GITHUB_TOKEN", "GH_TOKEN")
	tmp, err := os.MkdirTemp("", "xfm-pages-*")
	if err != nil {
		return Result{}, err
	}
	defer os.RemoveAll(tmp)

	opts.Log("复制构建产物到临时目录")
	if _, err := copyTree(opts.DistDir, tmp); err != nil {
		return Result{}, err
	}
	// 阻止 GitHub Pages 走 Jekyll，避免下划线开头的资源被吞掉
	if err := os.WriteFile(filepath.Join(tmp, ".nojekyll"), nil, 0o644); err != nil {
		return Result{}, err
	}

	steps := [][]string{
		{"init", "-q"},
		{"checkout", "-q", "-b", branch},
		{"add", "-A"},
		{"-c", "user.name=xfm", "-c", "user.email=xfm@localhost", "commit", "-q", "-m", message},
	}
	for _, args := range steps {
		if err := gitRun(ctx, tmp, nil, args...); err != nil {
			return Result{}, fmt.Errorf("git %s 失败：%s", args[0], sanitize(err.Error(), token))
		}
	}

	opts.Log("推送到 GitHub")
	remote := pushURL(repo, token)
	if err := gitRun(ctx, tmp, []string{"GIT_TERMINAL_PROMPT=0"}, "push", "--force", remote, "HEAD:refs/heads/"+branch); err != nil {
		return Result{}, fmt.Errorf("推送失败：%s", sanitize(err.Error(), token))
	}
	return res, nil
}

func gitRun(ctx context.Context, dir string, extraEnv []string, args ...string) error {
	full := append([]string{"-C", dir}, args...)
	cmd := exec.CommandContext(ctx, "git", full...)
	cmd.Env = append(os.Environ(), extraEnv...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return errors.New(msg)
	}
	return nil
}

func detectGitHubRepo(ctx context.Context, root string) string {
	if root == "" {
		return ""
	}
	cmd := exec.CommandContext(ctx, "git", "-C", root, "config", "--get", "remote.origin.url")
	out, err := cmd.Output()
	if err != nil {
		return ""
	}
	return parseGitHubRepo(string(out))
}

// parseGitHubRepo 从 https / ssh / git@ 形式里提取 owner/name。
func parseGitHubRepo(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(s, ".git")
	if strings.HasPrefix(s, "git@github.com:") {
		s = strings.TrimPrefix(s, "git@github.com:")
	} else if i := strings.Index(s, "github.com/"); i >= 0 {
		s = s[i+len("github.com/"):]
	} else if i := strings.Index(s, "github.com:"); i >= 0 {
		s = s[i+len("github.com:"):]
	} else {
		return ""
	}
	parts := strings.Split(strings.Trim(s, "/"), "/")
	if len(parts) < 2 || parts[0] == "" || parts[1] == "" {
		return ""
	}
	return parts[0] + "/" + parts[1]
}

func githubPagesURL(repo string) string {
	parts := strings.Split(repo, "/")
	if len(parts) < 2 {
		return ""
	}
	owner, name := parts[0], parts[1]
	if strings.EqualFold(name, owner+".github.io") {
		return "https://" + owner + ".github.io/"
	}
	return "https://" + owner + ".github.io/" + name + "/"
}

func pushURL(repo, token string) string {
	repo = strings.TrimSuffix(repo, ".git")
	u := &url.URL{Scheme: "https", Host: "github.com", Path: "/" + repo + ".git"}
	if token != "" {
		u.User = url.UserPassword("x-access-token", token)
	}
	return u.String()
}

// sanitize 从错误信息里抹掉 token，避免日志泄露。
func sanitize(s, token string) string {
	if token == "" {
		return s
	}
	s = strings.ReplaceAll(s, token, "***")
	if esc := url.QueryEscape(token); esc != token {
		s = strings.ReplaceAll(s, esc, "***")
	}
	return s
}
