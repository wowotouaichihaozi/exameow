// Android projects are generated locally and excluded from Git. Restore the
// permission used by navigator.vibrate before a native build packages them.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const manifestPath = fileURLToPath(new URL('../src-tauri/gen/android/app/src/main/AndroidManifest.xml', import.meta.url))

if (!existsSync(manifestPath)) {
  console.log('patch-android-feedback: no generated Android project, skipping')
} else {
  const manifest = readFileSync(manifestPath, 'utf8')
  if (/<uses-permission\b[^>]*\bandroid:name\s*=\s*["']android\.permission\.VIBRATE["']/.test(manifest)) {
    console.log('patch-android-feedback: vibration permission already present')
  } else {
    if (!/<manifest\b[^>]*>/.test(manifest)) throw new Error('Android manifest root not found')
    const patched = manifest.replace(/<manifest\b[^>]*>/, '$&\n    <uses-permission android:name="android.permission.VIBRATE" />')
    writeFileSync(manifestPath, patched)
    console.log('patch-android-feedback: vibration permission added')
  }
}
