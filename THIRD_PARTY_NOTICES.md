# Third-party notices

Assets Size is licensed under MIT. Bundled dependencies retain their own licenses.

| Component | Purpose | License / bundled notice |
| --- | --- | --- |
| [picomatch](https://github.com/micromatch/picomatch) | File and folder include / exclude matching | MIT; `dist/licenses/LICENSE-picomatch` |
| [jSquash JPEG](https://github.com/jamsinclair/jSquash/tree/main/packages/jpeg) | JPEG decoding and MozJPEG encoding | Apache-2.0 wrapper; `dist/codecs/LICENSE-jpeg` and `LICENSE-jpeg-codec.md` |
| [jSquash WebP](https://github.com/jamsinclair/jSquash/tree/main/packages/webp) | WebP decoding and encoding | Apache-2.0 wrapper; `dist/codecs/LICENSE-webp` and `LICENSE-webp-codec.md` |
| [jSquash Oxipng](https://github.com/jamsinclair/jSquash/tree/main/packages/oxipng) | Lossless PNG optimization | Apache-2.0 wrapper and MIT codec; `dist/codecs/LICENSE-oxipng` and `LICENSE-oxipng-codec.md` |

The complete upstream notices are copied without modification during the build and included in the VSIX alongside the JavaScript and WebAssembly codecs. The JPEG codec notice includes the libjpeg-turbo / IJG acknowledgements and license terms. Development tools are not shipped in the VSIX.
