// Música lo-fi original, sintetizada. Uso: swift musica.swift salida.wav segundos
import Foundation

let args = CommandLine.arguments
let out = args.count > 1 ? args[1] : "musica.wav"
let dur = args.count > 2 ? Double(args[2])! : 31.0
let sr = 44100.0
let n = Int(dur * sr)
var L = [Double](repeating: 0, count: n)
var R = [Double](repeating: 0, count: n)

let bpm = 78.0
let beat = 60.0 / bpm
func hz(_ midi: Double) -> Double { 440 * pow(2, (midi - 69) / 12) }

// Fmaj7 – Em7 – Dm7 – Cmaj7 (voicings suaves)
let chords: [[Double]] = [
  [53, 57, 60, 64, 69],   // F A C E A
  [52, 55, 59, 62, 67],   // E G B D G
  [50, 53, 57, 60, 65],   // D F A C F
  [48, 52, 55, 59, 64],   // C E G B E
]
let roots: [Double] = [41, 40, 38, 36]

var seed: UInt64 = 7
func rnd() -> Double { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Double(seed >> 33) / Double(1 << 31) - 0.5 }

func add(_ t0: Double, _ len: Double, pan: Double, _ f: (Double) -> Double) {
  let s = Int(t0 * sr), e = min(n, Int((t0 + len) * sr))
  if s >= n || s < 0 { return }
  let gl = cos((pan + 1) * .pi / 4), gr = sin((pan + 1) * .pi / 4)
  for i in s..<e { let v = f(Double(i - s) / sr); L[i] += v * gl; R[i] += v * gr }
}

// Piano eléctrico: seno + armónicos suaves, trémolo, decaimiento
func keys(_ t0: Double, _ notes: [Double], vel: Double) {
  for (k, m) in notes.enumerated() {
    let f = hz(m), d = Double(k) * 0.018 // rasgueo leve
    add(t0 + d, beat * 3.6, pan: Double(k) / 2 - 1.0) { t in
      let env = min(1, t / 0.012) * exp(-t * 1.1)
      let trem = 1 + 0.12 * sin(2 * .pi * 4.5 * t)
      let s = sin(2 * .pi * f * t) + 0.25 * sin(2 * .pi * 2 * f * t) * exp(-t * 3) + 0.08 * sin(2 * .pi * 3 * f * t) * exp(-t * 6)
      return s * env * trem * vel * 0.055
    }
  }
}
// Colchón suave
func pad(_ t0: Double, _ notes: [Double], len: Double) {
  for m in notes.dropFirst() {
    for det in [-0.07, 0.07] {
      let f = hz(m + 12) * pow(2, det / 12)
      add(t0, len, pan: det * 8) { t in
        let env = min(1, t / 1.2) * min(1, (len - t) / 1.0)
        return (sin(2 * .pi * f * t) + 0.3 * sin(2 * .pi * f * 2 * t)) * env * 0.006
      }
    }
  }
}
func bass(_ t0: Double, _ m: Double, len: Double) {
  let f = hz(m)
  add(t0, len, pan: 0) { t in
    let env = min(1, t / 0.02) * exp(-t * 1.6) * min(1, (len - t) / 0.05)
    return (sin(2 * .pi * f * t) + 0.2 * sin(2 * .pi * 2 * f * t)) * env * 0.16
  }
}
func kick(_ t0: Double) {
  add(t0, 0.35, pan: 0) { t in
    let f = 48 + 70 * exp(-t * 28)
    return sin(2 * .pi * f * t) * exp(-t * 9) * 0.32
  }
}
func snap(_ t0: Double) {
  var lp = 0.0
  add(t0, 0.25, pan: 0.1) { t in
    lp += 0.35 * (rnd() - lp)
    return lp * exp(-t * 22) * 0.35 + sin(2 * .pi * 190 * t) * exp(-t * 30) * 0.05
  }
}
func hat(_ t0: Double, _ v: Double) {
  var prev = 0.0
  add(t0, 0.06, pan: 0.35) { t in
    let x = rnd(); let hp = x - prev; prev = x
    return hp * exp(-t * 70) * v
  }
}

// Arreglo
let bar = beat * 4
var t = 0.0, c = 0
while t < dur {
  let ch = chords[c % 4], r = roots[c % 4]
  pad(t, ch, len: bar + 0.4)
  keys(t, ch, vel: 1.0)
  keys(t + beat * 2.5, Array(ch.suffix(3)), vel: 0.6)
  bass(t, r, len: beat * 1.5)
  bass(t + beat * 1.5, r, len: beat * 1.0)
  bass(t + beat * 2.5, r + 7, len: beat * 1.3)
  if t > bar * 0.99 { // la batería entra en el segundo compás
    kick(t); kick(t + beat * 2.5)
    snap(t + beat); snap(t + beat * 3)
    for k in 0..<8 { let sw = k % 2 == 1 ? beat * 0.08 : 0; hat(t + Double(k) * beat / 2 + sw, k % 2 == 0 ? 0.05 : 0.03) }
  }
  t += bar; c += 1
}

// Ruido de vinilo
for i in 0..<n {
  let hiss = rnd() * 0.004
  L[i] += hiss; R[i] += hiss
  if rnd() > 0.4997 { let p = rnd() * 0.12; L[i] += p; R[i] += p * 0.8 }
}

// Filtro pasabajos suave ("cinta"), fundido y normalizado
var a = 0.0, b = 0.0
let k = 0.32
for i in 0..<n { a += k * (L[i] - a); b += k * (R[i] - b); L[i] = a; R[i] = b }
let fin = 1.5, fout = 2.5
var peak = 0.0
for i in 0..<n {
  let ts = Double(i) / sr
  let g = min(1, ts / fin) * min(1, (dur - ts) / fout)
  L[i] = tanh(L[i] * g * 1.2); R[i] = tanh(R[i] * g * 1.2)
  peak = max(peak, abs(L[i]), abs(R[i]))
}
let norm = 0.85 / peak

// WAV 16 bits estéreo
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
print("ok", out, dur, "s")
