// The app's look: the iOS one, or hand-drawn on paper. Kept on this device; the paper look loads
// its handwritten font from Google Fonts the first time it is chosen.

export type Skin = 'ios' | 'paper'
export const SKINS: [Skin, string][] = [
  ['ios', 'iOS'],
  ['paper', '手绘纸张'],
]
const KEY = 'pindou.skin'
const FONT = 'https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap'

export function loadSkin(): Skin {
  try {
    return localStorage.getItem(KEY) === 'paper' ? 'paper' : 'ios'
  } catch {
    return 'ios'
  }
}

export function applySkin(skin: Skin) {
  document.documentElement.dataset.skin = skin
  if (skin === 'paper' && !document.getElementById('paper-font')) {
    const link = document.createElement('link')
    link.id = 'paper-font'
    link.rel = 'stylesheet'
    link.href = FONT
    document.head.appendChild(link)
  }
  // the bar colour the phone draws around the app
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', skin === 'paper' ? '#f6efe1' : '#f3f4f2')
}

export function saveSkin(skin: Skin) {
  try {
    localStorage.setItem(KEY, skin)
  } catch {
    // private browsing: this session only
  }
  applySkin(skin)
}
