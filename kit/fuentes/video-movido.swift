// Video animado al ritmo: cada banner se arma por capas que entran una por tiempo.
// Uso: ./vm salida.mp4 musica.wav carpeta-de-capas
// La carpeta tiene bN-c0.png (fondo) y bN-c1.png… (capas transparentes), exportadas de banners.html#bN?capa=K
import AVFoundation
import CoreImage
import Foundation

let a = CommandLine.arguments
let outURL = URL(fileURLWithPath: a[1]), musicURL = URL(fileURLWithPath: a[2]), dir = a[3]
let W = 1080.0, H = 1920.0, fps: Int32 = 30
let beat = 60.0 / 116.0
let beatsPorBanner: [Double] = [8, 8, 8, 8, 8, 8, 10]

struct Banner { let fondo: CIImage; let capas: [CIImage] }
var banners: [Banner] = []
for i in 1...beatsPorBanner.count {
  let url = { (c: Int) in URL(fileURLWithPath: "\(dir)/b\(i)-c\(c).png") }
  var capas: [CIImage] = []
  var c = 1
  while FileManager.default.fileExists(atPath: url(c).path) { capas.append(CIImage(contentsOf: url(c))!); c += 1 }
  banners.append(Banner(fondo: CIImage(contentsOf: url(0))!, capas: capas))
}
var inicios: [Double] = [0]
for b in beatsPorBanner { inicios.append(inicios.last! + b * beat) }
let total = inicios.last!
let frames = Int(total * Double(fps))
let rect = CGRect(x: 0, y: 0, width: W, height: H)

func escala(_ img: CIImage, _ s: Double, cx: Double = W / 2, cy: Double = H / 2) -> CIImage {
  img.transformed(by: CGAffineTransform(translationX: -cx, y: -cy).concatenating(CGAffineTransform(scaleX: s, y: s)).concatenating(CGAffineTransform(translationX: cx, y: cy)))
}
func alfa(_ img: CIImage, _ x: Double) -> CIImage {
  img.applyingFilter("CIColorMatrix", parameters: ["inputAVector": CIVector(x: 0, y: 0, z: 0, w: x)])
}
func easeOutBack(_ x: Double) -> Double { let c1 = 1.5, c3 = c1 + 1; return 1 + c3 * pow(x - 1, 3) + c1 * pow(x - 1, 2) }
func easeOut(_ x: Double) -> Double { 1 - pow(1 - x, 3) }
func clamp(_ x: Double) -> Double { max(0, min(1, x)) }

// Arma el banner i en el momento "local" (segundos desde que empezó)
func cuadro(_ i: Int, _ local: Double) -> CIImage {
  let dur = beatsPorBanner[i] * beat
  let tb = local.truncatingRemainder(dividingBy: beat)
  let pulso = 1 + 0.014 * exp(-tb / 0.11)                 // late con el bombo
  var img = escala(banners[i].fondo, (1 + 0.03 * local / dur) * pulso).cropped(to: rect)
  for (k, capa) in banners[i].capas.enumerated() {
    let t0 = Double(k) * beat + 0.04
    if local < t0 { continue }
    let p = clamp((local - t0) / 0.34)
    let y = (1 - easeOutBack(p)) * -110                   // sube desde abajo
    var c = escala(capa, 0.94 + 0.06 * easeOut(p)).transformed(by: CGAffineTransform(translationX: 0, y: y))
    c = alfa(c, easeOut(clamp(p * 1.6)))
    img = c.composited(over: img)
  }
  return img.cropped(to: rect)
}

let tmp = outURL.deletingLastPathComponent().appendingPathComponent("_solo-video.mov")
try? FileManager.default.removeItem(at: tmp); try? FileManager.default.removeItem(at: outURL)
let w = try! AVAssetWriter(outputURL: tmp, fileType: .mov)
let inp = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: Int(W), AVVideoHeightKey: Int(H),
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel],
])
let ad = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: inp, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA, kCVPixelBufferWidthKey as String: Int(W), kCVPixelBufferHeightKey as String: Int(H),
])
w.add(inp); w.startWriting(); w.startSession(atSourceTime: .zero)
let cs = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CIContext(options: [.workingColorSpace: cs])
let cruce = 0.18

for f in 0..<frames {
  let t = Double(f) / Double(fps)
  var i = 0
  while i + 1 < banners.count && t >= inicios[i + 1] { i += 1 }
  let local = t - inicios[i]
  // Entrada con "golpe" de zoom
  let entra = clamp(local / 0.32)
  var img = escala(cuadro(i, local), 1 + 0.06 * (1 - easeOut(entra))).cropped(to: rect)
  // Salida: el banner anterior se agranda y se desvanece encima
  if i > 0 && local < cruce {
    let prevLocal = inicios[i] - inicios[i - 1] + local
    let p = local / cruce
    let prev = escala(cuadro(i - 1, prevLocal), 1 + 0.08 * p).cropped(to: rect)
    img = alfa(prev, 1 - easeOut(p)).composited(over: img)
  }
  while !inp.isReadyForMoreMediaData { usleep(2000) }
  var pb: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, ad.pixelBufferPool!, &pb)
  ctx.render(img.cropped(to: rect), to: pb!, bounds: rect, colorSpace: cs)
  ad.append(pb!, withPresentationTime: CMTime(value: CMTimeValue(f), timescale: fps))
}
inp.markAsFinished()
let sem = DispatchSemaphore(value: 0)
w.finishWriting { sem.signal() }; sem.wait()

let comp = AVMutableComposition()
let vAsset = AVURLAsset(url: tmp), mAsset = AVURLAsset(url: musicURL)
let cv = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
try! cv.insertTimeRange(CMTimeRange(start: .zero, duration: vAsset.duration), of: vAsset.tracks(withMediaType: .video)[0], at: .zero)
let ca = comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)!
try! ca.insertTimeRange(CMTimeRange(start: .zero, duration: CMTimeMinimum(mAsset.duration, vAsset.duration)), of: mAsset.tracks(withMediaType: .audio)[0], at: .zero)
let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPresetHighestQuality)!
ex.outputURL = outURL; ex.outputFileType = .mp4; ex.shouldOptimizeForNetworkUse = true
ex.exportAsynchronously { sem.signal() }; sem.wait()
try? FileManager.default.removeItem(at: tmp)
print(ex.status == .completed ? "ok \(outURL.path) \(String(format: "%.2f", total)) s" : "falló la exportación")
