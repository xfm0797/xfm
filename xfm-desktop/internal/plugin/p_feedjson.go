package plugin

import "encoding/json"

func init() { Register("feed-json", newFeedJSON) }

type jsonFeedAuthor struct {
	Name string `json:"name"`
}

type jsonFeedItem struct {
	ID            string           `json:"id"`
	URL           string           `json:"url"`
	Title         string           `json:"title"`
	ContentHTML   string           `json:"content_html"`
	Summary       string           `json:"summary"`
	DatePublished string           `json:"date_published,omitempty"`
	DateModified  string           `json:"date_modified,omitempty"`
	Tags          []string         `json:"tags,omitempty"`
	Authors       []jsonFeedAuthor `json:"authors,omitempty"`
}

type jsonFeed struct {
	Version     string           `json:"version"`
	Title       string           `json:"title"`
	HomePageURL string           `json:"home_page_url"`
	FeedURL     string           `json:"feed_url"`
	Description string           `json:"description"`
	Language    string           `json:"language"`
	Authors     []jsonFeedAuthor `json:"authors,omitempty"`
	Items       []jsonFeedItem   `json:"items"`
}

// feed-json：生成 JSON Feed 1.1。
func newFeedJSON(h Host) *Instance {
	cfg := h.Section("feedJson")
	limit := IntVal(cfg, "limit", 20)
	if limit == 0 {
		limit = 20
	}
	path := Str(cfg, "path")
	if path == "" {
		path = "feed.json"
	}

	return &Instance{
		Name: "feed-json",
		AfterBuild: func(h Host) []ExtraFile {
			siteConf := h.SiteConfig()
			var authors []jsonFeedAuthor
			if a := Str(siteConf, "author"); a != "" {
				authors = []jsonFeedAuthor{{Name: a}}
			}
			var items []jsonFeedItem
			for _, p := range h.Documents() {
				if p.Date == "" || !p.InStream || Str(p.Data, "type") == "page" {
					continue
				}
				if v, ok := p.Data["rss"].(bool); ok && !v {
					continue
				}
				if p.URL == "/" {
					continue
				}
				summary := p.Description
				if summary == "" {
					summary = p.Excerpt
				}
				modified := p.Updated
				if modified == "" {
					modified = p.Date
				}
				items = append(items, jsonFeedItem{
					ID:            AbsoluteURL(siteConf, p.URL),
					URL:           AbsoluteURL(siteConf, p.URL),
					Title:         p.Title,
					ContentHTML:   p.HTML,
					Summary:       summary,
					DatePublished: IsoDateTime(p.Date),
					DateModified:  IsoDateTime(modified),
					Tags:          p.Tags,
					Authors:       authors,
				})
				if len(items) >= limit {
					break
				}
			}
			if items == nil {
				items = []jsonFeedItem{}
			}
			feed := jsonFeed{
				Version:     "https://jsonfeed.org/version/1.1",
				Title:       Str(siteConf, "title"),
				HomePageURL: AbsoluteURL(siteConf, "/"),
				FeedURL:     AbsoluteURL(siteConf, "/"+path),
				Description: Str(siteConf, "description"),
				Language:    defaultStr(Str(siteConf, "lang"), "zh-CN"),
				Authors:     authors,
				Items:       items,
			}
			b, _ := json.MarshalIndent(feed, "", "  ")
			return []ExtraFile{{Path: path, Contents: []byte(string(b) + "\n")}}
		},
	}
}
