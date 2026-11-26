//go:build linux

package gui

import (
	"bufio"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// ensureDesktopSession 保证 Linux 桌面会话具备一个可用的 D-Bus 会话总线。
//
// Fyne 启动时会在后台监听系统主题（app_xdg.go 的 watchTheme），它会调用
// dbus.SessionBus()。当 DBUS_SESSION_BUS_ADDRESS 为空且 /run/user/<uid>/bus
// 不存在时，godbus 会尝试执行 dbus-launch；而精简系统/容器里通常只装了
// dbus-daemon 而没有 dbus-launch，于是启动时打印：
//
//	Fyne error: failed to watch theme settings
//	  Cause: exec: "dbus-launch": executable file not found in $PATH
//
// 这里按以下顺序消除该错误：
//  1. 已设置 FYNE_THEME：Fyne 不会监听主题，直接返回；
//  2. 已存在有效的 DBUS_SESSION_BUS_ADDRESS：直接复用；
//  3. /run/user/<uid>/bus 存在：直接指向该 socket；
//  4. 启动一个私有 dbus-daemon 并在退出时回收；
//  5. 以上都不行：设置 FYNE_THEME 让 Fyne 跳过主题监听，避免执行 dbus-launch。
//
// 返回的清理函数用于回收第 4 步启动的私有总线。
func ensureDesktopSession() func() {
	if os.Getenv("FYNE_THEME") != "" {
		return noop
	}
	if addr := os.Getenv("DBUS_SESSION_BUS_ADDRESS"); addr != "" && addr != "autolaunch:" {
		return noop
	}
	if addr := discoverSessionBusAddress(); addr != "" {
		_ = os.Setenv("DBUS_SESSION_BUS_ADDRESS", addr)
		return noop
	}
	if cmd, addr, err := startPrivateSessionBus(); err == nil {
		_ = os.Setenv("DBUS_SESSION_BUS_ADDRESS", addr)
		return func() {
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
				_, _ = cmd.Process.Wait()
			}
		}
	}
	// 无法建立会话总线：让 Fyne 跳过主题监听，避免执行缺失的 dbus-launch。
	_ = os.Setenv("FYNE_THEME", "light")
	return noop
}

func noop() {}

// discoverSessionBusAddress 复用系统已有的会话总线 socket。
func discoverSessionBusAddress() string {
	dir := filepath.Join("/run/user", strconv.Itoa(os.Getuid()))
	busFile := filepath.Join(dir, "bus")
	if st, err := os.Stat(busFile); err == nil && !st.IsDir() {
		return "unix:path=" + busFile
	}
	if data, err := os.ReadFile(filepath.Join(dir, "dbus-session")); err == nil {
		if addr, ok := strings.CutPrefix(string(data), "DBUS_SESSION_BUS_ADDRESS="); ok {
			if addr = strings.TrimSpace(addr); addr != "" {
				return addr
			}
		}
	}
	return ""
}

// startPrivateSessionBus 启动一个前台 dbus-daemon 并读取其会话地址。
func startPrivateSessionBus() (*exec.Cmd, string, error) {
	cmd := exec.Command("dbus-daemon", "--session", "--print-address=1", "--nofork", "--nopidfile")
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, "", err
	}
	if err := cmd.Start(); err != nil {
		return nil, "", err
	}
	line, err := bufio.NewReader(stdout).ReadString('\n')
	if err != nil {
		stopCmd(cmd)
		return nil, "", err
	}
	addr := strings.TrimSpace(line)
	if addr == "" {
		stopCmd(cmd)
		return nil, "", errors.New("dbus-daemon 未返回会话地址")
	}
	return cmd, addr, nil
}

func stopCmd(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}
}
