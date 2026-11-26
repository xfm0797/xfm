package plugin

import "sort"

func init() { Register("related", newRelated) }

const maxTags = 200

type relatedBrief struct {
	URL         string   `json:"url"`
	Title       string   `json:"title"`
	Date        string   `json:"date"`
	Description string   `json:"description"`
	Tags        []string `json:"tags"`
	Category    string   `json:"category"`
}

// related：为每篇文章计算相关文章，写入 page.data.related。
func newRelated(h Host) *Instance {
	cfg := h.Section("related")
	limit := IntVal(cfg, "limit", 3)
	if limit < 1 {
		limit = 3
	}
	minScore := IntVal(cfg, "minScore", 2)

	return &Instance{
		Name: "related",
		AfterCollect: func(h Host) {
			var posts []*Doc
			for _, p := range h.Pages() {
				if p.Date == "" || p.URL == "/" || Str(p.Data, "type") == "page" {
					continue
				}
				posts = append(posts, p)
			}
			if len(posts) < 2 {
				return
			}

			byTag := map[string][]*Doc{}
			byCat := map[string][]*Doc{}
			bySeries := map[string][]*Doc{}
			push := func(m map[string][]*Doc, key string, p *Doc) {
				if key == "" {
					return
				}
				m[key] = append(m[key], p)
			}
			for _, p := range posts {
				for _, t := range p.Tags {
					push(byTag, t, p)
				}
				push(byCat, p.Category, p)
				push(bySeries, p.Series, p)
			}

			brief := func(p *Doc) relatedBrief {
				return relatedBrief{
					URL: p.URL, Title: p.Title, Date: p.Date,
					Description: p.Description, Tags: p.Tags, Category: p.Category,
				}
			}

			for _, p := range posts {
				manual, has := p.Data["related"]
				if v, ok := manual.(bool); has && ok && !v {
					continue
				}
				if arr, ok := manual.([]any); has && ok {
					var out []relatedBrief
					for _, u := range arr {
						for _, q := range posts {
							if q.URL == toString(u) {
								out = append(out, brief(q))
								break
							}
						}
					}
					if len(out) > limit {
						out = out[:limit]
					}
					p.Data["related"] = out
					continue
				}

				score := map[*Doc]int{}
				add := func(list []*Doc, weight int) {
					if list == nil {
						return
					}
					pool := list
					if len(pool) > maxTags {
						pool = pool[:maxTags]
					}
					for _, q := range pool {
						if q == p || q.Lang != p.Lang {
							continue
						}
						score[q] += weight
					}
				}
				for _, t := range p.Tags {
					add(byTag[t], 3)
				}
				add(byCat[p.Category], 2)
				add(bySeries[p.Series], 3)

				type entry struct {
					doc *Doc
					s   int
				}
				var ranked []entry
				for q, s := range score {
					if s >= minScore {
						ranked = append(ranked, entry{q, s})
					}
				}
				sort.SliceStable(ranked, func(i, j int) bool {
					if ranked[i].s != ranked[j].s {
						return ranked[i].s > ranked[j].s
					}
					return ranked[i].doc.Date > ranked[j].doc.Date
				})
				if len(ranked) > limit {
					ranked = ranked[:limit]
				}
				out := make([]relatedBrief, 0, len(ranked))
				for _, e := range ranked {
					out = append(out, brief(e.doc))
				}
				p.Data["related"] = out
			}
		},
	}
}
