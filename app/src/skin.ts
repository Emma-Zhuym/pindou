// The app's look and its type, both kept on this device.
//   look: iOS (glass over a quiet background) or paper (milky glass on off-white paper)
//   font: follows the look by default; or the system face, a typewriter pairing (Courier Prime with
//     LXGW WenKai Mono, from jsDelivr, split so only the characters on screen download), or the
//     pixel face bundled in src/fonts.

export type Skin = 'ios' | 'paper'
export type Font = 'auto' | 'system' | 'typewriter' | 'pixel'
export const SKINS: [Skin, string][] = [
  ['ios', 'iOS'],
  ['paper', '纸张'],
]
export const FONTS: [Font, string][] = [
  ['auto', '跟随外观'],
  ['system', '系统'],
  ['typewriter', '文楷打字机'],
  ['pixel', '像素'],
]
const SKIN_KEY = 'pindou.skin'
const FONT_KEY = 'pindou.font'
const TYPEWRITER = [
  'https://cdn.jsdelivr.net/npm/@fontsource/courier-prime@5.3.0/400.css',
  'https://cdn.jsdelivr.net/npm/@fontsource/courier-prime@5.3.0/700.css',
  'https://cdn.jsdelivr.net/npm/@chinese-fonts/lxgwwenkai@3.0.0/dist/LXGWWenKaiMono-Regular/result.css',
]

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    // private browsing: this session only
  }
}

export const loadSkin = (): Skin => (read(SKIN_KEY) === 'paper' ? 'paper' : 'ios')
export const loadFont = (): Font => {
  const f = read(FONT_KEY)
  return f === 'system' || f === 'typewriter' || f === 'pixel' ? f : 'auto'
}

/** The font actually used: "follow the look" picks the look's own. */
export const fontFor = (skin: Skin, font: Font): Exclude<Font, 'auto'> => (font !== 'auto' ? font : skin === 'paper' ? 'typewriter' : 'system')

export function applyLook(skin = loadSkin(), font = loadFont()) {
  const used = fontFor(skin, font)
  document.documentElement.dataset.skin = skin
  document.documentElement.dataset.font = used
  if (used === 'typewriter') {
    for (const href of TYPEWRITER) {
      if (document.querySelector(`link[href="${href}"]`)) continue
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = href
      document.head.appendChild(link)
    }
  }
  // the bar colour the phone draws around the app
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', skin === 'paper' ? '#f3f0ea' : '#f3f4f2')
}

export function saveSkin(skin: Skin) {
  write(SKIN_KEY, skin)
  applyLook(skin, loadFont())
}

export function saveFont(font: Font) {
  write(FONT_KEY, font)
  applyLook(loadSkin(), font)
}
