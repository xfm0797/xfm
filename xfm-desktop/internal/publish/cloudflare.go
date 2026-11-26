package publish

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"strings"
)

var cloudflareAPIBase = "https://api.cloudflare.com/client/v4"

// publishCloudflare 走 Pages Direct Upload：manifest + 按 sha256 去重的文件分片。
func publishCloudflare(ctx context.Context, cfg *Config, opts Options, name string) (Result, error) {
	if opts.Log == nil {
		opts.Log = func(string) {}
	}
	sec := cfg.Section(name)
	project := strings.TrimSpace(str(sec["project"]))
	account := strings.TrimSpace(str(sec["accountId"]))
	if account == "" {
		account = strings.TrimSpace(os.Getenv("CLOUDFLARE_ACCOUNT_ID"))
	}
	branch := strings.TrimSpace(str(sec["branch"]))
	if branch == "" {
		branch = "main"
	}
	if project == "" {
		return Result{}, errors.New("未配置 cloudflare.project（Cloudflare Pages 项目名）")
	}
	if account == "" {
		return Result{}, errors.New("未配置 cloudflare.accountId（或环境变量 CLOUDFLARE_ACCOUNT_ID）")
	}

	files, err := walkFiles(opts.DistDir)
	if err != nil {
		return Result{}, err
	}
	res := Result{
		URL:    "https://" + project + ".pages.dev",
		Detail: fmt.Sprintf("项目 %s · 分支 %s", project, branch),
		Files:  len(files),
	}
	if opts.DryRun {
		opts.Log(fmt.Sprintf("将上传 %d 个文件到 Cloudflare Pages 项目 %s（分支 %s）", len(files), project, branch))
		return res, nil
	}

	token := firstEnv("CLOUDFLARE_API_TOKEN", "CF_API_TOKEN")
	if token == "" {
		return Result{}, errors.New("缺少环境变量 CLOUDFLARE_API_TOKEN")
	}

	manifest, byHash, err := hashDist(files)
	if err != nil {
		return Result{}, err
	}
	manifestJSON, _ := json.Marshal(manifest)

	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if err := mw.WriteField("manifest", string(manifestJSON)); err != nil {
		return Result{}, err
	}
	if err := mw.WriteField("branch", branch); err != nil {
		return Result{}, err
	}
	for hash, entry := range byHash {
		header := textproto.MIMEHeader{}
		header.Set("Content-Disposition", fmt.Sprintf(`form-data; name="%s"; filename="%s"`, hash, entry.Rel))
		header.Set("Content-Type", mimeFor(entry.Rel))
		part, err := mw.CreatePart(header)
		if err != nil {
			return Result{}, err
		}
		f, err := os.Open(entry.Abs)
		if err != nil {
			return Result{}, err
		}
		_, copyErr := io.Copy(part, f)
		f.Close()
		if copyErr != nil {
			return Result{}, copyErr
		}
	}
	if err := mw.Close(); err != nil {
		return Result{}, err
	}

	endpoint := fmt.Sprintf("%s/accounts/%s/pages/projects/%s/deployments", cloudflareAPIBase, account, project)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, &body)
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Accept", "application/json")

	opts.Log(fmt.Sprintf("上传 %d 个文件（去重后 %d 个分片）", len(files), len(byHash)))
	resp, err := httpClient.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var out struct {
		Success bool `json:"success"`
		Result  struct {
			ID      string   `json:"id"`
			URL     string   `json:"url"`
			Aliases []string `json:"aliases"`
		} `json:"result"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	_ = json.Unmarshal(data, &out)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || !out.Success {
		msg := strings.TrimSpace(string(data))
		if len(out.Errors) > 0 {
			var parts []string
			for _, e := range out.Errors {
				if e.Message != "" {
					parts = append(parts, e.Message)
				}
			}
			if len(parts) > 0 {
				msg = strings.Join(parts, "; ")
			}
		}
		return Result{}, fmt.Errorf("Cloudflare 返回 %d：%s", resp.StatusCode, msg)
	}
	if out.Result.URL != "" {
		res.URL = normalizeURL(out.Result.URL)
	} else if len(out.Result.Aliases) > 0 && out.Result.Aliases[0] != "" {
		res.URL = normalizeURL(out.Result.Aliases[0])
	}
	if out.Result.ID != "" {
		res.Detail += " · " + out.Result.ID
	}
	return res, nil
}

func normalizeURL(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	if !strings.HasPrefix(s, "http://") && !strings.HasPrefix(s, "https://") {
		s = "https://" + s
	}
	return strings.TrimRight(s, "/")
}
