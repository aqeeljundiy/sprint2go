// Bahasa Indonesia: onboarding. Owner: Builder 1 (foundation).
// Setting up a company (Onboarding.tsx) and the first-run welcome.
// The key is the exact English text in the code; the value is how it reads in Indonesian. Tone, the glossary and
// the rules for placeholders and plurals: docs/i18n.md. Check with: node scripts/i18n-check.mjs
const id: Record<string, string> = {
  // The steps (Onboarding.tsx)
  Account: 'Akun',
  Apps: 'Aplikasi',
  Team: 'Tim',
  'Preview · nothing is saved': 'Pratinjau · tidak ada yang disimpan',
  'Finish preview': 'Selesaikan pratinjau',
  'Create {name}': 'Buat {name}',
  company: 'perusahaan',

  // The end of the preview
  'That’s the whole flow': 'Itulah seluruh alurnya',
  'A real sign-up would now create {company}, send the team’s invites and open Home with a short checklist: {first}, add a first project, invite the team.':
    'Pendaftaran sungguhan kini akan membuat {company}, mengirim undangan ke tim, lalu membuka Beranda dengan daftar periksa singkat: {first}, tambahkan proyek pertama, undang tim.',
  'the company': 'perusahaan',
  'finish the email move': 'selesaikan pemindahan email',
  'invite the team': 'undang tim',
  'set up forwarding': 'atur penerusan email',
  'Close preview': 'Tutup pratinjau',

  // The sign-up screen (shown in the preview only)
  'Free to start. No card needed.': 'Gratis untuk memulai. Tanpa kartu kredit.',
  'Continue with Google': 'Lanjutkan dengan Google',
  or: 'atau',
  'We send a 6-digit code to check it’s yours.': 'Kami mengirim kode 6 digit untuk memastikan email ini milik Anda.',

  // Company
  'Set up your company': 'Siapkan perusahaan Anda',
  'This becomes your workspace: your brand, your people, your {projects}.': 'Ini menjadi workspace Anda: brand, orang-orang, dan {projects} Anda.',
  'Company name': 'Nama perusahaan',
  'e.g. Nusa Creative': 'mis. Nusa Creative',
  'Company domain': 'Domain perusahaan',
  'Your work email': 'Email kantor Anda',
  'Use an address at @{domain}.': 'Gunakan alamat dengan @{domain}.',
  'What does the company do?': 'Apa bidang usaha perusahaan ini?',
  'Picks the starter tables and brief templates. Everything can be changed later.': 'Menentukan tabel awal dan template brief. Semuanya bisa diubah nanti.',
  'Our clients should see our brand, not sprint2go’s': 'Klien kami harus melihat brand kami, bukan brand sprint2go',
  'Clients sign in at your own address (like portal.youragency.com) and see your name and logo, never ours. Change it any time in Settings, Client portal & brand.':
    'Klien masuk di alamat Anda sendiri (seperti portal.agensianda.com) dan melihat nama serta logo Anda, bukan milik kami. Ubah kapan saja di Pengaturan, Portal klien & brand.',
  // What the company does: INDUSTRIES in src/types.ts, shown with t()
  'Agency or studio': 'Agensi atau studio',
  'Clients, campaigns, content': 'Klien, kampanye, konten',
  'Brand or online shop': 'Brand atau toko online',
  'Products, launches, suppliers': 'Produk, peluncuran, pemasok',
  'Consulting or services': 'Konsultan atau jasa',
  'Prospects, proposals, engagements': 'Prospek, proposal, kontrak kerja',
  'Software or startup': 'Software atau startup',
  'Releases, bugs, customers': 'Rilis, bug, pelanggan',
  Events: 'Acara',
  'Venues, vendors, sponsors': 'Venue, vendor, sponsor',
  'Something else': 'Lainnya',
  'Start plain': 'Mulai dari kosong',

  // Apps
  'Which apps do you want?': 'Aplikasi apa saja yang Anda perlukan?',
  'Every app is included in every plan, Free too. There are no add-ons per app. Switch off what your team doesn’t need; you can change it any time.':
    'Semua aplikasi termasuk di setiap paket, juga paket Gratis. Tidak ada biaya tambahan per aplikasi. Matikan yang tidak dibutuhkan tim Anda; bisa diubah kapan saja.',
  'What should the notetaker keep?': 'Apa yang disimpan pencatat rapat?',
  'It writes the notes from the meeting’s audio either way. People can change this per meeting, and you can change it later in Settings.':
    'Notulen tetap ditulis dari audio rapat, apa pun pilihannya. Setiap orang bisa mengubahnya per rapat, dan Anda bisa mengubahnya nanti di Pengaturan.',
  'Audio and notes': 'Audio dan notulen',
  'Recommended. About 30 MB per hour': 'Disarankan. Sekitar 30 MB per jam',
  'Video too (Beta)': 'Juga video (Beta)',
  'Cameras and screen shares. About 1 GB per hour': 'Kamera dan berbagi layar. Sekitar 1 GB per jam',
  'Notes and transcript only': 'Hanya notulen dan transkrip',
  'Almost no space': 'Hampir tidak makan tempat',
  'Which languages are your meetings in?': 'Rapat Anda memakai bahasa apa?',
  'Transcripts only come out in these. Pick two if people mix them, like Indonesian and English; the first is the main one.':
    'Transkrip hanya dibuat dalam bahasa ini. Pilih dua jika orang mencampurnya, seperti bahasa Indonesia dan Inggris; yang pertama adalah bahasa utama.',
  Free: 'Gratis',
  'This company starts on {free} (up to 5 people, your own AI keys).': 'Perusahaan ini mulai di paket {free} (hingga 5 orang, dengan key AI sendiri).',
  'Your first 14 days are on Studio AI with everything switched on. After that you stay on {free} (up to 5 people) unless you pick a plan. No card, no surprise charges.':
    '14 hari pertama Anda memakai Studio AI dengan semua fitur aktif. Setelah itu Anda tetap di paket {free} (hingga 5 orang), kecuali Anda memilih paket. Tanpa kartu, tanpa tagihan mendadak.',
  'You’ve already had a free trial.': 'Anda sudah pernah memakai uji coba gratis.',

  // Email
  'Where does your company’s email live?': 'Di mana email perusahaan Anda akan berada?',
  '{product} works with any of these. You can move people later.': '{product} bisa dipakai dengan semua pilihan ini. Anda bisa memindahkan orang nanti.',
  'Keep Gmail or Outlook, forward here': 'Tetap pakai Gmail atau Outlook, teruskan ke sini',
  'Mail stays where it is. A copy of everything comes to {product} to read, and you reply from Gmail or Outlook. Nothing moves.':
    'Email tetap di tempatnya. Salinan semua email masuk ke {product} untuk dibaca, dan Anda membalas dari Gmail atau Outlook. Tidak ada yang dipindah.',
  'Move our email to {product}': 'Pindahkan email kami ke {product}',
  'We host your new mail, so you can cancel Google or Microsoft. Cheapest per person. Your old mail stays in {where} until you cancel it.':
    'Kami yang meng-host email baru Anda, jadi Anda bisa berhenti berlangganan Google atau Microsoft. Paling hemat per orang. Email lama tetap di {where} sampai Anda berhenti berlangganan.',
  'your current mailbox': 'kotak surat Anda saat ini',
  'Some of each': 'Campuran keduanya',
  'Keep pricey licences for a few people and give everyone else a {product} mailbox.': 'Pertahankan lisensi mahal untuk beberapa orang, dan beri yang lain kotak surat {product}.',
  'We don’t need email here': 'Kami tidak butuh email di sini',
  'Switch Mail off. Use Chat, Tasks, Calendar and the rest.': 'Matikan Email. Pakai Chat, Tugas, Kalender, dan lainnya.',
  'Other (IMAP)': 'Lainnya (IMAP)',
  Other: 'Lainnya',
  'Where is your email today?': 'Di mana email Anda saat ini?',
  'People on {product} mail': 'Pakai email {product}',
  'People who keep {provider}': 'Tetap pakai {provider}',
  'Give people a {domain} mailbox here': 'Beri orang kotak surat {domain} di sini',
  'Their mail, copied here': 'Email mereka, disalin ke sini',
  'How the move works': 'Cara pemindahannya',
  'How forwarding works': 'Cara penerusannya',
  'How your mail goes out': 'Cara email Anda dikirim',
  '{product} mail server': 'Server email {product}',
  Included: 'Termasuk',
  'Free. A brand-new domain may land in spam for the first weeks while its reputation builds.': 'Gratis. Domain yang benar-benar baru bisa masuk spam di minggu-minggu pertama, selagi reputasinya terbangun.',
  'Boosted sending': 'Pengiriman Boosted',
  Credits: 'Kredit',
  'Through Amazon on our account: proven delivery to Gmail and Outlook from day one. Paid per email, from Rp 15.000 per 1,000.':
    'Lewat Amazon dengan akun kami: terbukti sampai ke Gmail dan Outlook sejak hari pertama. Bayar per email, mulai Rp 15.000 per 1.000.',
  'You can finish now and do this later from Settings, Email delivery.': 'Anda bisa selesai sekarang dan mengaturnya nanti di Pengaturan, Pengiriman email.',
  'In this preview the waits are simulated.': 'Di pratinjau ini, waktu tunggunya hanya simulasi.',

  // Team
  'Invite your team': 'Undang tim Anda',
  'They’ll get an email to set their own password. You can skip this and invite people later.': 'Mereka akan menerima email untuk membuat kata sandi sendiri. Anda bisa melewati langkah ini dan mengundang orang nanti.',
  'name@{domain}': 'nama@{domain}',
  'name@company.com': 'nama@perusahaan.com',
  Role: 'Peran',
  Mailbox: 'Kotak surat',
  'Mailbox on {product}': 'Kotak surat di {product}',
  'Stays on {provider}': 'Tetap di {provider}',
  'Already has an account.': 'Sudah punya akun.',
  'Mail for it arrives once {provider} passes unknown addresses on. Nobody at {provider} may have this address.':
    'Email ke alamat ini baru masuk setelah {provider} meneruskan alamat yang tidak dikenalnya. Tidak boleh ada orang di {provider} yang memakai alamat ini.',
  'Mail to this address won’t arrive until the routing check in the email step passes. You can still invite them now.':
    'Email ke alamat ini belum akan masuk sampai pemeriksaan routing di langkah email berhasil. Anda tetap bisa mengundang mereka sekarang.',
  'Remove their {provider} licence if they have one, or it keeps their mail.': 'Hapus lisensi {provider} mereka jika ada, kalau tidak email mereka tetap tertahan di sana.',
  '+ Add another person': '+ Tambah orang lain',
  '{n} people: free. Up to 5 people never pay.': '{n} orang: gratis. Hingga 5 orang tidak pernah bayar.',
  '{n} people: free after the trial. Up to 5 people never pay.': '{n} orang: gratis setelah masa uji coba. Hingga 5 orang tidak pernah bayar.',
  '{n} people: more than Free covers, so pick a plan after you start: about {price} a month on {plan}, with your own AI keys. You choose before anything is charged.':
    '{n} orang: melebihi batas paket Gratis, jadi pilih paket setelah Anda mulai: sekitar {price} per bulan di paket {plan}, dengan key AI sendiri. Anda memilih sebelum ada tagihan.',
  '{n} people: after the 14-day trial, about {price} a month on {plan}, with your own AI keys. You choose before anything is charged.':
    '{n} orang: setelah uji coba 14 hari, sekitar {price} per bulan di paket {plan}, dengan key AI sendiri. Anda memilih sebelum ada tagihan.',
};

export default id;
