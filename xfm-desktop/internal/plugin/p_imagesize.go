package plugin

import (
	"encoding/binary"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

func init() { Register("image-size", newImageSize) }

var (
	reImgTag  = regexp.MustCompile(`(?i)<img\b[^>]*>`)
	reHasW    = regexp.MustCompile(`(?i)\swidth\s*=`)
	reHasH    = regexp.MustCompile(`(?i)\sheight\s*=`)
	reHasLazy = regexp.MustCompile(`(?i)\sloading\s*=`)
	reImgSrc  = regexp.MustCompile(`(?i)\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')`)
	reScheme  = regexp.MustCompile(`(?i)^([a-z][\w+.-]*:|//|#)`)
	reSVGW    = regexp.MustCompile(`(?i)\swidth\s*=\s*["']?\s*([\d.]+)`)
	reSVGH    = regexp.MustCompile(`(?i)\sheight\s*=\s*["']?\s*([\d.]+)`)
	reSVGVB   = regexp.MustCompile(`(?i)\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)`)
)

type imgSize struct{ width, height int }

// image-size：给正文 <img> 补 width/height/loading。
func newImageSize(h Host) *Instance {
	cfg := h.Section("imageSize")
	base := NormalizeBase(Str(h.SiteConfig(), "base"))
	pubDir := Str(cfg, "publicDir")
	if pubDir == "" {
		pubDir = Str(h.Config(), "publicDir")
	}
	if pubDir == "" {
		pubDir = "public"
	}
	publicDir, _ := filepath.Abs(filepath.Join(h.Root(), pubDir))
	contentDirRel := Str(h.Config(), "contentDir")
	if contentDirRel == "" {
		contentDirRel = "content"
	}
	contentDir, _ := filepath.Abs(filepath.Join(h.Root(), contentDirRel))
	themeDir := h.ThemeDir()
	lazy := BoolVal(cfg, "lazy", true)
	inDev := BoolVal(cfg, "dev", false)

	cache := map[string]*imgSize{}

	resolveFile := func(urlPath string) string {
		rel := urlPath
		if dec, err := url.PathUnescape(urlPath); err == nil {
			rel = dec
		}
		rel = strings.TrimLeft(strings.ReplaceAll(rel, "\\", "/"), "/")
		if rel == "" || strings.ContainsRune(rel, 0) {
			return ""
		}
		var cands []string
		safe := func(dir, sub string) {
			abs := filepath.Join(dir, filepath.FromSlash(sub))
			clean := filepath.Clean(abs)
			if clean == dir || strings.HasPrefix(clean, dir+string(os.PathSeparator)) {
				cands = append(cands, clean)
			}
		}
		safe(publicDir, rel)
		safe(contentDir, rel)
		if strings.HasPrefix(rel, "assets/") && themeDir != "" {
			safe(filepath.Join(themeDir, "assets"), strings.TrimPrefix(rel, "assets/"))
		}
		for _, abs := range cands {
			if st, err := os.Stat(abs); err == nil && !st.IsDir() {
				return abs
			}
		}
		return ""
	}

	readSize := func(file string) *imgSize {
		if s, ok := cache[file]; ok {
			return s
		}
		f, err := os.Open(file)
		if err != nil {
			cache[file] = nil
			return nil
		}
		defer f.Close()
		buf := make([]byte, 65536)
		n, _ := f.Read(buf)
		size := parseImageSize(buf[:n])
		cache[file] = size
		return size
	}

	return &Instance{
		Name: "image-size",
		TransformHTML: func(html string, page *Doc) string {
			if html == "" || !strings.Contains(html, "<img") {
				return html
			}
			if !inDev && h.Mode() != "production" {
				return html
			}
			if page != nil {
				if v, ok := page.Data["imageSize"].(bool); ok && !v {
					return html
				}
			}
			pageURL := "/"
			if page != nil {
				pageURL = page.URL
			}

			return reImgTag.ReplaceAllStringFunc(html, func(tag string) string {
				hasW, hasH := reHasW.MatchString(tag), reHasH.MatchString(tag)
				if hasW && hasH {
					return tag
				}
				m := reImgSrc.FindStringSubmatch(tag)
				if m == nil {
					return tag
				}
				src := m[1]
				if src == "" {
					src = m[2]
				}
				if src == "" || reScheme.MatchString(src) {
					return tag
				}
				if i := strings.IndexAny(src, "#?"); i >= 0 {
					src = src[:i]
				}
				if base != "/" && strings.HasPrefix(src, base) {
					src = "/" + src[len(base):]
				}
				if !strings.HasPrefix(src, "/") {
					if u, err := url.Parse(src); err == nil {
						if bu, err := url.Parse("http://x.invalid" + pageURL); err == nil {
							src = bu.ResolveReference(u).Path
						}
					}
					if base != "/" && strings.HasPrefix(src, base) {
						src = "/" + src[len(base):]
					}
				}
				if !strings.HasPrefix(src, "/") {
					return tag
				}
				file := resolveFile(src)
				if file == "" {
					return tag
				}
				size := readSize(file)
				if size == nil || size.width == 0 || size.height == 0 {
					return tag
				}
				var attrs []string
				if !hasW {
					attrs = append(attrs, `width="`+strconv.Itoa(size.width)+`"`)
				}
				if !hasH {
					attrs = append(attrs, `height="`+strconv.Itoa(size.height)+`"`)
				}
				if lazy && !reHasLazy.MatchString(tag) {
					attrs = append(attrs, `loading="lazy"`)
				}
				if len(attrs) == 0 {
					return tag
				}
				at := indexFold(tag, "<img")
				return tag[:at] + "<img " + strings.Join(attrs, " ") + tag[at+4:]
			})
		},
	}
}

func parseImageSize(buf []byte) *imgSize {
	if len(buf) < 12 {
		return nil
	}
	// PNG
	if len(buf) >= 24 && binary.BigEndian.Uint32(buf[0:4]) == 0x89504e47 {
		return &imgSize{int(binary.BigEndian.Uint32(buf[16:20])), int(binary.BigEndian.Uint32(buf[20:24]))}
	}
	// GIF
	if string(buf[0:3]) == "GIF" {
		return &imgSize{int(binary.LittleEndian.Uint16(buf[6:8])), int(binary.LittleEndian.Uint16(buf[8:10]))}
	}
	// WebP
	if string(buf[0:4]) == "RIFF" && string(buf[8:12]) == "WEBP" {
		fmtStr := string(buf[12:16])
		switch fmtStr {
		case "VP8 ":
			if len(buf) >= 30 {
				return &imgSize{int(binary.LittleEndian.Uint16(buf[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(buf[28:30]) & 0x3fff)}
			}
		case "VP8L":
			if len(buf) >= 25 {
				b := binary.LittleEndian.Uint32(buf[21:25])
				return &imgSize{int(b&0x3fff) + 1, int((b>>14)&0x3fff) + 1}
			}
		case "VP8X":
			if len(buf) >= 30 {
				return &imgSize{int(le24(buf[24:27])) + 1, int(le24(buf[27:30])) + 1}
			}
		}
		return nil
	}
	// JPEG
	if buf[0] == 0xff && buf[1] == 0xd8 {
		i := 2
		for i+9 < len(buf) {
			if buf[i] != 0xff {
				i++
				continue
			}
			marker := buf[i+1]
			if marker == 0xd8 || marker == 0x01 || (marker >= 0xd0 && marker <= 0xd7) || marker == 0xff {
				i += 2
				continue
			}
			l := int(binary.BigEndian.Uint16(buf[i+2 : i+4]))
			if l < 2 {
				break
			}
			if marker >= 0xc0 && marker <= 0xcf && marker != 0xc4 && marker != 0xc8 && marker != 0xcc {
				return &imgSize{
					width:  int(binary.BigEndian.Uint16(buf[i+7 : i+9])),
					height: int(binary.BigEndian.Uint16(buf[i+5 : i+7])),
				}
			}
			i += 2 + l
		}
		return nil
	}
	// SVG
	end := len(buf)
	if end > 4096 {
		end = 4096
	}
	text := string(buf[:end])
	if strings.Contains(strings.ToLower(text), "<svg") {
		w := reSVGW.FindStringSubmatch(text)
		h := reSVGH.FindStringSubmatch(text)
		if w != nil && h != nil {
			return &imgSize{int(mathRound(w[1])), int(mathRound(h[1]))}
		}
		vb := reSVGVB.FindStringSubmatch(text)
		if vb != nil {
			return &imgSize{int(mathRound(vb[1])), int(mathRound(vb[2]))}
		}
	}
	return nil
}

func le24(b []byte) uint32 {
	return uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16
}

func mathRound(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	if v < 0 {
		v = -v
	}
	return float64(int(v + 0.5))
}
