export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface UploadResult {
  url: string;
  filename: string;
  size: number;
  mimeType: string;
  isLocalBlob: boolean;
}

export interface UploadProvider {
  name: string;
  uploadVideo(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult>;
}

/**
 * Local Browser Object URL Provider
 * Instantly creates a local preview URL using URL.createObjectURL.
 * Simulates optional upload progress for Cloudinary / S3 readiness.
 */
export class LocalBrowserUploadProvider implements UploadProvider {
  name = 'Browser Local Preview';

  async uploadVideo(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    const objectUrl = URL.createObjectURL(file);
    const totalSize = file.size;

    // Simulate quick progress tick for UI feedback
    if (onProgress) {
      onProgress({ loaded: Math.floor(totalSize * 0.3), total: totalSize, percentage: 30 });
      await new Promise((r) => setTimeout(r, 200));
      onProgress({ loaded: Math.floor(totalSize * 0.7), total: totalSize, percentage: 70 });
      await new Promise((r) => setTimeout(r, 200));
      onProgress({ loaded: totalSize, total: totalSize, percentage: 100 });
    }

    return {
      url: objectUrl,
      filename: file.name,
      size: file.size,
      mimeType: file.type || 'video/mp4',
      isLocalBlob: true,
    };
  }
}

/**
 * Cloud Provider Abstract Interface (Cloudinary / S3 / Supabase)
 */
export class CloudStorageUploadProvider implements UploadProvider {
  name = 'Cloud Storage (S3 / Cloudinary)';

  constructor(private apiEndpoint?: string) {}

  async uploadVideo(
    file: File,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<UploadResult> {
    if (!this.apiEndpoint) {
      // Fall back gracefully to local object URL with notification
      const local = new LocalBrowserUploadProvider();
      return local.uploadVideo(file, onProgress);
    }

    const formData = new FormData();
    formData.append('file', file);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', this.apiEndpoint!);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress({
            loaded: e.loaded,
            total: e.total,
            percentage: Math.round((e.loaded / e.total) * 100),
          });
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            resolve({
              url: data.url || data.secure_url,
              filename: file.name,
              size: file.size,
              mimeType: file.type,
              isLocalBlob: false,
            });
          } catch (e) {
            reject(new Error('Invalid response from upload server'));
          }
        } else {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during file upload'));
      xhr.send(formData);
    });
  }
}

export const defaultUploadProvider = new LocalBrowserUploadProvider();
