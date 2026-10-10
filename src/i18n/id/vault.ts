// Bahasa Indonesia: vault. Owner: Builder 5 (tables, vault, guest).
// Vault: VaultApp.
// The key is the exact English text in the code; the value is how it reads in Indonesian. Tone, the glossary and
// the rules for placeholders and plurals: docs/i18n.md. Check with: node scripts/i18n-check.mjs
// Words kept: Vault, login, 2FA, email, link, end-to-end. Passphrase is "frasa sandi", clipboard "papan klip",
// key "kunci", setup key "kunci penyiapan", re-share "bagikan ulang".
const id: Record<string, string> = {
  // Sidebar
  'Add a login': 'Tambah login',
  'All logins': 'Semua login',
  'Company logins': 'Login perusahaan',
  'Passwords stay encrypted on the server. Copying one is logged, and the clipboard clears after 30 seconds.':
    'Kata sandi tetap terenkripsi di server. Setiap salinan tercatat, dan papan klip dikosongkan setelah 30 detik.',

  // When the Vault can't open
  'The Vault isn’t part of the demo company': 'Vault tidak ada di perusahaan demo',
  'It keeps real passwords and two-step codes, so it opens in your real company only.':
    'Vault menyimpan kata sandi dan kode dua langkah sungguhan, jadi hanya bisa dibuka di perusahaan Anda yang asli.',
  'The Vault needs the {product} server': 'Vault memerlukan server {product}',
  'Passwords are never kept in the browser. Run the local server (npm run server) and sign in to use it.':
    'Kata sandi tidak pernah disimpan di browser. Jalankan server lokal (npm run server), lalu masuk untuk memakainya.',

  // The list
  Logins: 'Login',
  'Shared logins and 2FA codes, only for the people you choose': 'Login bersama dan kode 2FA, hanya untuk orang yang Anda pilih',
  'Re-share all': 'Bagikan ulang semua',
  'Give everyone who may open a login the key to it (after they set up their Vault, or lost their passphrase)':
    'Beri kunci login ke semua orang yang boleh membukanya (setelah mereka menyiapkan Vault, atau kehilangan frasa sandi)',
  'No logins here yet': 'Belum ada login di sini',
  'Add the client logins your team shares (Meta, Shopify, Google Ads). Paste the 2FA setup key and everyone with access gets the codes here, without anyone’s phone.':
    'Tambahkan login klien yang dipakai bersama oleh tim Anda (Meta, Shopify, Google Ads). Tempel kunci penyiapan 2FA, dan semua orang yang punya akses mendapat kodenya di sini, tanpa perlu ponsel siapa pun.',
  Everyone: 'Semua orang',
  Someone: 'Seseorang',
  'Only you': 'Hanya Anda',
  'Only {name}': 'Hanya {name}',
  'Encrypted on your devices; the server can’t read it': 'Terenkripsi di perangkat Anda; server tidak bisa membacanya',
  'Locked by the server. Edit and save to move it to end-to-end': 'Dikunci oleh server. Ubah lalu simpan untuk memindahkannya ke end-to-end',
  'End-to-end': 'End-to-end',
  'Server-locked': 'Dikunci server',
  '2FA code': 'Kode 2FA',
  'Copy the code': 'Salin kode',
  'Code copied': 'Kode disalin',
  'Copy username': 'Salin nama pengguna',
  'Username copied': 'Nama pengguna disalin',
  'Copy password': 'Salin kata sandi',
  'Password for {title} copied. The clipboard clears in 30 seconds': 'Kata sandi {title} disalin. Papan klip dikosongkan dalam 30 detik',
  More: 'Lainnya',

  // Re-sharing
  'Re-shared {logins} with {people}.': '{logins} dibagikan ulang ke {people}.',
  '{n} logins': '{n} login',
  '{n} people': '{n} orang',
  'Everyone who may open your logins already holds the keys.': 'Semua orang yang boleh membuka login Anda sudah memegang kuncinya.',
  'Could not re-share a login.': 'Login tidak bisa dibagikan ulang.',

  // A login's menu
  'Open {site}': 'Buka {site}',
  'Read notes': 'Baca catatan',
  'Edit and access': 'Ubah dan atur akses',
  'Who used it': 'Siapa yang memakainya',
  Delete: 'Hapus',
  'Delete the login “{title}”? This can’t be undone.': 'Hapus login “{title}”? Tindakan ini tidak bisa diurungkan.',
  'Login deleted': 'Login dihapus',
  'Login saved': 'Login disimpan',

  // Notes and who used it
  'Notes for “{name}”': 'Catatan untuk “{name}”',
  'Reading notes is logged, like copying a password.': 'Membaca catatan juga tercatat, sama seperti menyalin kata sandi.',
  'Who used “{name}”': 'Siapa yang memakai “{name}”',
  'Nobody has used it yet.': 'Belum ada yang memakainya.',
  You: 'Anda',
  Close: 'Tutup',
  '{who} copied the password': '{who} menyalin kata sandi',
  '{who} used a 2FA code': '{who} memakai kode 2FA',
  '{who} read the notes': '{who} membaca catatan',
  '{who} added it': '{who} menambahkannya',
  '{who} changed it': '{who} mengubahnya',
  '{who} re-shared it with {people}': '{who} membagikannya ulang ke {people}',

  // Adding or editing a login
  'Edit login': 'Ubah login',
  'Edit “{name}”': 'Ubah “{name}”',
  Name: 'Nama',
  'e.g. {example}': 'mis. {example}',
  Website: 'Situs web',
  'Username or email': 'Nama pengguna atau email',
  Password: 'Kata sandi',
  'Password (leave empty to keep it)': 'Kata sandi (kosongkan agar tetap sama)',
  Show: 'Tampilkan',
  Hide: 'Sembunyikan',
  Generate: 'Buat acak',
  '2FA setup key (optional)': 'Kunci penyiapan 2FA (opsional)',
  '2FA setup key (saved; paste a new one to replace it)': 'Kunci penyiapan 2FA (tersimpan; tempel yang baru untuk menggantinya)',
  'The key shown when you set up an authenticator app, or the otpauth:// link': 'Kunci yang muncul saat Anda menyiapkan aplikasi autentikator, atau link otpauth://',
  'Notes (optional)': 'Catatan (opsional)',
  'Notes (saved; type to replace)': 'Catatan (tersimpan; ketik untuk menggantinya)',
  'Backup codes, security questions, who to ask': 'Kode cadangan, pertanyaan keamanan, siapa yang bisa ditanya',
  'Company login (no {project})': 'Login perusahaan (tanpa {project})',
  'Who can use it': 'Siapa yang bisa memakainya',
  'Everyone in the company': 'Semua orang di perusahaan',
  People: 'Orang',
  'Add people': 'Tambah orang',
  'You can always see it. People who haven’t set up their Vault yet get the key once you save again after they do.':
    'Anda selalu bisa melihatnya. Orang yang belum menyiapkan Vault akan mendapat kuncinya jika Anda menyimpan lagi setelah mereka menyiapkannya.',
  'You and admins can always see it. People who haven’t set up their Vault yet get the key once you save again after they do.':
    'Anda dan admin selalu bisa melihatnya. Orang yang belum menyiapkan Vault akan mendapat kuncinya jika Anda menyimpan lagi setelah mereka menyiapkannya.',
  'Not set up yet: {names}.': 'Belum menyiapkan Vault: {names}.',
  Cancel: 'Batal',
  'Saving…': 'Menyimpan…',
  'Save login': 'Simpan login',
  'You don’t hold the key to this login. Ask whoever added it to edit and save it, so it’s shared with you.':
    'Anda tidak memegang kunci login ini. Minta orang yang menambahkannya untuk mengubah lalu menyimpannya, agar kuncinya dibagikan ke Anda.',
  'You don’t hold the key to this login, so you can’t change it. Ask whoever added it to edit and save it, so it’s shared with you.':
    'Anda tidak memegang kunci login ini, jadi tidak bisa mengubahnya. Minta orang yang menambahkannya untuk mengubah lalu menyimpannya, agar kuncinya dibagikan ke Anda.',
  'Not a valid 2FA secret': 'Kunci 2FA tidak valid',

  // The gate: the passphrase
  'Set your Vault passphrase': 'Buat frasa sandi Vault Anda',
  'Unlock the Vault': 'Buka kunci Vault',
  'Logins are encrypted on your devices with keys only you hold; the server never sees a password. This passphrase locks your key. There is no reset: if it’s lost, teammates re-share logins with you.':
    'Login dienkripsi di perangkat Anda dengan kunci yang hanya Anda pegang; server tidak pernah melihat kata sandi. Frasa sandi ini mengamankan kunci Anda. Frasa sandi tidak bisa diatur ulang: jika hilang, rekan tim membagikan ulang login ke Anda.',
  'Your key stays in this tab until you close it.': 'Kunci Anda tetap terbuka di tab ini sampai Anda menutupnya.',
  Passphrase: 'Frasa sandi',
  'Once more': 'Ulangi frasa sandi',
  'Working…': 'Memproses…',
  'Set and open': 'Simpan dan buka',
  Unlock: 'Buka kunci',
  'Use at least 8 characters.': 'Minimal 8 karakter.',
  'The two don’t match.': 'Keduanya tidak sama.',
  'That’s not it. Try again.': 'Frasa sandi salah. Coba lagi.',
  'Unlock the Vault first.': 'Buka kunci Vault dulu.',

  // The server's messages on Vault screens (keyed by its exact English)
  'Something went wrong.': 'Ada yang salah.',
  'No such login.': 'Login tidak ditemukan.',
  'Not found.': 'Tidak ditemukan.',
  'You don’t hold the key to this login.': 'Anda tidak memegang kunci login ini.',
  'Only the person who added it, or an admin, can change it.': 'Hanya orang yang menambahkannya, atau admin, yang bisa mengubahnya.',
  'Only the person who added it, or an admin, can delete it.': 'Hanya orang yang menambahkannya, atau admin, yang bisa menghapusnya.',
  'That 2FA key doesn’t look right. Paste the setup key (letters and numbers) or the otpauth:// link.':
    'Kunci 2FA itu sepertinya salah. Tempel kunci penyiapan (huruf dan angka) atau link otpauth://.',
  'Passwords and codes stay with them: you’re signed in as them.': 'Kata sandi dan kode hanya untuk mereka: Anda sedang masuk sebagai mereka.',
  'No 2FA on this login.': 'Login ini tidak punya 2FA.',

  // Phones: Apple Passwords' list, a login's own screen, the locked screen
  'Which logins': 'Login mana',
  'No logins yet': 'Belum ada login',
  'Tap + to add a client login. Paste its 2FA setup key and the team gets the codes here.': 'Ketuk + untuk menambah login klien. Tempel kunci penyiapan 2FA-nya, dan tim mendapat kodenya di sini.',
  'Search logins': 'Cari login',
  'No logins with “{query}”.': 'Tidak ada login dengan “{query}”.',
  'End-to-end encrypted. Copying a password is logged.': 'Terenkripsi end-to-end. Setiap salinan kata sandi tercatat.',
  'End-to-end encrypted.': 'Terenkripsi end-to-end.',
  'Everyone who uses it loses it too. This can’t be undone.': 'Semua yang memakainya juga kehilangan login ini. Tidak bisa dibatalkan.',
  'Delete login': 'Hapus login',
  'Copy 2FA code': 'Salin kode 2FA',
  'Has a 2FA code': 'Punya kode 2FA',
  'No username': 'Tanpa nama pengguna',
  '{n} seconds left': '{n} detik lagi',
  'Changed {when} by {name}': 'Diubah {when} oleh {name}',
  Username: 'Nama pengguna',
  'Show the 2FA code': 'Tampilkan kode 2FA',
  'Vault is locked': 'Vault terkunci',
  'Your passphrase opens it on this device until you close {product}.': 'Frasa sandi Anda membukanya di perangkat ini sampai Anda menutup {product}.',
  'Logins are encrypted with keys only you hold. This passphrase locks your key, and it can’t be reset.':
    'Login dienkripsi dengan kunci yang hanya Anda pegang. Frasa sandi ini mengunci kunci Anda, dan tidak bisa diatur ulang.',
  'The server never sees a password: logins are locked on your devices. If the passphrase is lost, teammates share the logins with you again.':
    'Server tidak pernah melihat kata sandi: login dikunci di perangkat Anda. Jika frasa sandi hilang, rekan tim membagikan ulang login kepada Anda.',
};

export default id;
