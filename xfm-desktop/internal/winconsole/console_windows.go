// Package winconsole 处理 Windows 控制台窗口：GUI 模式启动后主动脱离控制台。
package winconsole

import "golang.org/x/sys/windows"

// HideConsole 关闭随程序启动而创建的控制台窗口。
// 程序仍保持 console 子系统，命令行模式可正常同步输出；
// 只有纯 GUI 启动（双击）时才调用本函数。
func HideConsole() {
	kernel32 := windows.NewLazySystemDLL("kernel32.dll")
	free := kernel32.NewProc("FreeConsole")
	_, _, _ = free.Call()
}
