// Bahasa Indonesia: drive. Owner: Builder 3 (chat, meet, drive).
// Drive: DriveView, DriveSidebar, DrivePreview, big files, file kinds.
// The key is the exact English text in the code; the value is how it reads in Indonesian. Tone, the glossary and
// the rules for placeholders and plurals: docs/i18n.md. Check with: node scripts/i18n-check.mjs
const id: Record<string, string> = {
  // Sections and the sidebar (DriveSidebar)
  'My Drive': 'Drive saya',
  Recent: 'Terbaru',
  'Photos & videos': 'Foto & video',
  'From email': 'Dari email',
  Starred: 'Berbintang',
  Trash: 'Sampah',
  'Upload files': 'Unggah file',
  'New folder': 'Folder baru',
  Storage: 'Penyimpanan',
  'Running low. Free up space or add storage in Settings.': 'Hampir penuh. Kosongkan ruang atau tambah penyimpanan di Pengaturan.',

  // The list (DriveView)
  'Open menu': 'Buka menu',
  'Search results': 'Hasil pencarian',
  'Search in Drive': 'Cari di Drive',
  'Clear search': 'Kosongkan pencarian',
  Grid: 'Petak',
  List: 'Daftar',
  Name: 'Nama',
  Modified: 'Diubah',
  Size: 'Ukuran',
  'Last modified': 'Terakhir diubah',
  Folders: 'Folder',
  Files: 'File',
  '{n} items': '{n} item',
  'Attachments from your emails appear here automatically.': 'Lampiran dari email Anda otomatis muncul di sini.',
  'Items in trash are deleted forever after 30 days.': 'Isi sampah dihapus permanen setelah 30 hari.',
  'No files found': 'File tidak ditemukan',
  'Trash is empty': 'Sampah kosong',
  'Nothing here yet': 'Belum ada apa-apa di sini',
  'No starred files': 'Belum ada file berbintang',
  'Files you upload and folders you make live here. Files from chat and email stay in Home and Shared.': 'File yang Anda unggah dan folder yang Anda buat ada di sini. File dari chat dan email tetap di Beranda dan Dibagikan.',
  'Star a file from its menu and it waits for you here.': 'Beri bintang pada file dari menunya dan file itu menunggu Anda di sini.',
  'Deleted files stay here for 30 days.': 'File yang dihapus tersimpan di sini selama 30 hari.',
  'Files people send you in chat, by email or from a guest show here.': 'File yang dikirim orang lewat chat, email, atau dari tamu muncul di sini.',
  'Files you open, upload or get show here, newest first.': 'File yang Anda buka, unggah, atau terima muncul di sini, yang terbaru di atas.',
  'Nothing matches “{q}”.': 'Tidak ada yang cocok dengan “{q}”.',
  'Drag files here or press Upload.': 'Seret file ke sini atau tekan Unggah.',
  'Drop to upload': 'Lepas untuk mengunggah',
  'to {folder}': 'ke {folder}',
  'to My Drive': 'ke Drive saya',
  'More for {name}': 'Tindakan lain untuk {name}',

  // A file's actions (buttons, long-press, right-click and "…")
  Restore: 'Pulihkan',
  'Delete forever': 'Hapus permanen',
  'Open email': 'Buka email',
  'Open the email': 'Buka email',
  Star: 'Beri bintang',
  Unstar: 'Hapus bintang',
  'Move to trash': 'Pindahkan ke sampah',

  // The preview (DrivePreview)
  'Open related email': 'Buka email terkait',
  'Close (Esc)': 'Tutup (Esc)',
  'Previous file': 'File sebelumnya',
  'Next file': 'File berikutnya',
  'Sample video. Upload your own to play it here': 'Video contoh. Unggah video Anda sendiri untuk memutarnya di sini',
  'Previews for documents arrive with the real file server.': 'Pratinjau dokumen akan tersedia setelah server file aktif.',

  // Asking before a big upload (BigFileDialog); the storage sentences are the same as the imports' (settings.imports.ts)
  'Save a big file': 'Simpan file besar',
  'Save a big file?': 'Simpan file besar?',
  '{file} is {size}.': '{file} berukuran {size}.',
  'The company has {left} free of {total}, shared by everyone.': 'Ruang kosong perusahaan {left} dari {total}, dipakai bersama oleh semua orang.',
  'This leaves {rest}.': 'Sisanya {rest}.',
  'This file doesn’t fit.': 'File ini tidak muat.',
  'Don’t upload': 'Jangan unggah',
  'Save it here': 'Simpan di sini',

  // Drive's lines in App.tsx (toasts, a new folder's name, the upload count). Toasts already show t(text).
  'Moved to trash': 'Dipindahkan ke sampah',
  'Deleted forever': 'Dihapus permanen',
  'Saved to My Drive': 'Tersimpan di Drive saya',
  'Untitled folder': 'Folder tanpa judul',
  'Uploaded {n} files': '{n} file diunggah',
  'That file isn’t in Drive any more.': 'File itu sudah tidak ada di Drive.',

  // Phones: Google Drive's app (the New sheet, the sort row, the file menu, Details, Move)
  'Make a folder': 'Buat folder',
  'Folder made': 'Folder dibuat',
  'Moved to {folder}': 'Dipindah ke {folder}',
  'Move “{name}”': 'Pindahkan “{name}”',
  'New in {folder}': 'Baru di {folder}',
  'Remove star': 'Hapus bintang',
  'Share link': 'Bagikan link',
  'Show as a grid': 'Tampilkan sebagai kisi',
  'Show as a list': 'Tampilkan sebagai daftar',
  'This folder is empty': 'Folder ini kosong',
  'Files you upload and folders you make show here.': 'File yang Anda unggah dan folder yang Anda buat muncul di sini.',
  'Deleted forever after 30 days': 'Dihapus permanen setelah 30 hari',
  'You uploaded': 'Anda unggah',
  '{name} uploaded': 'Diunggah {name}',
  'Uploaded by': 'Diunggah oleh',
  'Saved from an email by': 'Disimpan dari email oleh',
  Document: 'Dokumen',
  Image: 'Gambar',
  PDF: 'PDF',
  Slides: 'Slide',
  Spreadsheet: 'Spreadsheet',
};

export default id;
