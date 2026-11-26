//go:build !windows

package winconsole

// HideConsole 在非 Windows 平台上不需要处理控制台。
func HideConsole() {}
