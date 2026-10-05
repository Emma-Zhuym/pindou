// The app's look: the iOS one, or hand-drawn on paper (with the Fusion Pixel font, bundled in
// src/fonts). Kept on this device.

export type Skin = 'ios' | 'paper'
export const SKINS: [Skin, string][] = [
  ['ios', 'iOS'],
  ['paper', '手绘纸张'],
]
const KEY = 'pindou.skin'

export function loadSkin(): Skin {
  try {
    return localStorage.getItem(KEY) === 'paper' ? 'paper' : 'ios'
  } catch {
    return 'ios'
  }
}

export function applySkin(skin: Skin) {
  document.documentElement.dataset.skin = skin
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
