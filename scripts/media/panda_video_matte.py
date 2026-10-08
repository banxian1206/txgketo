"""Rebuild prototype panda atlases from extracted video frames (Pillow + numpy)."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def remove_background(frame):
    rgb = np.asarray(frame.convert('RGB')).astype(np.int16)
    # Video compression darkens a few white backgrounds. Neutral color plus
    # boundary connectivity separates that background from warm white fur.
    candidate = (rgb.min(axis=2) >= 238) & (rgb.max(axis=2) - rgb.min(axis=2) <= 8)
    mask = np.pad(candidate.astype(np.uint8) * 255, 1, constant_values=255)
    connected = Image.fromarray(mask).copy()
    ImageDraw.floodfill(connected, (0, 0), 128, thresh=0)
    background = np.asarray(connected)[1:-1, 1:-1] == 128
    alpha = Image.fromarray(np.where(background, 0, 255).astype(np.uint8))
    alpha = alpha.filter(ImageFilter.GaussianBlur(.4))
    result = frame.convert('RGBA')
    result.putalpha(alpha)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('frames', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    paths = sorted(args.frames.glob('frame-*.png'))
    assert len(paths) == 141, f'Expected 141 source frames, got {len(paths)}'
    args.output.mkdir(parents=True, exist_ok=True)
    sheets = [Image.new('RGBA', (2048, 1656)) for _ in range(3)]
    for i, path in enumerate(paths):
        frame = remove_background(Image.open(path))
        assert frame.size == (256, 276)
        alpha = np.asarray(frame)[:, :, 3]
        assert max(alpha[0].max(), alpha[-1].max(), alpha[:, 0].max(), alpha[:, -1].max()) == 0, path
        local = i % 48
        sheets[i // 48].paste(frame, (local % 8 * 256, local // 8 * 276))
    for i, sheet in enumerate(sheets):
        sheet.save(args.output / f'atlas-{i}.webp', quality=90, method=6)
    (args.output / 'manifest.json').write_text(json.dumps(dict(fps=24, count=141, width=256, height=276, columns=8, perSheet=48, sheets=[f'atlas-{i}.webp' for i in range(3)]), indent=2) + '\n')
    print(f'Validated {len(paths)} frames: transparent boundaries; fixed size 256x276.')
    # Contrast proof includes the affected frames and ordinary frames.
    review = Image.new('RGB', (256 * 4, 276 * 2), '#8fa4bc')
    for j, i in enumerate([0, 2, 3, 4, 5, 40, 80, 140]):
        frame = remove_background(Image.open(paths[i]))
        review.paste(frame, (j % 4 * 256, j // 4 * 276), frame)
    review.save('/tmp/panda-video-review/matte-fixed-review.png')

if __name__ == '__main__':
    main()
