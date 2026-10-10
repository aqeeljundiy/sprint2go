// Bahasa Indonesia: guest. Owner: Builder 5 (tables, vault, guest).
// What guests see: ClientApp, SharedHome, clientActions, clientView.
// The key is the exact English text in the code; the value is how it reads in Indonesian. Tone, the glossary and
// the rules for placeholders and plurals: docs/i18n.md. Check with: node scripts/i18n-check.mjs
const id: Record<string, string> = {
  // The portal's apps, the rail and the phone bar (ClientApp). The bar has five tabs and a create button: its own
  // shorter words where Indonesian runs long.
  Work: 'Pekerjaan',
  'bar::Approvals': 'Setujui',
  'bar::Requests': 'Ajuan',
  Portal: 'Portal',
  '{company} for {project}': '{company} untuk {project}',
  'Your account': 'Akun Anda',
  '{n} waiting': '{n} menunggu',
  'Drag to resize · double-click to reset': 'Seret untuk mengubah ukuran · klik dua kali untuk mengembalikan',

  // The sidebars and the phone's title menus (ClientApp)
  'requests::Open': 'Berjalan',
  'All requests': 'Semua permintaan',
  'Which requests': 'Permintaan mana',
  Everything: 'Semua',
  'Needs approval': 'Perlu persetujuan',
  'Which work': 'Pekerjaan mana',
  'All files': 'Semua file',
  'From {company}': 'Dari {company}',
  'Channel materials': 'Materi channel',
  'Which files': 'File mana',
  'Which meeting': 'Rapat mana',
  '{company} hasn’t added you to a conversation yet.': '{company} belum menambahkan Anda ke percakapan.',
  'No meetings yet.': 'Belum ada rapat.',

  // Where work is, in the guest's words (ClientApp; clientView's requestStatus, which notices read as phrase(label))
  Done: 'Selesai',
  New: 'Baru',
  'Waiting on you': 'Menunggu Anda',
  'In progress': 'Dikerjakan',
  Planned: 'Direncanakan',

  // Home (ClientApp)
  'Answer the quote “{title}”': 'Jawab penawaran “{title}”',
  'Approve “{title}”': 'Setujui “{title}”',
  'Your request “{title}” is waiting on you': 'Permintaan Anda “{title}” menunggu tanggapan Anda',
  'Nothing waiting on you. 🎉': 'Tidak ada yang menunggu Anda. 🎉',
  'Your requests': 'Permintaan Anda',
  'Need something? Send a request and the team picks it up.': 'Butuh sesuatu? Kirim permintaan, tim akan menanganinya.',
  'New request': 'Permintaan baru',
  'Work in progress': 'Pekerjaan berjalan',
  'due {date}': 'tenggat {date}',
  'The team shares briefs here as work starts.': 'Tim membagikan brief di sini saat pekerjaan dimulai.',
  'Latest meeting': 'Rapat terakhir',
  '{n} min': '{n} menit',
  'Recent files': 'File terbaru',
  'This is a demo file without content.': 'Ini file demo tanpa isi.',
  'Nothing shared yet.': 'Belum ada yang dibagikan.',
  'From the team': 'Dari tim',
  'Made with {logo} sprint2go': 'Dibuat dengan {logo} sprint2go',

  // Requests (ClientApp)
  '{n} waiting on you': '{n} menunggu Anda',
  'The team picks these up like tickets': 'Tim menanganinya seperti tiket',
  'No requests here': 'Belum ada permintaan di sini',
  'Send one with “New request”.': 'Kirim lewat “Permintaan baru”.',
  'Your colleagues’ requests show up here.': 'Permintaan rekan kerja Anda muncul di sini.',
  'Request sent. The team has been told.': 'Permintaan terkirim. Tim sudah diberi tahu.',

  // Work (ClientApp)
  'Other work': 'Pekerjaan lain',
  'Due {date} · {done} of {total} done': 'Tenggat {date} · {done} dari {total} selesai',
  '{done} of {total} done': '{done} dari {total} selesai',
  '{n} waiting for your approval': '{n} menunggu persetujuan Anda',
  'Nothing waiting on you': 'Tidak ada yang menunggu Anda',
  'Nothing here yet': 'Belum ada apa-apa di sini',
  'The team shares tasks and briefs with you as work moves.': 'Tim membagikan tugas dan brief dengan Anda seiring pekerjaan berjalan.',

  // Files (ClientApp)
  'in chat': 'di chat',
  'Files, links and docs in this channel': 'File, link, dan dokumen di channel ini',
  'Uploads go to “From {company}”': 'Unggahan masuk ke “Dari {company}”',
  'What the team shares with you': 'Yang dibagikan tim dengan Anda',
  'No files yet': 'Belum ada file',
  'Upload files for the team here.': 'Unggah file untuk tim di sini.',
  '{company} shares files with you here.': '{company} membagikan file dengan Anda di sini.',
  '{n} files uploaded.': '{n} file diunggah.',
  '{n} files uploaded. Files over 8 MB: share a link instead.': '{n} file diunggah. File di atas 8 MB: bagikan link-nya saja.',

  // Meetings (ClientApp)
  'Notes from meetings you were in': 'Notulen dari rapat yang Anda ikuti',
  'No meetings yet': 'Belum ada rapat',
  'Notes appear here after you meet with the team.': 'Notulen muncul di sini setelah Anda rapat dengan tim.',
  'noun::Recording': 'Rekaman',
  Summary: 'Ringkasan',
  Decisions: 'Keputusan',
  'Key points': 'Poin penting',
  'Next steps': 'Langkah berikutnya',
  'The team hasn’t shared notes for this meeting.': 'Tim belum membagikan notulen rapat ini.',

  // Chat (ClientApp)
  'No conversations yet': 'Belum ada percakapan',
  '{company} will add you to a channel.': '{company} akan menambahkan Anda ke channel.',

  // After the work ends, Ask AI and "View as guest" (ClientApp)
  'Your work with {company} ended on {date}. You can still read everything and download files.':
    'Kerja sama Anda dengan {company} berakhir pada {date}. Anda masih bisa membaca semuanya dan mengunduh file.',
  'Your work with {company} ended. You can still read everything and download files.':
    'Kerja sama Anda dengan {company} sudah berakhir. Anda masih bisa membaca semuanya dan mengunduh file.',
  'What {company} shared with {project}': 'Yang dibagikan {company} dengan {project}',
  source: 'sumber',
  'Viewing as {name}': 'Melihat sebagai {name}',
  'Switch person': 'Ganti orang',
  Exit: 'Keluar',

  // A task, brief or request in the side panel (ClientApp, TaskPanel)
  Brief: 'Brief',
  Request: 'Permintaan',
  'Waiting for your approval': 'Menunggu persetujuan Anda',
  'Approve it, or tell the team what to change.': 'Setujui, atau beri tahu tim apa yang perlu diubah.',
  'Only approvers at {company} can approve. You can still comment.': 'Hanya penyetuju di {company} yang bisa menyetujui. Anda tetap bisa berkomentar.',
  'Ask for changes': 'Minta perubahan',
  'What should change?': 'Apa yang perlu diubah?',
  'Send changes': 'Kirim perubahan',
  'Approved by {name}': 'Disetujui oleh {name}',
  'Approved by {name}: “{note}”': 'Disetujui oleh {name}: “{note}”',
  'Changes asked by {name}': 'Perubahan diminta oleh {name}',
  'Changes asked by {name}: “{note}”': 'Perubahan diminta oleh {name}: “{note}”',
  'In charge': 'Penanggung jawab',
  'Doing it': 'Dikerjakan oleh',
  'Needed by': 'Batas waktu',
  Due: 'Tenggat',
  'Sent by': 'Dikirim oleh',
  Context: 'Konteks',
  'Tasks in this brief': 'Tugas dalam brief ini',
  Conversation: 'Percakapan',
  'No messages yet.': 'Belum ada pesan.',
  'Write to the team…': 'Tulis ke tim…',

  // What happened on a task, saved with msg() (clientActions) and read after a name: "Laras menyetujuinya"
  'approved it': 'menyetujuinya',
  'approved it: “{note}”': 'menyetujuinya: “{note}”',
  'asked for changes: “{note}”': 'meminta perubahan: “{note}”',
  'sent this request': 'mengirim permintaan ini',
  'Attached: {files}': 'Lampiran: {files}',

  // A new request (ClientApp, NewRequest)
  'What do you need?': 'Apa yang Anda butuhkan?',
  'e.g. A new banner for the Ramadan promo': 'mis. Banner baru untuk promo Ramadan',
  Details: 'Detail',
  'Sizes, wording, examples you like, anything that helps': 'Ukuran, teks, contoh yang Anda suka, apa pun yang membantu',
  'Needed by (optional)': 'Batas waktu (opsional)',
  Attach: 'Lampirkan',
  'The team gets this straight away. You’ll see when they pick it up, and you can talk about it on the request.':
    'Tim langsung menerimanya. Anda akan melihat saat mereka mulai mengerjakannya, dan Anda bisa membahasnya di permintaan ini.',
  'Send request': 'Kirim permintaan',

  // The account menu and the profile (ClientApp, PersonMenu and ProfileDialog). The roles: what a guest may do.
  Viewer: 'Pelihat',
  Collaborator: 'Kolaborator',
  Approver: 'Penyetuju',
  'Your profile and password': 'Profil dan kata sandi Anda',
  'Their name': 'Nama mereka',
  'name@{domain}': 'nama@{domain}',
  'Invite link copied': 'Link undangan disalin',
  'Ask to add them': 'Ajukan undangan',
  'Invite a colleague': 'Undang rekan kerja',
  'Exit {who} view': 'Keluar dari tampilan {who}',
  'You see what {company} shares with you. Need something? Use Requests or Chat.': 'Anda melihat yang dibagikan {company} dengan Anda. Butuh sesuatu? Pakai Permintaan atau Chat.',
  'Profile saved': 'Profil tersimpan',
  'Your profile': 'Profil Anda',
  'Or a colour': 'Atau warna',
  'Colour {color}': 'Warna {color}',
  'Job title': 'Jabatan',
  'e.g. Marketing lead': 'mis. Kepala marketing',
  'You sign in with this address. The same sign-in works for everything shared with you.': 'Anda masuk dengan alamat ini. Akun yang sama berlaku untuk semua yang dibagikan dengan Anda.',

  // Inviting a colleague, Ask AI and the team's name (clientActions, clientView)
  '{company} adds new people for you. Ask your contact there.': '{company} yang menambahkan orang baru untuk Anda. Tanyakan ke kontak Anda di sana.',
  'They already have access.': 'Mereka sudah punya akses.',
  'Sent to {company} to approve.': 'Dikirim ke {company} untuk disetujui.',
  '{email} isn’t at @{domain}, so {company} needs to approve it.': '{email} bukan alamat @{domain}, jadi {company} perlu menyetujuinya.',
  '{email} isn’t at your company, so {company} needs to approve it.': '{email} bukan dari perusahaan Anda, jadi {company} perlu menyetujuinya.',
  '{name} can join with the invite link.': '{name} bisa bergabung lewat link undangan.',
  '{name} has access now. They’ll find it under “Shared with you”.': '{name} sekarang punya akses. Mereka akan menemukannya di “Dibagikan dengan Anda”.',
  'AI isn’t switched on for your shared space.': 'AI belum diaktifkan untuk ruang bersama Anda.',
  'You’ve used all {n} questions for this month. They reset on the 1st.': 'Anda sudah memakai semua {n} pertanyaan bulan ini. Kuotanya diisi ulang tanggal 1.',
  '{company} team': 'Tim {company}',

  // Shared with you: a guest's home with several shared spaces (SharedHome)
  'Shared with you · {product}': 'Dibagikan dengan Anda · {product}',
  '{n} things waiting for your OK.': '{n} hal menunggu persetujuan Anda.',
  'Hi {name}. Nothing is waiting on you right now.': 'Hai {name}. Saat ini tidak ada yang menunggu Anda.',
  'Ended, read only': 'Berakhir, hanya baca',
  '{n} to approve': '{n} perlu disetujui',
  'Updated {when}': 'Diperbarui {when}',
  'Nothing new': 'Tidak ada yang baru',
  'Back to {company}': 'Kembali ke {company}',
  'Your own company’s apps. Everything shared with you stays in the workspace switcher.': 'Aplikasi perusahaan Anda sendiri. Semua yang dibagikan dengan Anda tetap ada di pengalih workspace.',
  'Start your own workspace': 'Buat workspace sendiri',
  'Free. Mail, chat, tasks and files for your own team. You keep access to everything shared with you here.':
    'Gratis. Email, chat, tugas, dan file untuk tim Anda sendiri. Akses ke semua yang dibagikan dengan Anda di sini tetap ada.',
};

export default id;
