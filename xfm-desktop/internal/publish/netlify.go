package publish

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// httpClient 覆盖构建产物通常的体量，给足上传时间。
var httpClient = &http.Client{Timeout: 10 * time.Minute}

var netlifyAPIBase = "https://api.netlify.com/api/v1"

// publishNetlify 把 dist 打成 zip，通过 Zip Deploy 接口上传。
func publishNetlify(ctx context.Context, cfg *Config, opts Options, name string) (Result, error) {
	if opts.Log == nil {
		opts.Log = func(string) {}
	}
	sec := cfg.Section(name)
	siteID := strings.TrimSpace(str(sec["siteId"]))
	if siteID == "" {
		siteID = strings.TrimSpace(os.Getenv("NETLIFY_SITE_ID"))
	}
	if siteID == "" {
		return Result{}, errors.New("未配置 netlify.siteId（或环境变量 NETLIFY_SITE_ID）")
	}

	files, err := walkFiles(opts.DistDir)
	if err != nil {
		return Result{}, err
	}
	res := Result{
		URL:    "https://app.netlify.com/sites/" + siteID,
		Detail: "站点 " + siteID,
		Files:  len(files),
	}
	if opts.DryRun {
		opts.Log(fmt.Sprintf("将把 %d 个文件打包上传到 Netlify 站点 %s", len(files), siteID))
		return res, nil
	}

	token := firstEnv("NETLIFY_AUTH_TOKEN", "NETLIFY_ACCESS_TOKEN")
	if token == "" {
		return Result{}, errors.New("缺少环境变量 NETLIFY_AUTH_TOKEN")
	}

	tmp, err := os.CreateTemp("", "xfm-netlify-*.zip")
	if err != nil {
		return Result{}, err
	}
	zipPath := tmp.Name()
	tmp.Close()
	defer os.Remove(zipPath)

	opts.Log("打包构建产物")
	size, err := zipDist(opts.DistDir, zipPath)
	if err != nil {
		return Result{}, err
	}
	zf, err := os.Open(zipPath)
	if err != nil {
		return Result{}, err
	}
	defer zf.Close()

	endpoint := fmt.Sprintf("%s/sites/%s/deploys", netlifyAPIBase, siteID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, zf)
	if err != nil {
		return Result{}, err
	}
	req.ContentLength = size
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/zip")

	opts.Log(fmt.Sprintf("上传 %d 个文件（%.1f MB）", len(files), float64(size)/1048576))
	resp, err := httpClient.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var out struct {
		ID           string `json:"id"`
		URL          string `json:"url"`
		SSLURL       string `json:"ssl_url"`
		DeploySSLURL string `json:"deploy_ssl_url"`
		ErrorMessage string `json:"error_message"`
	}
	_ = json.Unmarshal(data, &out)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := out.ErrorMessage
		if msg == "" {
			msg = strings.TrimSpace(string(data))
		}
		return Result{}, fmt.Errorf("Netlify 返回 %d：%s", resp.StatusCode, msg)
	}
	if out.DeploySSLURL != "" {
		res.URL = normalizeURL(out.DeploySSLURL)
	} else if out.SSLURL != "" {
		res.URL = normalizeURL(out.SSLURL)
	} else if out.URL != "" {
		res.URL = normalizeURL(out.URL)
	}
	if out.ID != "" {
		res.Detail += " · " + out.ID
	}
	return res, nil
}
