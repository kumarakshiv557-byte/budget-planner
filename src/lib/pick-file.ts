import * as DocumentPicker from 'expo-document-picker';
import { Platform } from 'react-native';

/** Let the user pick a CSV file and return its text, or null if they cancelled. */
export async function pickCsvText(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/vnd.ms-excel', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
  });
  if (res.canceled || !res.assets?.length) return null;
  const asset = res.assets[0];
  if (Platform.OS === 'web' && asset.file) return asset.file.text();
  const r = await fetch(asset.uri);
  return r.text();
}
