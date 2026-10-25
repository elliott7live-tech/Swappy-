import { generateSafeId } from '../firebase';

/**
 * Center-crops and resizes any user-selected photo to a crisp 256x256 JPEG Blob,
 * then uploads it to POST /api/avatars/upload and returns the server /uploads/... path.
 */
export async function processAndUploadAvatar(file: File): Promise<string> {
  const croppedBlob = await cropSquareAvatarBlob(file, 256);
  const avatarId = generateSafeId('av');

  const response = await fetch('/api/avatars/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Avatar-Id': avatarId,
    },
    body: croppedBlob,
  });

  if (!response.ok) {
    throw new Error('Nie udało się przesłać zdjęcia profilowego.');
  }

  const data = (await response.json()) as { avatarUrl?: string };
  if (!data.avatarUrl) {
    throw new Error('Nieprawidłowa odpowiedź serwera przy zapisie zdjęcia.');
  }
  return data.avatarUrl;
}

function cropSquareAvatarBlob(file: File, targetSize: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width = targetSize;
      canvas.height = targetSize;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Brak obsługi canvas w przeglądarce.'));
        return;
      }

      const side = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
      const sx = Math.max(0, ((img.naturalWidth || img.width) - side) / 2);
      const sy = Math.max(0, ((img.naturalHeight || img.height) - side) / 2);

      ctx.fillStyle = '#0A0A0C';
      ctx.fillRect(0, 0, targetSize, targetSize);
      ctx.drawImage(img, sx, sy, side, side, 0, 0, targetSize, targetSize);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            resolve(blob);
          } else {
            reject(new Error('Nie udało się przetworzyć wybranego zdjęcia.'));
          }
        },
        'image/jpeg',
        0.88
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Wybrany plik nie jest obsługiwanym obrazem.'));
    };

    img.src = objectUrl;
  });
}
