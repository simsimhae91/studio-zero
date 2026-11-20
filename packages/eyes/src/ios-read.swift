// The words in a picture of a screen, each with its place, read by macOS's own text recognition (Vision).
//   swift ios-read.swift <picture.png> <the screen's width in points> <its height in points>
// Prints a line for each row of words it reads: x1<TAB>y1<TAB>x2<TAB>y2<TAB>the words, in points from the top left.
// A screen's tree says what an app's parts are called and where they are laid out, not which of them a person
// sees: what lies behind a fixed bar, or scrolled out of sight, is in the tree all the same. The picture is what
// a person sees.
import AppKit
import Foundation
import Vision

let args = CommandLine.arguments
guard args.count >= 4, let width = Double(args[2]), let height = Double(args[3]), width > 0, height > 0 else {
  FileHandle.standardError.write("ios-read.swift <picture.png> <width in points> <height in points>\n".data(using: .utf8)!)
  exit(2)
}
guard let image = NSImage(contentsOfFile: args[1]), let picture = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
  FileHandle.standardError.write("\(args[1]) is not a picture that can be read\n".data(using: .utf8)!)
  exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLanguages = ["ko-KR", "en-US"]
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: picture, options: [:]).perform([request])
for row in request.results ?? [] {
  guard let read = row.topCandidates(1).first else { continue }
  // Vision measures from the bottom left, in parts of the whole picture.
  let box = row.boundingBox
  let words = read.string.replacingOccurrences(of: "\t", with: " ").replacingOccurrences(of: "\n", with: " ")
  print("\(Int((box.minX * width).rounded()))\t\(Int(((1 - box.maxY) * height).rounded()))\t\(Int((box.maxX * width).rounded()))\t\(Int(((1 - box.minY) * height).rounded()))\t\(words)")
}
