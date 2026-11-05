// Arma un video vertical con imágenes + música. Uso: swift video.swift salida.mp4 musica.wav img1 img2 ...
import AVFoundation
import CoreImage
import Foundation

let a = CommandLine.arguments
let outURL = URL(fileURLWithPath: a[1])
let musicURL = URL(fileURLWithPath: a[2])
let imgs = a[3...].map { CIImage(contentsOf: URL(fileURLWithPath: $0))! }

let W = 1080, H = 1920, fps: Int32 = 30
let porSlide = 4.8, fundido = 0.6
let total = Double(imgs.count) * porSlide - Double(imgs.count - 1) * fundido
let frames = Int(total * Double(fps))

let tmp = outURL.deletingLastPathComponent().appendingPathComponent("_solo-video.mov")
try? FileManager.default.removeItem(at: tmp)
try? FileManager.default.removeItem(at: outURL)

let w = try! AVAssetWriter(outputURL: tmp, fileType: .mov)
let inp = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: W, AVVideoHeightKey: H,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 10_000_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
])
let ad = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: inp, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: W, kCVPixelBufferHeightKey as String: H,
])
w.add(inp); w.startWriting(); w.startSession(atSourceTime: .zero)
let ctx = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])
let rect = CGRect(x: 0, y: 0, width: W, height: H)

func zoom(_ img: CIImage, _ p: Double) -> CIImage {
  let s = 1.0 + 0.035 * p
  let tx = CGAffineTransform(translationX: -Double(W) / 2, y: -Double(H) / 2).concatenating(CGAffineTransform(scaleX: s, y: s)).concatenating(CGAffineTransform(translationX: Double(W) / 2, y: Double(H) / 2))
  return img.transformed(by: tx).cropped(to: rect)
}
func ease(_ x: Double) -> Double { x * x * (3 - 2 * x) }

for f in 0..<frames {
  let t = Double(f) / Double(fps)
  // El banner i arranca en i·paso y dura porSlide; los primeros "fundido" segundos se mezcla con el anterior.
  let paso = porSlide - fundido
  let i = min(Int(t / paso), imgs.count - 1)
  let local = t - Double(i) * paso
  var img = zoom(imgs[i], local / porSlide)
  if i > 0, local < fundido {
    let prev = zoom(imgs[i - 1], (local + paso) / porSlide)
    img = prev.applyingFilter("CIDissolveTransition", parameters: ["inputTargetImage": img, "inputTime": ease(local / fundido)])
  }
  while !inp.isReadyForMoreMediaData { usleep(2000) }
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, ad.pixelBufferPool!, &pb)
  ctx.render(img.cropped(to: rect), to: pb!, bounds: rect, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
  ad.append(pb!, withPresentationTime: CMTime(value: CMTimeValue(f), timescale: fps))
}
inp.markAsFinished()
let sem = DispatchSemaphore(value: 0)
w.finishWriting { sem.signal() }; sem.wait()

// Sumar la música
let comp = AVMutableComposition()
let vAsset = AVURLAsset(url: tmp), mAsset = AVURLAsset(url: musicURL)
let vTrack = vAsset.tracks(withMediaType: .video)[0]
let range = CMTimeRange(start: .zero, duration: vAsset.duration)
let cv = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
try! cv.insertTimeRange(range, of: vTrack, at: .zero)
let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
let mDur = CMTimeMinimum(mAsset.duration, vAsset.duration)
try! ca.insertTimeRange(CMTimeRange(start: .zero, duration: mDur), of: mAsset.tracks(withMediaType: .audio)[0], at: .zero)
let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality)!
ex.outputURL = outURL; ex.outputFileType = .mp4; ex.shouldOptimizeForNetworkUse = true
ex.exportAsynchronously { sem.signal() }; sem.wait()
try? FileManager.default.removeItem(at: tmp)
print(ex.status == .completed ? "ok \(outURL.path) \(String(format: "%.1f", total)) s" : "error \(String(describing: ex.error))")
