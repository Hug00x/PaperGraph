import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetLatexSnippet, ensureAssetPackages, getDefaultImageInsertionIndex, getImageUrl, isPdfAsset } from '../src/lib/latex-assets.ts';

const image = { id: 'image', originalName: 'Results_50%.png', storedName: 'figure.png', mimeType: 'image/png', size: 1024, uploadedAt: '' };
const pdf = { ...image, originalName: 'Appendix.pdf', storedName: 'appendix.PDF', mimeType: 'application/octet-stream' };

test('image and PDF insertion preserve their distinct LaTeX commands and escape captions', () => {
  const figure = createAssetLatexSnippet(image);
  assert.ok(figure.includes('\\includegraphics[width=0.85\\linewidth]{papergraph-images/figure.png}'));
  assert.ok(figure.includes('\\caption{Results\\_50\\%}'));
  assert.ok(isPdfAsset(pdf), 'PDF extension is case insensitive even without the PDF MIME type');
  const appendix = createAssetLatexSnippet(pdf);
  assert.ok(appendix.includes('\\includepdf['));
  assert.ok(appendix.includes('pages=-,'));
  assert.ok(appendix.includes('papergraph-images/appendix.PDF'));
  assert.ok(!appendix.includes('\\caption'));
});

test('required packages are inserted before the document once and respect existing options', () => {
  const source = '\\documentclass{article}\n\\begin{document}\nBody\n\\end{document}';
  for (const [asset, packageName] of [[image, 'graphicx'], [pdf, 'pdfpages']]) {
    const updated = ensureAssetPackages(source, asset);
    assert.ok(updated.indexOf(`\\usepackage{${packageName}}`) < updated.indexOf('\\begin{document}'));
    assert.equal(ensureAssetPackages(updated, asset), updated);
    const existing = `\\usepackage[draft]{${packageName}}\n${source}`;
    assert.equal(ensureAssetPackages(existing, asset), existing);
  }
  assert.equal(ensureAssetPackages('Body', image), '\\usepackage{graphicx}\nBody');
  assert.equal(getDefaultImageInsertionIndex(source), source.indexOf('\\end{document}'));
  assert.equal(getDefaultImageInsertionIndex('Body'), 4);
});

test('asset URLs retain and encode storage paths and fall back to local filenames', () => {
  const asset = { ...image, storedName: 'figure #1.png', storagePath: 'workspace/folder/figure #1.png' };
  const url = new URL(getImageUrl(asset), 'http://localhost');
  assert.equal(decodeURIComponent(url.pathname.split('/').at(-1)), asset.storedName);
  assert.equal(url.searchParams.get('path'), asset.storagePath);
  assert.equal(new URL(getImageUrl(image), 'http://localhost').searchParams.get('path'), image.storedName);
});
