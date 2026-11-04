// Records text positions in exported Stitch PNGs so build.mjs can place hotspots on screens
// that have no saved HTML. macOS only (Vision); the JSON output is committed, so builds run anywhere.
//
//   swift design/preview/ocr.swift <image.png> <out.json> [<image.png> <out.json> ...]
//
// Output: { width, height, lines: [{ text, box: [x, y, w, h], words: [{ t, box }] }] } in image pixels, top-left origin.
import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data((message + "\n").utf8))
  exit(1)
}

func pixelBox(_ r: CGRect, _ w: Int, _ h: Int) -> [Int] {
  [
    Int((r.minX * CGFloat(w)).rounded()),
    Int(((1 - r.maxY) * CGFloat(h)).rounded()),
    Int((r.width * CGFloat(w)).rounded()),
    Int((r.height * CGFloat(h)).rounded()),
  ]
}

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty || args.count % 2 != 0 { fail("usage: swift ocr.swift <image.png> <out.json> [...]") }

for i in stride(from: 0, to: args.count, by: 2) {
  let input = URL(fileURLWithPath: args[i])
  guard let source = CGImageSourceCreateWithURL(input as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else { fail("cannot read \(args[i])") }
  let w = image.width
  let h = image.height

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
  } catch {
    fail("text recognition failed for \(args[i]): \(error)")
  }

  var lines: [[String: Any]] = []
  for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    let text = candidate.string
    var words: [[String: Any]] = []
    text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: .byWords) { word, range, _, _ in
      guard let word = word, let box = try? candidate.boundingBox(for: range) else { return }
      words.append(["t": word, "box": pixelBox(box.boundingBox, w, h)])
    }
    lines.append(["text": text, "box": pixelBox(observation.boundingBox, w, h), "words": words])
  }

  let out: [String: Any] = ["width": w, "height": h, "lines": lines]
  do {
    let data = try JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])
    try data.write(to: URL(fileURLWithPath: args[i + 1]))
  } catch {
    fail("cannot write \(args[i + 1]): \(error)")
  }
  print("ocr: \(args[i + 1]) (\(lines.count) lines)")
}
