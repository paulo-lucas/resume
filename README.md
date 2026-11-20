# Resume

Paulo Cerqueira's resume, in English and Portuguese.

- English: [`en/paulocerqueira.pdf`](en/paulocerqueira.pdf)
- Portuguese: [`pt/paulocerqueira.pdf`](pt/paulocerqueira.pdf)

## Source

The PDFs are generated from HTML + CSS in `src/` (`cv.en.html`, `cv.pt.html`, shared `cv.css`, Geist font under the SIL OFL in `src/fonts/`).

## Build

Requires Node 22+ and Microsoft Edge or Google Chrome. No npm dependencies.

```sh
node scripts/build.mjs            # writes en/ and pt/paulocerqueira.pdf
node scripts/build.mjs --preview  # also writes preview/cv.<lang>.png (page 1, rendered with pdf.js from cdnjs)
```

Set `BROWSER=/path/to/browser` if Edge/Chrome is not auto-detected.
