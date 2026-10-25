const DB_NAME = 'swappy_local_videos_db';
const STORE_NAME = 'video_blobs';
const DB_VERSION = 1;

function openVideoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveLocalVideoBlob(videoId: string, blob: Blob): Promise<string> {
  try {
    const db = await openVideoDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(blob, videoId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('IndexedDB video persistence unavailable:', err);
  }
  return URL.createObjectURL(blob);
}

export async function loadLocalVideoUrl(videoId: string): Promise<string | null> {
  try {
    const db = await openVideoDb();
    const blob = await new Promise<Blob | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const getReq = tx.objectStore(STORE_NAME).get(videoId);
      getReq.onsuccess = () => resolve(getReq.result as Blob | undefined);
      getReq.onerror = () => reject(getReq.error);
    });
    if (blob instanceof Blob) {
      return URL.createObjectURL(blob);
    }
  } catch {
    return null;
  }
  return null;
}
