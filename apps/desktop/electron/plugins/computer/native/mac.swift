import AppKit
import ApplicationServices

func fail(_ message: String) throws -> Never { throw NSError(domain: "ComputerUse", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
func bounds(_ rect: CGRect) -> [String: Any] { ["x": Double(rect.origin.x), "y": Double(rect.origin.y), "width": Double(rect.width), "height": Double(rect.height)] }
func windowList() -> [[String: Any]] {
    (CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []).compactMap { info in
        guard let id = info[kCGWindowNumber as String] as? Int,
              let pid = info[kCGWindowOwnerPID as String] as? Int,
              let frame = info[kCGWindowBounds as String] as? [String: Any],
              (info[kCGWindowLayer as String] as? Int ?? 0) == 0 else { return nil }
        let rect = CGRect(x: (frame["X"] as? NSNumber)?.doubleValue ?? 0, y: (frame["Y"] as? NSNumber)?.doubleValue ?? 0,
                          width: (frame["Width"] as? NSNumber)?.doubleValue ?? 0, height: (frame["Height"] as? NSNumber)?.doubleValue ?? 0)
        // Match the existing screen-capture window discovery convention. macOS can
        // attribute tiny capture/status overlays to an app; these are not task windows.
        guard rect.width >= 80, rect.height >= 80,
              (info[kCGWindowAlpha as String] as? Double ?? 1) > 0 else { return nil }
        return ["id": String(id), "pid": pid, "title": info[kCGWindowName as String] as? String ?? "", "bounds": bounds(rect)]
    }
}
func axValue(_ element: AXUIElement, _ attribute: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success ? value : nil
}
func axFrame(_ element: AXUIElement) -> CGRect? {
    guard let p = axValue(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
          let s = axValue(element, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point); AXValueGetValue(s as! AXValue, .cgSize, &size)
    return size.width > 0 && size.height > 0 ? CGRect(origin: point, size: size) : nil
}
func axWindow(_ pid: pid_t, _ target: [String: Any]) throws -> AXUIElement {
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 2)
    // A sheet or panel is its own CG window, but Accessibility lists a sheet as an
    // AXSheet child of its parent window rather than in the app's window list.
    var candidates: [AXUIElement] = []
    func add(_ value: CFTypeRef?) {
        guard let value, CFGetTypeID(value) == AXUIElementGetTypeID() else { return }
        let element = value as! AXUIElement
        if !candidates.contains(where: { CFEqual($0, element) }) { candidates.append(element) }
    }
    (axValue(app, kAXWindowsAttribute) as? [AXUIElement] ?? []).forEach { add($0) }
    add(axValue(app, kAXFocusedWindowAttribute)); add(axValue(app, kAXMainWindowAttribute))
    for window in candidates {
        for child in axValue(window, kAXChildrenAttribute) as? [AXUIElement] ?? [] where axValue(child, kAXRoleAttribute) as? String == kAXSheetRole { add(child) }
    }
    let frame = target["bounds"] as! [String: Any]
    let rect = CGRect(x: frame["x"] as! Double, y: frame["y"] as! Double, width: frame["width"] as! Double, height: frame["height"] as! Double)
    let described = candidates.map { element -> (frame: CGRect?, title: String?) in
        guard let p = axValue(element, kAXPositionAttribute), CFGetTypeID(p) == AXValueGetTypeID(),
              let s = axValue(element, kAXSizeAttribute), CFGetTypeID(s) == AXValueGetTypeID() else { return (nil, nil) }
        var point = CGPoint.zero, size = CGSize.zero
        AXValueGetValue(p as! AXValue, .cgPoint, &point); AXValueGetValue(s as! AXValue, .cgSize, &size)
        return (CGRect(origin: point, size: size), axValue(element, kAXTitleAttribute) as? String)
    }
    guard let index = uniqueWindowMatch(described, rect, target["title"] as? String ?? "") else { try fail("Cannot uniquely match the selected window. Check Accessibility permission and observe again.") }
    return candidates[index]
}
// Match the AX window to the CG window by position and size; never pick an arbitrary
// window. The title only separates candidates that share a frame.
func uniqueWindowMatch(_ candidates: [(frame: CGRect?, title: String?)], _ target: CGRect, _ title: String) -> Int? {
    let matches = candidates.indices.filter { index in
        guard let a = candidates[index].frame else { return false }
        return abs(a.minX - target.minX) < 3 && abs(a.minY - target.minY) < 3 && abs(a.width - target.width) < 3 && abs(a.height - target.height) < 3
    }
    if matches.count == 1 { return matches[0] }
    let titled = matches.filter { !title.isEmpty && candidates[$0].title == title }
    return titled.count == 1 ? titled[0] : nil
}
// Resolve app menus only; unnamed AXMenu containers do not add a path segment.
func menuChildren(_ element: AXUIElement) -> [AXUIElement] {
    (axValue(element, kAXChildrenAttribute) as? [AXUIElement] ?? []).flatMap { child -> [AXUIElement] in
        if axValue(child, kAXRoleAttribute) as? String == kAXMenuRole { return menuChildren(child) }
        return [child]
    }
}
func menuItems(_ pid: pid_t) -> [[String: Any]] {
    guard let root = axValue(AXUIElementCreateApplication(pid), kAXMenuBarAttribute) else { return [] }
    var result: [[String: Any]] = []
    func visit(_ element: AXUIElement, _ path: [String], _ depth: Int) {
        guard depth < 4, result.count < 150 else { return }
        for child in menuChildren(element) {
            let title = axValue(child, kAXTitleAttribute) as? String ?? ""
            // The Apple menu is system-wide, not a menu of the selected app.
            if title.isEmpty || (path.isEmpty && title == "Apple") { continue }
            let next = path + [title]
            result.append(["path": next, "enabled": axValue(child, kAXEnabledAttribute) as? Bool ?? false])
            visit(child, next, depth + 1)
        }
    }
    visit(root as! AXUIElement, [], 0)
    return result
}
func run(_ request: [String: Any]) throws -> [String: Any] {
    let action = request["action"] as? String ?? ""
    if action == "list" {
        let windows = windowList()
        var apps: [String: [String: Any]] = [:]
        for app in NSWorkspace.shared.runningApplications where app.activationPolicy == .regular {
            guard let url = app.bundleURL else { continue }
            apps[url.path] = ["id": url.path, "path": url.path, "name": app.localizedName ?? url.deletingPathExtension().lastPathComponent,
                              "running": true, "windows": windows.filter { $0["pid"] as? Int == Int(app.processIdentifier) }]
        }
        if request["running_only"] as? Bool != true {
            var folders = ["/Applications", "/System/Applications", NSHomeDirectory() + "/Applications"]
            // Developer tools are nested inside the selected Xcode app bundle.
            let selector = Process(); let pipe = Pipe()
            selector.executableURL = URL(fileURLWithPath: "/usr/bin/xcode-select")
            selector.arguments = ["-p"]; selector.standardOutput = pipe; selector.standardError = FileHandle.nullDevice
            if (try? selector.run()) != nil {
                let data = pipe.fileHandleForReading.readDataToEndOfFile(); selector.waitUntilExit()
                if selector.terminationStatus == 0, let developer = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) {
                    folders.append(developer + "/Applications")
                }
            }
            for folder in folders {
                guard let enumerator = FileManager.default.enumerator(at: URL(fileURLWithPath: folder), includingPropertiesForKeys: nil, options: [.skipsHiddenFiles]) else { continue }
                for case let url as URL in enumerator {
                    if url.pathExtension == "app" {
                        enumerator.skipDescendants()
                        if apps[url.path] == nil {
                            let bundle = Bundle(url: url)
                            apps[url.path] = ["id": url.path, "path": url.path, "name": bundle?.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? url.deletingPathExtension().lastPathComponent, "running": false, "windows": []]
                        }
                    }
                }
            }
        }
        return ["apps": apps.values.sorted { ($0["name"] as! String) < ($1["name"] as! String) }]
    }
    if action == "open" {
        guard let app = request["app"] as? [String: Any], let path = app["id"] as? String, path.hasSuffix(".app"), FileManager.default.fileExists(atPath: path) else { try fail("App is no longer available; list apps again.") }
        let semaphore = DispatchSemaphore(value: 0)
        var launchError: Error?
        NSWorkspace.shared.openApplication(at: URL(fileURLWithPath: path), configuration: NSWorkspace.OpenConfiguration()) { _, error in launchError = error; semaphore.signal() }
        while semaphore.wait(timeout: .now()) != .success { RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02)) }
        if let error = launchError { throw error }
        return ["requested": true]
    }
    guard let id = request["window"] as? String, let window = windowList().first(where: { $0["id"] as? String == id }), let pid = window["pid"] as? Int else { try fail("Window is no longer visible; list apps again.") }
    if let expected = request["expected_pid"] as? Int, pid != expected { try fail("Window belongs to another process; list apps again.") }
    let app = NSRunningApplication(processIdentifier: pid_t(pid))
    if action == "focus" {
        guard AXIsProcessTrusted() else { try fail("Grant Accessibility permission to PostOrca in System Settings.") }
        let ax = try axWindow(pid_t(pid), window)
        // A sheet raises with its parent window.
        let parent = axValue(ax, kAXParentAttribute)
        let raised = axValue(ax, kAXRoleAttribute) as? String == kAXSheetRole && parent.map({ CFGetTypeID($0) == AXUIElementGetTypeID() }) == true ? parent as! AXUIElement : ax
        AXUIElementPerformAction(raised, kAXRaiseAction as CFString)
        app?.activate(options: [])
        Thread.sleep(forTimeInterval: 0.12)
        let fresh = windowList()
        // CG windows are ordered front to back; reject a sibling or modal window above the target.
        let front = fresh.first(where: { $0["pid"] as? Int == pid })
        var result: [String: Any] = ["window": fresh.first(where: { $0["id"] as? String == id }) ?? window,
                                     "foreground": app?.isActive == true && front?["id"] as? String == id]
        // Name the sheet or panel in front so the caller can observe it instead.
        if let front, front["id"] as? String != id { result["front"] = front }
        return result
    }
    if action == "window" { return ["window": window, "foreground": app?.isActive == true] }
    if action == "menu" {
        guard AXIsProcessTrusted(), app?.isActive == true else { try fail("The selected app is not active or Accessibility permission is missing.") }
        guard windowList().first(where: { $0["pid"] as? Int == pid })?["id"] as? String == id else { try fail("Another window is above the selected window. Observe it again.") }
        guard let path = request["menu_path"] as? [String], path.count >= 2, path.count <= 4, path.first != "Apple",
              let root = axValue(AXUIElementCreateApplication(pid_t(pid)), kAXMenuBarAttribute) else { try fail("Invalid app menu path.") }
        var current = root as! AXUIElement
        var chain: [AXUIElement] = []
        // Validate the complete path and current enabled state before any UI effect.
        for name in path {
            let matches = menuChildren(current).filter { axValue($0, kAXTitleAttribute) as? String == name }
            guard matches.count == 1, axValue(matches[0], kAXEnabledAttribute) as? Bool == true else { try fail("Menu item is missing, ambiguous or disabled. Observe with accessibility again.") }
            current = matches[0]; chain.append(current)
        }
        // AXPress invokes the actual menu command, rather than a shortcut or private API.
        for item in chain {
            guard AXUIElementPerformAction(item, kAXPressAction as CFString) == .success else { try fail("Menu input may have been sent; observe before retrying.") }
            Thread.sleep(forTimeInterval: 0.08)
        }
        Thread.sleep(forTimeInterval: 0.3)
        return ["input_sent": true, "menu_path": path, "menus": menuItems(pid_t(pid)), "window_closed": !windowList().contains(where: { $0["id"] as? String == id })]
    }
    if action == "accessibility" {
        guard AXIsProcessTrusted() else { try fail("Accessibility permission is missing.") }
        let root = try axWindow(pid_t(pid), window)
        var queue: [(AXUIElement, Int)] = [(root, 0)], nodes: [[String: Any]] = []
        let deadline = Date(timeIntervalSinceNow: 4)
        var characters = 0
        while !queue.isEmpty && nodes.count < 400 && characters < 24000 && Date() < deadline {
            let (element, depth) = queue.removeFirst()
            AXUIElementSetMessagingTimeout(element, 0.5)
            let role = axValue(element, kAXRoleAttribute) as? String ?? ""
            let subrole = axValue(element, kAXSubroleAttribute) as? String ?? ""
            if subrole != kAXSecureTextFieldSubrole {
                let text = [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute].compactMap { axValue(element, $0) as? String }.joined(separator: "\n")
                let bounded = String(text.prefix(2000)); characters += bounded.count
                var node: [String: Any] = ["role": role, "text": bounded, "depth": depth]
                // Global top-left points, the same space as the CG window bounds.
                if let rect = axFrame(element) { node["bounds"] = bounds(rect) }
                var actions: CFArray?
                if AXUIElementCopyActionNames(element, &actions) == .success, (actions as? [String] ?? []).contains(kAXPressAction) { node["actionable"] = true }
                nodes.append(node)
            }
            if depth < 12, let children = axValue(element, kAXChildrenAttribute) as? [AXUIElement] { queue.append(contentsOf: children.prefix(max(0, 500 - queue.count)).map { ($0, depth + 1) }) }
        }
        return ["nodes": nodes, "truncated": !queue.isEmpty, "source": "macOS Accessibility", "menus": menuItems(pid_t(pid))]
    }
    try fail("Unsupported native action.")
}
// Entry point. mac-native.test.cjs replaces everything from here with the tests.
do {
    let request = try JSONSerialization.jsonObject(with: FileHandle.standardInput.readDataToEndOfFile()) as! [String: Any]
    let result = try run(request)
    FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]))
} catch {
    FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: ["error": error.localizedDescription]))
}
