import { Directory, File, FileMode, Paths } from 'expo-file-system';

// PDFs are stored in the app's document directory as pdfs/<doc-id>.pdf.

function pdfDir(): Directory {
  const dir = new Directory(Paths.document, 'pdfs');
  dir.create({ idempotent: true });
  return dir;
}

function pdfFile(docId: string): File {
  return new File(pdfDir(), `${docId}.pdf`);
}

async function isPdf(file: File): Promise<boolean> {
  const handle = file.open(FileMode.ReadOnly);
  try {
    const head = await handle.readBytes(5);
    return String.fromCharCode(...head) === '%PDF-';
  } finally {
    handle.close();
  }
}

/** Copy a picked file into app storage. Returns the stored file's URI. */
export async function attachPdf(docId: string, sourceUri: string): Promise<string> {
  const source = new File(sourceUri);
  if (!(await isPdf(source))) throw new Error('That file is not a PDF.');
  const dest = pdfFile(docId);
  await source.copy(dest, { overwrite: true });
  return dest.uri;
}

/** Download a document's PDF from its URL into app storage. Returns the stored file's URI. */
export async function downloadPdf(docId: string, url: string): Promise<string> {
  const dest = pdfFile(docId);
  const file = await File.downloadFileAsync(url, dest, { idempotent: true });
  if (!(await isPdf(file))) {
    file.delete();
    throw new Error(`The link didn't return a PDF: ${url}`);
  }
  return file.uri;
}
