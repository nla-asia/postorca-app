// mac-native.test.cjs appends this to mac.swift in place of its entry point.
var failures = 0
func expect(_ ok: Bool, _ name: String) {
    if !ok { failures += 1; print("FAIL: \(name)") }
}
// Clock with its "Choose a City" sheet open; macOS names the sheet's CG window "Untitled".
let main = CGRect(x: 223, y: 72, width: 1024, height: 768)
let sheet = CGRect(x: 445, y: 136, width: 580, height: 640)
let clock: [(frame: CGRect?, title: String?)] = [(main, "Clock"), (sheet, nil)]
expect(uniqueWindowMatch(clock, sheet, "Untitled") == 1, "an untitled sheet matches by its frame")
expect(uniqueWindowMatch(clock, main, "Clock") == 0, "the main window still matches while the sheet is open")
expect(uniqueWindowMatch(clock, CGRect(x: 224.5, y: 73, width: 1023, height: 769), "") == 0, "frames match within the rounding tolerance")
expect(uniqueWindowMatch([(main, "Clock")], sheet, "Untitled") == nil, "a window missing from Accessibility is not matched")
expect(uniqueWindowMatch([(nil, nil), (main, "Clock")], main, "Clock") == 1, "candidates without a frame are skipped")
let twins: [(frame: CGRect?, title: String?)] = [(main, "Notes"), (main, "Clock")]
expect(uniqueWindowMatch(twins, main, "Clock") == 1, "a title separates windows that share a frame")
expect(uniqueWindowMatch(twins, main, "") == nil, "same-frame windows without a title are ambiguous")
expect(uniqueWindowMatch([(main, nil), (main, nil)], main, "Untitled") == nil, "same-frame untitled windows are ambiguous")
exit(failures == 0 ? 0 : 1)
