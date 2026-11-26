//go:build !linux

package gui

// ensureDesktopSession 在非 Linux 平台无需处理 D-Bus 会话总线，
// Fyne 使用各平台原生的主题监听机制。
func ensureDesktopSession() func() { return func() {} }
