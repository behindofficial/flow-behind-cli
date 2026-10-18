#!/usr/bin/env python3
"""Flow Behind's LaMa runner, for a single image or a folder of video frames.

The model is cached locally; torch, numpy and Pillow are optional dependencies.
The public TorchScript model comes from enesmsahin/simple-lama-inpainting.
"""
import argparse
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.request import urlopen
import shutil

MODEL_URL = "https://github.com/enesmsahin/simple-lama-inpainting/releases/download/v0.1.0/big-lama.pt"


def parse_box(value):
    match = re.fullmatch(r"(\d+)x(\d+)\+(\d+)\+(\d+)", value)
    if not match:
        raise argparse.ArgumentTypeError("box must be WxH+X+Y")
    width, height, x, y = map(int, match.groups())
    if not width or not height:
        raise argparse.ArgumentTypeError("box dimensions must be positive")
    return width, height, x, y


def model_path():
    custom = os.environ.get("FLOW_BEHIND_LAMA_MODEL")
    path = Path(custom).expanduser() if custom else Path.home() / ".cache/lama/big-lama.pt"
    if path.is_file():
        return path
    if custom:
        raise FileNotFoundError(f"model not found: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    print("Downloading the LaMa model (~200 MB), once only...", file=sys.stderr)
    fd, temporary = tempfile.mkstemp(dir=path.parent, suffix=".download")
    try:
        with os.fdopen(fd, "wb") as output, urlopen(MODEL_URL, timeout=120) as source:
            shutil.copyfileobj(source, output)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return path


def process_image(source, destination, box, model, torch, np, Image):
    with Image.open(source) as image:
        image = image.convert("RGB")
        original = np.array(image)
    height, width = original.shape[:2]
    bw, bh, x, y = box
    if x + bw > width or y + bh > height:
        raise ValueError(f"box exceeds {width}x{height} image: {source}")
    pixels = original.astype(np.float32) / 255.0
    mask = np.zeros((height, width), dtype=np.float32)
    mask[y:y + bh, x:x + bw] = 1
    padding = ((0, (-height) % 8), (0, (-width) % 8))
    pixels = np.pad(pixels, (*padding, (0, 0)), mode="symmetric")
    mask = np.pad(mask, padding, mode="symmetric")
    batch = torch.from_numpy(pixels.transpose(2, 0, 1)).unsqueeze(0)
    mask_batch = torch.from_numpy(mask).unsqueeze(0).unsqueeze(0)
    with torch.inference_mode():
        prediction = model(batch, mask_batch)[0].permute(1, 2, 0).cpu().numpy()
    patch = np.clip(prediction[:height, :width] * 255, 0, 255).round().astype(np.uint8)
    # Preserve pixels outside the requested region before image encoding.
    original[y:y + bh, x:x + bw] = patch[y:y + bh, x:x + bw]
    destination.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(original).save(destination)


def main():
    parser = argparse.ArgumentParser(description="Flow Behind LaMa inpainting")
    parser.add_argument("input", type=Path)
    parser.add_argument("-o", "--output", required=True, type=Path)
    parser.add_argument("--box", required=True, type=parse_box)
    args = parser.parse_args()
    import numpy as np
    import torch
    from PIL import Image
    source = args.input.resolve()
    output = args.output.resolve()
    if not source.exists():
        raise FileNotFoundError(source)
    if source == output:
        raise ValueError("input and output must be different paths")
    files = sorted(source.glob("*.png")) if source.is_dir() else [source]
    if not files:
        raise ValueError("no PNG frames found")
    model = torch.jit.load(str(model_path()), map_location="cpu").eval()
    for index, path in enumerate(files, 1):
        target = output / path.name if source.is_dir() else output
        process_image(path, target, args.box, model, torch, np, Image)
        print(f"{index}/{len(files)} frames", file=sys.stderr, flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
