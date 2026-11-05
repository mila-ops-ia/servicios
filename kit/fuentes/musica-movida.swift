// Música pop/house original, sintetizada (116 bpm). Uso: swiftc -O musica-movida.swift -o mm && ./mm salida.wav
import Foundation

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "musica-movida.wav"
let sr = 44100.0
let bpm = 116.0
let beat = 60.0 / bpm
let totalBeats = 58.0               // 7 banners: seis de 8 tiempos y el último de 10
let dur = totalBeats * beat + 0.05
let n = Int(dur * sr)
var mL = [Double](repeating: 0, count: n), mR = mL   // música (se "agacha" con el bombo)
var dL = mL, dR = mL                                  // batería

func hz(_ m: Double) -> Double { 440 * pow(2, (m - 69) / 12) }
var seed: UInt64 = 11
func rnd() -> Double { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Double(seed >> 33) / Double(1 << 31) - 0.5 }

func add(_ L: inout [Double], _ R: inout [Double], _ t0: Double, _ len: Double, pan: Double, _ f: (Double) -> Double) {
  let s = Int(t0 * sr), e = min(n, Int((t0 + len) * sr)); if s >= n || s < 0 { return }
  let gl = cos((pan + 1) * .pi / 4), gr = sin((pan + 1) * .pi / 4)
  for i in s..<e { let v = f(Double(i - s) / sr); L[i] += v * gl; R[i] += v * gr }
}
// Onda "supersaw" suave
func saw(_ f: Double, _ t: Double) -> Double { let x = f * t; return 2 * (x - floor(x + 0.5)) }

// Am – F – C – G (alegre y pegadizo)
let chords: [[Double]] = [[57, 60, 64, 69], [53, 57, 60, 65], [48, 52, 55, 60], [55, 59, 62, 67]]
let roots: [Double] = [45, 41, 36, 43]
let bars = Int(ceil(totalBeats / 4))
let endBar = bars - 1

for b in 0..<bars {
  let t0 = Double(b) * 4 * beat
  let ch = chords[b % 4], r = roots[b % 4]
  let intro = b == 0, final = b == endBar

  // Acordes cortos en contratiempo (stabs)
  for k in 0..<8 where k % 2 == 1 || k == 0 {
    for (j, m) in ch.enumerated() {
      for det in [-0.08, 0.08] {
        let f = hz(m) * pow(2, det / 12)
        add(&mL, &mR, t0 + Double(k) * beat / 2, beat * 0.42, pan: det * 6 + Double(j - 2) * 0.1) { t in
          let env = min(1, t / 0.004) * exp(-t * 9)
          return saw(f, t) * env * 0.028
        }
      }
    }
  }
  // Arpegio brillante en semicorcheas
  if !intro {
    let arp = [ch[0] + 12, ch[1] + 12, ch[2] + 12, ch[3] + 12, ch[2] + 12, ch[1] + 12, ch[3] + 12, ch[0] + 24]
    for k in 0..<16 {
      let f = hz(arp[k % 8])
      add(&mL, &mR, t0 + Double(k) * beat / 4, beat * 0.3, pan: k % 2 == 0 ? -0.45 : 0.45) { t in
        let env = min(1, t / 0.003) * exp(-t * 16)
        return (sin(2 * .pi * f * t) + 0.35 * sin(4 * .pi * f * t)) * env * 0.05
      }
    }
  }
  // Bajo en corcheas, con salto de octava
  for k in 0..<8 {
    let m = r + (k % 2 == 1 ? 12 : 0)
    let f = hz(m)
    add(&mL, &mR, t0 + Double(k) * beat / 2, beat * 0.45, pan: 0) { t in
      let env = min(1, t / 0.005) * exp(-t * 6)
      return (sin(2 * .pi * f * t) + 0.3 * saw(f, t) * exp(-t * 14)) * env * 0.17
    }
  }
  // Colchón para el final
  if final {
    for m in ch { let f = hz(m)
      add(&mL, &mR, t0, beat * 4 + 0.6, pan: 0) { t in min(1, t / 0.3) * (saw(f, t) * 0.5 + sin(2 * .pi * f * t)) * 0.02 } }
  }
  // Batería: bombo en negras, palmas en 2 y 4, hi-hat abierto en contratiempo
  for k in 0..<4 {
    let tb = t0 + Double(k) * beat
    if final && k > 1 { continue }
    add(&dL, &dR, tb, 0.4, pan: 0) { t in sin(2 * .pi * (50 + 110 * exp(-t * 30)) * t) * exp(-t * 7) * 0.55 }
    if intro { continue }
    if k % 2 == 1 {
      var lp = 0.0
      add(&dL, &dR, tb, 0.25, pan: 0.05) { t in
        lp += 0.55 * (rnd() - lp)
        let burst = t < 0.03 ? (1 + 0.6 * sin(t * 900)) : 1
        return lp * exp(-t * 16) * 0.6 * burst
      }
    }
    var prev = 0.0
    add(&dL, &dR, tb + beat / 2, 0.14, pan: 0.3) { t in let x = rnd(); let h = x - prev; prev = x; return h * exp(-t * 26) * 0.16 }
  }
  // Redoble para pasar de un banner al otro (cada 2 compases)
  if b % 2 == 1 && !final {
    for k in 0..<4 {
      var lp = 0.0
      add(&dL, &dR, t0 + 3 * beat + Double(k) * beat / 4, 0.12, pan: -0.1) { t in lp += 0.5 * (rnd() - lp); return lp * exp(-t * 30) * (0.2 + 0.08 * Double(k)) }
    }
  }
}

// "Sidechain": la música baja un instante en cada bombo y vuelve
for i in 0..<n {
  let t = Double(i) / sr
  let ph = t.truncatingRemainder(dividingBy: beat) / beat
  let duck = 0.45 + 0.55 * min(1, ph / 0.45)
  mL[i] *= duck; mR[i] *= duck
}
// Mezcla, filtro que se abre en el primer compás, fundido final y normalizado
var aL = 0.0, aR = 0.0
var L = [Double](repeating: 0, count: n), R = L
for i in 0..<n {
  let t = Double(i) / sr
  let k = t < 4 * beat ? 0.04 + 0.9 * pow(t / (4 * beat), 2) : 0.94
  aL += k * (mL[i] - aL); aR += k * (mR[i] - aR)
  L[i] = aL + dL[i]; R[i] = aR + dR[i]
}
var peak = 0.0
for i in 0..<n {
  let t = Double(i) / sr
  let g = min(1, t / 0.05) * min(1, (dur - t) / 1.6)
  L[i] = tanh(L[i] * g * 1.3); R[i] = tanh(R[i] * g * 1.3)
  peak = max(peak, abs(L[i]), abs(R[i]))
}
let norm = 0.9 / peak
var data = Data()
func u32(_ v: UInt32) { var x = v.littleEndian; data.append(Data(bytes: &x, count: 4)) }
func u16(_ v: UInt16) { var x = v.littleEndian; data.append(Data(bytes: &x, count: 2)) }
data.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + n * 4)); data.append("WAVEfmt ".data(using: .ascii)!)
u32(16); u16(1); u16(2); u32(UInt32(sr)); u32(UInt32(sr) * 4); u16(4); u16(16)
data.append("data".data(using: .ascii)!); u32(UInt32(n * 4))
var pcm = [Int16](repeating: 0, count: n * 2)
for i in 0..<n { pcm[2 * i] = Int16(L[i] * norm * 32767); pcm[2 * i + 1] = Int16(R[i] * norm * 32767) }
pcm.withUnsafeBytes { data.append(contentsOf: $0) }
try! data.write(to: URL(fileURLWithPath: out))
print("ok", out, String(format: "%.2f s, tiempo %.3f s", dur, beat))
