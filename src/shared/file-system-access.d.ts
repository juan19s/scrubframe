/**
 * The parts of the File System Access API that lib.dom.d.ts does not ship.
 *
 * TypeScript 5.9 has FileSystemDirectoryHandle, FileSystemFileHandle and
 * FileSystemWritableFileStream, but not showDirectoryPicker and not the
 * permission methods. Declared by hand rather than pulling in
 * @types/wicg-file-system-access, which redeclares what lib.dom already has
 * and collides on duplicate identifiers.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface DirectoryPickerOptions {
  id?: string;
  mode?: 'read' | 'readwrite';
  startIn?: FileSystemHandle | 'desktop' | 'documents' | 'downloads' | 'pictures' | 'videos';
}

interface Window {
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<FileSystemDirectoryHandle>;
}
