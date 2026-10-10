// Bahasa Indonesia: home. Owner: Builder 1 (foundation).
// Home: Needs you, Today, Updates, the strips, Customise (HomeView.tsx, home/*, needsYou.ts).
// The key is the exact English text in the code; the value is how it reads in Indonesian. Tone, the glossary and
// the rules for placeholders and plurals: docs/i18n.md. Check with: node scripts/i18n-check.mjs
const id: Record<string, string> = {
  // The greeting (HomeView). Indonesian says pagi until 11, siang until 15, sore until 18, malam after.
  'Good morning, {name}.': 'Selamat pagi, {name}.',
  'Good afternoon, {name}.': 'Selamat siang, {name}.',
  'Good evening, {name}.': 'Selamat sore, {name}.',
  'after 6 pm::Good evening, {name}.': 'Selamat malam, {name}.',
  'Working late, {name}.': 'Selamat malam, {name}.',

  // The top of Home (HomeView)
  'Open menu': 'Buka menu',
  Customise: 'Atur',
  'Jump to a {project}, task, person or file, or ask anything': 'Cari {project}, tugas, orang, atau file, atau tanya apa saja',
  'Read more': 'Selengkapnya',
  Dismiss: 'Tutup',
  'Finish setting up': 'Selesaikan pengaturan',
  'Set up': 'Atur',

  // Needs you (HomeView, home/HomeParts)
  'Needs you': 'Perlu Anda',
  'You’re clear for now': 'Semua beres untuk saat ini',
  'Next: {title} at {time}.': 'Berikutnya: {title} pukul {time}.',
  'Next on your list: “{title}”, {when}.': 'Berikutnya di daftar Anda: “{title}”, {when}.',
  'Nothing waiting on you. A good time to get ahead.': 'Tidak ada yang menunggu Anda. Saat yang pas untuk mencicil pekerjaan.',
  Start: 'Mulai',
  'Close brief': 'Tutup brief',
  'Moved to tomorrow': 'Dipindah ke besok',
  Seen: 'Dilihat',
  'Marked as seen': 'Ditandai sudah dilihat',
  'Show fewer': 'Tampilkan lebih sedikit',
  'Show {n} more': 'Tampilkan {n} lagi',

  // Why each item needs you (needsYou.ts)
  'Happening now': 'Sedang berlangsung',
  'In {n} min': 'Dalam {n} menit',
  'In {n} min, at {time}': 'Dalam {n} menit, pukul {time}',
  '{name} finished it, waiting for your review': '{name} sudah menyelesaikannya, menunggu review Anda',
  'The guest': 'Tamu',
  '{name} asked for changes': '{name} meminta perubahan',
  '{name} asked for changes: “{note}”': '{name} meminta perubahan: “{note}”',
  'New request from {name}': 'Permintaan baru dari {name}',
  'New request from a guest': 'Permintaan baru dari tamu',
  'Was due {when}': 'Seharusnya selesai {when}',
  'Due today': 'Jatuh tempo hari ini',
  '{team} queue, nobody on it yet': 'Antrean {team}, belum ada yang ambil',
  'Team queue, nobody on it yet': 'Antrean tim, belum ada yang ambil',
  'Late with {name}': 'Terlambat, dipegang {name}',
  'Late with someone': 'Terlambat, dipegang seseorang',
  '(no subject)': '(tanpa subjek)',
  '{name} is waiting for a reply': '{name} menunggu balasan',
  'Every task is done, close the brief': 'Semua tugas selesai, tutup brief-nya',
  'Mentioned you': 'Menyebut Anda',
  'From a guest': 'Dari tamu',
  'Your task': 'Tugas Anda',
  yesterday: 'kemarin',

  // The meeting strip and huddles (home/HomeParts)
  'Up next': 'Berikutnya',
  'The notetaker will join': 'Notulis akan bergabung',
  'The notetaker won’t join': 'Notulis tidak akan bergabung',
  Notetaker: 'Notulis',
  'Send notetaker': 'Kirim notulis',
  'Notetaker on the way': 'Notulis sedang bergabung',
  Join: 'Gabung',
  'Huddle in #{channel}': 'Huddle di #{channel}',
  'huddle::Starting': 'Baru dimulai',

  // Updates, on phones (home/HomeParts)
  Updates: 'Kabar terbaru',
  'Mark all read': 'Tandai semua dibaca',
  'Nothing new.': 'Tidak ada yang baru.',
  'All notifications': 'Semua notifikasi',

  // Today (home/HomeParts)
  'Mark “{title}” done': 'Tandai “{title}” selesai',

  // Customise (HomeView, home/HomeParts)
  'Customise Home': 'Atur Beranda',
  'Which cards show, and in what order': 'Kartu yang tampil dan urutannya',
  'Start from': 'Mulai dari',
  'Start from: {template}': 'Mulai dari: {template}',
  'Home template': 'Template Beranda',
  'Add a card': 'Tambah kartu',
  'All cards added': 'Semua kartu sudah ditambahkan',
  Reset: 'Atur ulang',
  'Drag cards to reorder, or use the arrows. Make a card wide or narrow, or remove it. Only your Home changes.':
    'Seret kartu untuk mengubah urutannya, atau pakai tanda panah. Buat kartu lebar atau sempit, atau hapus. Hanya Beranda Anda yang berubah.',
  'Make narrow': 'Buat sempit',
  'Make wide': 'Buat lebar',
  'Remove card': 'Hapus kartu',
  'On your Home': 'Di Beranda Anda',
  'Move {name} up': 'Pindahkan {name} ke atas',
  'Move {name} down': 'Pindahkan {name} ke bawah',
  'Back to the usual for my role': 'Kembalikan ke bawaan untuk peran saya',

  // Home templates (HomeView; Teams shows them too)
  'Founder / C-level': 'Pendiri / C-level',
  'What’s happening across the whole company': 'Yang terjadi di seluruh perusahaan',
  'Team lead': 'Ketua tim',
  'Your team’s queue and who is busy': 'Antrean tim Anda dan siapa yang sibuk',
  'Designer / Editor': 'Desainer / Editor',
  'Your queue and the briefs behind it': 'Antrean Anda dan brief di baliknya',
  'Account manager': 'Account manager',
  'Your {projects}, their emails and meetings': '{Projects} Anda, beserta email dan rapatnya',
  'Finance / Admin': 'Keuangan / Admin',
  'Payments, invoices and deadlines': 'Pembayaran, invoice, dan tenggat',

  // The cards: names and hints (HomeView)
  Briefing: 'Ringkasan',
  'A short summary of your day': 'Ringkasan singkat hari Anda',
  'Brain dump': 'Brain dump',
  'Type what’s on your mind': 'Tulis apa yang ada di pikiran Anda',
  'Company numbers': 'Angka perusahaan',
  'Late, not picked up, done this week': 'Terlambat, belum diambil, selesai minggu ini',
  '{Projects} at risk': '{Projects} berisiko',
  'Late or stuck work per {project}': 'Pekerjaan terlambat atau macet per {project}',
  'Open and late work per team': 'Pekerjaan berjalan dan terlambat per tim',
  Workload: 'Beban kerja',
  'How busy each person is': 'Seberapa sibuk tiap orang',
  'Waiting on you': 'Menunggu Anda',
  'Already at the top, in Needs you': 'Sudah ada di atas, di Perlu Anda',
  'Team queue': 'Antrean tim',
  'Tasks nobody has picked up yet': 'Tugas yang belum diambil siapa pun',
  Briefs: 'Brief',
  'Bigger jobs and their progress': 'Pekerjaan besar dan progresnya',
  'My tasks': 'Tugas saya',
  'Your queue, in order': 'Antrean Anda, sesuai urutan',
  'Your next meetings': 'Rapat Anda berikutnya',
  'Unread mail': 'Email belum dibaca',
  'Mail waiting for you': 'Email yang menunggu Anda',
  'For you': 'Untuk Anda',
  'Mentions and assignments': 'Sebutan dan tugas untuk Anda',
  'From meetings': 'Dari rapat',
  'Action items without an owner': 'Tindak lanjut tanpa penanggung jawab',
  'Every {project} at a glance': 'Semua {project} dalam satu tampilan',
  'Wins this week': 'Pencapaian minggu ini',
  'What the team finished': 'Yang diselesaikan tim',

  // Briefing (HomeView)
  '{n} tasks are late across the company, most at {project}.': '{n} tugas terlambat di seluruh perusahaan, terbanyak di {project}.',
  '{n} tasks are late across the company.': '{n} tugas terlambat di seluruh perusahaan.',
  '{n} tasks waiting for someone to pick up.': '{n} tugas menunggu diambil.',
  'The team finished {n} this week.': 'Tim menyelesaikan {n} tugas minggu ini.',
  '{n} of your tasks are overdue, starting with “{title}”.': '{n} tugas Anda terlambat, mulai dari “{title}”.',
  '{n} due today.': '{n} jatuh tempo hari ini.',
  '{n} in your team’s queue without a person.': '{n} di antrean tim Anda belum ada yang mengambil.',
  '{n} unread emails.': '{n} email belum dibaca.',
  'Next up: {title} at {time}.': 'Berikutnya: {title} pukul {time}.',
  'Nothing urgent. A good day to get ahead.': 'Tidak ada yang mendesak. Hari yang pas untuk mencicil pekerjaan.',

  // Brain dump card (HomeView)
  'What’s on your mind? {Projects}, who does what, by when…': 'Apa yang ada di pikiran Anda? {Projects}, siapa mengerjakan apa, kapan selesai…',

  // Company numbers, at risk, teams, workload (HomeView)
  '{Projects} × teams': '{Projects} × tim',
  Late: 'Terlambat',
  'Not picked up': 'Belum diambil',
  'Done this week': 'Selesai minggu ini',
  'No {project} has late or stuck work.': 'Tidak ada {project} dengan pekerjaan terlambat atau macet.',
  '{n} late': '{n} terlambat',
  '{n} not picked up': '{n} belum diambil',
  'No team has late or unassigned work.': 'Tidak ada tim dengan pekerjaan terlambat atau tanpa penanggung jawab.',
  '{open} open · {week} this week': '{open} berjalan · {week} minggu ini',
  '{open} open · {week} this week · {late} late': '{open} berjalan · {week} minggu ini · {late} terlambat',

  // Waiting on you, team queue (HomeView)
  'Nothing is waiting on you.': 'Tidak ada yang menunggu Anda.',
  'Pick someone for “{title}”': 'Pilih orang untuk “{title}”',
  '“{title}” is late': '“{title}” terlambat',
  'with {name}': 'dipegang {name}',
  'with someone': 'dipegang seseorang',
  'All tasks done in “{title}”': 'Semua tugas di “{title}” selesai',
  'Review and close the brief': 'Periksa lalu tutup brief-nya',
  'High priority, due now': 'Prioritas tinggi, jatuh tempo sekarang',
  'Every task has a person. Nice.': 'Semua tugas sudah ada yang mengerjakan.',

  // Briefs, my tasks, today, mail, for you, meetings (HomeView)
  'All briefs': 'Semua brief',
  'No open briefs.': 'Tidak ada brief yang berjalan.',
  'All tasks': 'Semua tugas',
  'Nothing on your plate. 🎉': 'Tidak ada tugas untuk Anda. 🎉',
  'Mark done': 'Tandai selesai',
  'No more meetings today.': 'Tidak ada rapat lagi hari ini.',
  'Inbox zero.': 'Kotak masuk kosong.',
  'You’re all caught up.': 'Anda sudah melihat semuanya.',
  'Every meeting action item has an owner.': 'Semua tindak lanjut rapat sudah ada penanggung jawabnya.',
  'no owner': 'tanpa penanggung jawab',

  // Projects or clients card (HomeView). A due day read mid-sentence: "Berikutnya: Logo, besok".
  'Next: {title}, {when}': 'Berikutnya: {title}, {when}',
  'Next: {title}': 'Berikutnya: {title}',
  'Lead: nothing scheduled': 'Calon klien: belum ada jadwal',
  'Nothing open': 'Tidak ada yang berjalan',
  overdue: 'terlambat',
  today: 'hari ini',
  tomorrow: 'besok',

  // Wins this week (HomeView)
  'Nothing finished yet this week.': 'Belum ada yang selesai minggu ini.',
  'Kudos to you': 'Apresiasi untuk Anda',
  'Kudos to {name}': 'Apresiasi untuk {name}',
  'from you': 'dari Anda',
  'from {name}': 'dari {name}',
  someone: 'seseorang',

  // The phone's Home: the line under the greeting, the set-up row
  '{n} things need you.': '{n} hal perlu Anda tangani.',
  'Nothing needs you right now. Next: {title} at {time}.': 'Tidak ada yang perlu Anda tangani sekarang. Berikutnya: {title} pukul {time}.',
  '{n} left: {what}': '{n} lagi: {what}',
};

export default id;
