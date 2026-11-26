package publish

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

var vercelAPIBase = "https://api.vercel.com"

// publishVercel 通过 v13 Deployments 接口内联上传文件（base64）。
func publishVercel(ctx context.Context, cfg *Config, opts Options, name string) (Result, error) {
	if opts.Log == nil {
		opts.Log = func(string) {}
	}
	settings := cfg.Settings()
	project := settings.Vercel.Project
	teamID := settings.Vercel.TeamID
	target := settings.Vercel.Target
	if target == "" {
		target = "production"
	}
	if project == "" {
		return Result{}, errors.New("未配置 vercel.project（Vercel 项目名）")
	}

	files, err := walkFiles(opts.DistDir)
	if err != nil {
		return Result{}, err
	}
	res := Result{
		URL:    "https://" + project + ".vercel.app",
		Detail: fmt.Sprintf("项目 %s · %s", project, target),
		Files:  len(files),
	}
	if opts.DryRun {
		opts.Log(fmt.Sprintf("将上传 %d 个文件到 Vercel 项目 %s（%s）", len(files), project, target))
		return res, nil
	}

	token := settings.Vercel.Token
	if token == "" {
		return Result{}, errors.New("缺少 Vercel Access Token：请设置 VERCEL_TOKEN 或在「发布设置」中填写")
	}

	type vFile struct {
		File string `json:"file"`
		Data string `json:"data"`
	}
	list := make([]vFile, 0, len(files))
	for _, e := range files {
		raw, readErr := os.ReadFile(e.Abs)
		if readErr != nil {
			return Result{}, readErr
		}
		list = append(list, vFile{File: e.Rel, Data: base64.StdEncoding.EncodeToString(raw)})
	}
	payload, err := json.Marshal(map[string]any{
		"name":    project,
		"project": project,
		"target":  target,
		"files":   list,
	})
	if err != nil {
		return Result{}, err
	}

	endpoint := vercelAPIBase + "/v13/deployments"
	if teamID != "" {
		endpoint += "?teamId=" + url.QueryEscape(teamID)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")

	opts.Log(fmt.Sprintf("上传 %d 个文件到 Vercel", len(files)))
	resp, err := httpClient.Do(req)
	if err != nil {
		return Result{}, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))

	var out struct {
		URL   string   `json:"url"`
		Alias []string `json:"alias"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(data, &out)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := out.Error.Message
		if msg == "" {
			msg = strings.TrimSpace(string(data))
		}
		if out.Error.Code != "" {
			msg = out.Error.Code + ": " + msg
		}
		return Result{}, fmt.Errorf("Vercel 返回 %d：%s", resp.StatusCode, msg)
	}
	if out.URL != "" {
		res.URL = "https://" + strings.TrimPrefix(out.URL, "https://")
	} else if len(out.Alias) > 0 && out.Alias[0] != "" {
		res.URL = normalizeURL(out.Alias[0])
	}
	return res, nil
}
