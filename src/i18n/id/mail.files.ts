// Bahasa Indonesia: mail, attachments (part of the mail area). Owner: the Mail attachments builder.
// The files in an email, the viewer, files being sent (Compose, replies), Insert from Drive, the folder picker, the
// Files view, and what the server says about files (server/mailFiles.ts, server/officePreview.ts).
// The key is the exact English text in the code. Rules: docs/i18n.md. Check with: node scripts/i18n-check.mjs
const id: Record<string, string> = {
  // The files in an email
  'Download all': 'Unduh semua',
  'Download {name}': 'Unduh {name}',
  'Not scanned for viruses': 'Belum dipindai virus',
  'No virus scanner checked these files. Open them only if you trust who sent them.': 'Belum ada pemindai virus yang memeriksa file ini. Buka hanya jika Anda percaya pengirimnya.',
  '{name}: blocked': '{name}: diblokir',
  'Saved {n} files to {folder}': '{n} file disimpan ke {folder}',
  'Couldn’t save to Drive.': 'Tidak bisa menyimpan ke Drive.',

  // The viewer
  'Loading the preview': 'Memuat pratinjau',
  'Page {n}': 'Halaman {n}',
  'There’s no preview for this kind of file. Download it to open it.': 'Jenis file ini tidak punya pratinjau. Unduh untuk membukanya.',
  'This picture can’t be shown here. Download it to open it.': 'Gambar ini tidak bisa ditampilkan di sini. Unduh untuk membukanya.',
  'This PDF couldn’t be shown here. Download it to open it.': 'PDF ini tidak bisa ditampilkan di sini. Unduh untuk membukanya.',
  'This kind of file can hold code that runs when it’s opened. Open it only if you trust {name}.': 'Jenis file ini bisa berisi kode yang berjalan saat dibuka. Buka hanya jika Anda percaya {name}.',
  'This kind of file can hold code that runs when it’s opened. Open it only if you trust who sent it.': 'Jenis file ini bisa berisi kode yang berjalan saat dibuka. Buka hanya jika Anda percaya pengirimnya.',
  '{n} of {total}': '{n} dari {total}',
  'Open email': 'Buka email',

  // The folder picker
  'Save {n} files to': 'Simpan {n} file ke',
  'Find a folder': 'Cari folder',
  'No folder by that name.': 'Tidak ada folder dengan nama itu.',

  // Files being sent
  'Attach file': 'Lampirkan file',
  'Insert from Drive': 'Sisipkan dari Drive',
  'Wait for the files to finish uploading': 'Tunggu sampai file selesai diunggah',
  'Didn’t upload': 'Gagal diunggah',
  'Drive link': 'Link Drive',
  'Try {name} again': 'Coba {name} lagi',
  'Who can open the links': 'Siapa yang bisa membuka link',
  'Only the recipients': 'Hanya penerima',
  'Anyone with the link': 'Siapa saja yang punya link',
  'Emails carry up to 25 MB, so {n} files go as Drive links instead of attachments.': 'Email hanya bisa membawa hingga 25 MB, jadi {n} file dikirim sebagai link Drive, bukan lampiran.',
  'Emails carry up to 25 MB. The demo company can’t share Drive links, so this email may be too big to send.': 'Email hanya bisa membawa hingga 25 MB. Perusahaan demo tidak bisa membagikan link Drive, jadi email ini mungkin terlalu besar untuk dikirim.',
  'Only the people on this conversation can open them.': 'Hanya orang di percakapan ini yang bisa membukanya.',
  'Only the people this email went to can open these.': 'Hanya penerima email ini yang bisa membuka file ini.',
  'Anyone with the link can open these.': 'Siapa saja yang punya link bisa membuka file ini.',
  'The links couldn’t be made.': 'Link tidak bisa dibuat.',
  '{name} can’t be attached: this kind of file can run programs, so email doesn’t carry it (as in Gmail).': '{name} tidak bisa dilampirkan: jenis file ini bisa menjalankan program, jadi email tidak membawanya (seperti Gmail).',
  '{n} files can’t be attached: these kinds of files can run programs, so email doesn’t carry them (as in Gmail).': '{n} file tidak bisa dilampirkan: jenis file ini bisa menjalankan program, jadi email tidak membawanya (seperti Gmail).',
  'Not sent. {why}': 'Tidak terkirim. {why}',

  // Insert from Drive
  'Search Drive': 'Cari di Drive',
  'Pick the files to add': 'Pilih file yang akan ditambahkan',
  '{n} files picked': '{n} file dipilih',
  'Add as links': 'Tambahkan sebagai link',
  'No files by that name': 'Tidak ada file dengan nama itu',
  'This file can’t be added to an email': 'File ini tidak bisa ditambahkan ke email',

  // The Files view
  'Files: every attachment in your mail': 'File: semua lampiran di email Anda',
  'Every file in your mail, newest first': 'Semua file di email Anda, yang terbaru di atas',
  'Search by file name': 'Cari nama file',
  Filters: 'Filter',
  Images: 'Gambar',
  PDFs: 'PDF',
  Documents: 'Dokumen',
  Spreadsheets: 'Spreadsheet',
  Presentations: 'Presentasi',
  'Video and audio': 'Video dan audio',
  'Any time': 'Kapan saja',
  'Past week': 'Seminggu terakhir',
  'Past month': 'Sebulan terakhir',
  'Past year': 'Setahun terakhir',
  'No files match': 'Tidak ada file yang cocok',
  'Try another name or fewer filters.': 'Coba nama lain atau kurangi filter.',
  'Files people send you, and files you send, show up here.': 'File yang dikirim ke Anda, dan file yang Anda kirim, muncul di sini.',
  'Show {n} more files': 'Tampilkan {n} file lagi',
  '{who}, {when}': '{who}, {when}',

  // What the server says about files
  'Blocked: this kind of file can run programs, so it wasn’t kept.': 'Diblokir: jenis file ini bisa menjalankan program, jadi tidak disimpan.',
  'Blocked: the zip holds a file that can run programs, so it wasn’t kept.': 'Diblokir: zip ini berisi file yang bisa menjalankan program, jadi tidak disimpan.',
  'Blocked: it’s a program with another name, so it wasn’t kept.': 'Diblokir: ini program dengan nama lain, jadi tidak disimpan.',
  'Blocked: a virus was found in it, so it wasn’t kept.': 'Diblokir: ada virus di dalamnya, jadi tidak disimpan.',
  'This kind of file can’t be sent, because it can run programs (as in Gmail). Put it in Drive and send a link, or ask the person to get it another way.': 'Jenis file ini tidak bisa dikirim karena bisa menjalankan program (seperti Gmail). Taruh di Drive dan kirim link-nya, atau minta penerima mengambilnya dengan cara lain.',
  'One of the zips holds a file that can run programs, so it can’t be sent (as in Gmail).': 'Salah satu zip berisi file yang bisa menjalankan program, jadi tidak bisa dikirim (seperti Gmail).',
  'One of the files is a program with another name, so it can’t be sent.': 'Salah satu file adalah program dengan nama lain, jadi tidak bisa dikirim.',
  'This email is over 25 MB with its files. Send the big files as Drive links instead.': 'Email ini lebih dari 25 MB dengan file-filenya. Kirim file besar sebagai link Drive.',
  'This file is too big to preview. Download it to open it.': 'File ini terlalu besar untuk dipratinjau. Unduh untuk membukanya.',
  'This file couldn’t be read, so there’s no preview. Download it to open it.': 'File ini tidak bisa dibaca, jadi tidak ada pratinjau. Unduh untuk membukanya.',
  'This file is protected with a password, so there’s no preview.': 'File ini dilindungi kata sandi, jadi tidak ada pratinjau.',
  'No such email.': 'Email tidak ditemukan.',
  'There are no files to download in this email.': 'Tidak ada file untuk diunduh di email ini.',
  'There are no files to save in this email.': 'Tidak ada file untuk disimpan di email ini.',
  'That folder isn’t in Drive any more.': 'Folder itu sudah tidak ada di Drive.',
  'There’s no room left for these files.': 'Tidak ada ruang lagi untuk file ini.',
  'They don’t fit: the company’s storage is full. An admin can add more in Settings, Plan & billing.': 'Tidak muat: penyimpanan perusahaan penuh. Admin bisa menambahnya di Pengaturan, Paket & tagihan.',
  'Add who the email is for first.': 'Tambahkan dulu penerima email.',
  'One of the files isn’t a file of this company.': 'Salah satu file bukan file perusahaan ini.',
};

export default id;
