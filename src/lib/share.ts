import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Write markdown to a file in the cache and open the share sheet for it. */
export async function shareMarkdown(fileName: string, text: string, dialogTitle: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType: 'text/markdown', dialogTitle, UTI: 'net.daringfireball.markdown' });
}
