/** 手机拍照压缩：canvas 压到最长边 1600 / 质量 0.82，省流量（03 卷：拍完先存再传）。
 *
 * 不引入后端图像依赖（不新增 Pillow）：压缩在手机浏览器里完成。
 */

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = url
  })
}

export async function compressImage(file: File, maxEdge = 1600, quality = 0.82): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  const url = URL.createObjectURL(file)
  try {
    const img = await loadImage(url)
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height))
    if (scale >= 1 && file.size < 1_200_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.width * scale))
    canvas.height = Math.max(1, Math.round(img.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob) return file
    const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
  } catch {
    return file
  } finally {
    URL.revokeObjectURL(url)
  }
}
