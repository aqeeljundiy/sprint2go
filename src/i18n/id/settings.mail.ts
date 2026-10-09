// Bahasa Indonesia: settings, part "mail". Owner: Builder 1 (foundation).
// Settings for email: EmailDelivery, EmailSetupGuide, PhoneMailApps, OutOfOffice.
// The key is the exact English text in the code; the value is how it reads in Indonesian. Tone, the glossary and
// the rules for placeholders and plurals: docs/i18n.md. Check with: node scripts/i18n-check.mjs
// Technical words stay as admins use them (DNS, MX, SPF, DKIM, DMARC, BIMI, IMAP, SMTP, TXT, CNAME, record, routing,
// host, port). Menu names in Google's, Microsoft's and Zoho's admin screens stay in English, in quotes or bold.
const id: Record<string, string> = {
  // Out of office (OutOfOffice.tsx)
  'Out of office': 'Di luar kantor',
  'An automatic answer while you’re away. Each person gets it once every 4 days; mailing lists, newsletters and other automatic mail don’t.':
    'Balasan otomatis selama Anda pergi. Setiap pengirim menerimanya sekali tiap 4 hari; milis, newsletter, dan email otomatis lain tidak.',
  'Can’t answer yet. {why}': 'Belum bisa membalas. {why}',
  'Out of office can’t answer yet. {why}': 'Balasan di luar kantor belum bisa dikirim. {why}',
  'Ended {date}. Switch it off, or pick new dates.': 'Berakhir {date}. Matikan, atau pilih tanggal baru.',
  'Starts {from}, until {until}': 'Mulai {from}, sampai {until}',
  'Starts {from}': 'Mulai {from}',
  'On until {until}. People who write get your answer.': 'Aktif sampai {until}. Orang yang mengirim email menerima balasan Anda.',
  'On. People who write get your answer.': 'Aktif. Orang yang mengirim email menerima balasan Anda.',
  'Thanks for your email. I’m away until {until} with little access to email, and I’ll reply when I’m back.':
    'Terima kasih atas email Anda. Saya sedang tidak di kantor sampai {until} dengan akses email terbatas, dan akan membalas setelah kembali.',
  'Thanks for your email. I’m away with little access to email, and I’ll reply when I’m back.':
    'Terima kasih atas email Anda. Saya sedang tidak di kantor dengan akses email terbatas, dan akan membalas setelah kembali.',
  'Automatic answer': 'Balasan otomatis',
  'First day away': 'Hari pertama',
  'Last day away': 'Hari terakhir',
  'From now': 'Mulai sekarang',
  'Until I switch it off': 'Sampai saya matikan',
  'The last day is before the first.': 'Hari terakhir lebih awal dari hari pertama.',
  Subject: 'Subjek',
  Message: 'Pesan',
  // The server's subject when this is empty is English ("Out of office: …"), so the example keeps it.
  'Out of office: their subject': 'Out of office: subjek mereka',
  'Undo changes': 'Batalkan perubahan',
  'Save changes': 'Simpan perubahan',
  'Turn on': 'Aktifkan',
  // The reason App.tsx gives when the server hasn't said why
  'Sending isn’t set up for this mailbox yet.': 'Pengiriman belum diatur untuk kotak surat ini.',

  // Phone mail apps (PhoneMailApps.tsx)
  'Phone mail apps': 'Aplikasi email ponsel',
  'Read and send your sprint2go mail in iPhone Mail, Gmail, Outlook or Thunderbird. This works with sprint2go on a server; this demo has none.':
    'Baca dan kirim email sprint2go Anda di iPhone Mail, Gmail, Outlook, atau Thunderbird. Ini berjalan dengan sprint2go di server; demo ini tidak punya server.',
  'Read and send your sprint2go mail in iPhone Mail, Gmail, Outlook or Thunderbird. Reading, moving and deleting there changes the same mail here.':
    'Baca dan kirim email sprint2go Anda di iPhone Mail, Gmail, Outlook, atau Thunderbird. Membaca, memindahkan, dan menghapus di sana juga mengubah email yang sama di sini.',
  'Copy the {what}': 'Salin {what}',
  'incoming server': 'server masuk',
  'outgoing server': 'server keluar',
  'user name': 'nama pengguna',
  'It couldn’t be made. Try again.': 'Tidak bisa dibuat. Coba lagi.',
  '“{name}” removed. Mail apps using it are signed out.': '“{name}” dihapus. Aplikasi email yang memakainya sudah dikeluarkan.',
  'It couldn’t be removed. Try again.': 'Tidak bisa dihapus. Coba lagi.',
  'Not available yet: other mail apps aren’t switched on for this sprint2go server.': 'Belum tersedia: aplikasi email lain belum diaktifkan untuk server sprint2go ini.',
  'Not available yet: it waits on a trusted certificate for {host}.': 'Belum tersedia: masih menunggu sertifikat tepercaya untuk {host}.',
  'Not available yet: it waits on a trusted certificate for {host}, which waits on the Cloudflare token.':
    'Belum tersedia: masih menunggu sertifikat tepercaya untuk {host}, yang menunggu token Cloudflare.',
  'Not available yet: the mail app ports couldn’t open on this server.': 'Belum tersedia: port aplikasi email tidak bisa dibuka di server ini.',
  'Made {day}, not used yet': 'Dibuat {day}, belum dipakai',
  'Made {day}, used {ago} to send': 'Dibuat {day}, dipakai untuk mengirim {ago}',
  'Made {day}, used {ago}': 'Dibuat {day}, dipakai {ago}',
  'Couldn’t check right now. Try again in a moment.': 'Belum bisa memeriksa sekarang. Coba lagi sebentar lagi.',
  '{names} switched other mail apps off, so their mailboxes don’t show in mail apps.':
    '{names} menonaktifkan aplikasi email lain, jadi kotak suratnya tidak muncul di aplikasi email.',
  'You can switch it back on at the bottom of this page.': 'Anda bisa mengaktifkannya lagi di bagian bawah halaman ini.',
  'You aren’t on any mailbox here yet, so there’s nothing to open in a mail app.': 'Anda belum terhubung ke kotak surat mana pun di sini, jadi belum ada yang bisa dibuka di aplikasi email.',
  'App passwords': 'Kata sandi aplikasi',
  'Each mail app signs in with its own app password. Your sprint2go password never works there, so two-step sign-in stays safe. Remove one and that app is signed out at once.':
    'Setiap aplikasi email masuk dengan kata sandi aplikasinya sendiri. Kata sandi sprint2go Anda tidak pernah bisa dipakai di sana, jadi masuk dua langkah tetap aman. Hapus salah satunya dan aplikasi itu langsung dikeluarkan.',
  'No app passwords yet.': 'Belum ada kata sandi aplikasi.',
  'Removing…': 'Menghapus…',
  'Your app password for “{name}”': 'Kata sandi aplikasi Anda untuk “{name}”',
  'Type it into your mail app as the password, with your email address as the user name. You won’t see it here again.':
    'Ketik di aplikasi email Anda sebagai kata sandi, dengan alamat email Anda sebagai nama pengguna. Kata sandi ini tidak akan ditampilkan lagi.',
  Name: 'Nama',
  'iPhone, Work laptop…': 'iPhone, Laptop kantor…',
  'Your sprint2go password': 'Kata sandi sprint2go Anda',
  'So nobody at an unlocked computer can add a way into your mail.': 'Supaya tidak ada orang di komputer yang tidak terkunci yang bisa membuka jalan masuk ke email Anda.',
  'Making it…': 'Membuat…',
  'Make app password': 'Buat kata sandi aplikasi',
  'New app password': 'Kata sandi aplikasi baru',
  'Set up your mail app': 'Atur aplikasi email Anda',
  'Mail app': 'Aplikasi email',
  // The phone's menus stay as the phone writes them in English; the sentence around them is Indonesian.
  'On the iPhone or iPad, open this page and download the setup profile: it fills in everything but the password.':
    'Di iPhone atau iPad, buka halaman ini dan unduh profil penyiapan: semuanya sudah terisi kecuali kata sandi.',
  'Setup profile for {email}': 'Profil penyiapan untuk {email}',
  'Open Settings, tap Profile Downloaded near the top, then Install. When it asks for a password, type an app password.':
    'Buka “Settings”, ketuk “Profile Downloaded” di dekat bagian atas, lalu “Install”. Saat diminta kata sandi, ketik kata sandi aplikasi.',
  'Or by hand: Settings, Apps, Mail, Mail Accounts, Add Account, Other, Add Mail Account. Choose IMAP and type the settings below for both servers.':
    'Atau secara manual: “Settings”, “Apps”, “Mail”, “Mail Accounts”, “Add Account”, “Other”, “Add Mail Account”. Pilih IMAP dan ketik pengaturan di bawah untuk kedua server.',
  'In the Gmail app, tap your picture, then Add another account, then Other.': 'Di aplikasi Gmail, ketuk foto Anda, lalu “Add another account”, lalu “Other”.',
  'Type your email address, tap Manual setup and choose Personal (IMAP).': 'Ketik alamat email Anda, ketuk “Manual setup”, dan pilih “Personal (IMAP)”.',
  'Type an app password, then the settings below for the incoming and outgoing servers, with SSL/TLS.':
    'Ketik kata sandi aplikasi, lalu pengaturan di bawah untuk server masuk dan keluar, dengan SSL/TLS.',
  'In Outlook, add an account and type your email address.': 'Di Outlook, tambahkan akun dan ketik alamat email Anda.',
  'When it asks which kind, choose IMAP, then open the advanced settings.': 'Saat ditanya jenisnya, pilih IMAP, lalu buka pengaturan lanjutan.',
  'Type the settings below and an app password for both servers.': 'Ketik pengaturan di bawah dan kata sandi aplikasi untuk kedua server.',
  'In Thunderbird, choose New, Existing Email Account.': 'Di Thunderbird, pilih “New”, “Existing Email Account”.',
  'Type your name, your email address and an app password. Thunderbird finds the rest by itself.':
    'Ketik nama, alamat email, dan kata sandi aplikasi Anda. Thunderbird menemukan sisanya sendiri.',
  'If it can’t, choose Configure manually and type the settings below.': 'Jika tidak bisa, pilih “Configure manually” dan ketik pengaturan di bawah.',
  'Incoming mail (IMAP)': 'Email masuk (IMAP)',
  'Port {port}, SSL/TLS (or {other} with STARTTLS)': 'Port {port}, SSL/TLS (atau {other} dengan STARTTLS)',
  'Outgoing mail (SMTP)': 'Email keluar (SMTP)',
  'Port {port}, SSL/TLS (or {other} with STARTTLS), sign-in on': 'Port {port}, SSL/TLS (atau {other} dengan STARTTLS), autentikasi aktif',
  'User name': 'Nama pengguna',
  Password: 'Kata sandi',
  'An app password from above, never your sprint2go password': 'Kata sandi aplikasi dari atas, jangan kata sandi sprint2go Anda',
  // The folder names are the ones the mail app shows (the server's, in English).
  '{email} shows at the top: Inbox, Sent, Drafts, Archive (your Done), Snoozed, Trash, Spam and your labels.':
    '{email} tampil paling atas: Inbox, Sent, Drafts, Archive (Selesai Anda), Snoozed, Trash, Spam, dan label Anda.',
  '{list} show as folders inside it.': '{list} tampil sebagai folder di dalamnya.',
  'Mail you send there goes out from sprint2go and shows in Sent here too.': 'Email yang Anda kirim dari sana dikirim lewat sprint2go dan juga muncul di Terkirim di sini.',
  'Shared inboxes follow who is on them in sprint2go: take someone off and it leaves their mail app.':
    'Kotak masuk bersama mengikuti siapa yang tergabung di sprint2go: keluarkan seseorang dan kotak masuk itu hilang dari aplikasi emailnya.',
  'Let people use other mail apps': 'Izinkan aplikasi email lain',
  'People at {company} can open their mailboxes here in iPhone Mail, Gmail, Outlook and Thunderbird, with app passwords.':
    'Orang di {company} bisa membuka kotak suratnya di iPhone Mail, Gmail, Outlook, dan Thunderbird, dengan kata sandi aplikasi.',
  'Off: nobody at {company} can open its mailboxes in other mail apps, and open connections ended.':
    'Nonaktif: tidak ada orang di {company} yang bisa membuka kotak suratnya di aplikasi email lain, dan koneksi yang terbuka sudah diputus.',
  // The server's messages on this page (server/mailApps.ts)
  'Let’s Encrypt hasn’t issued it yet.': 'Let’s Encrypt belum menerbitkannya.',
  'Too many attempts. Wait a few minutes and try again.': 'Terlalu banyak percobaan. Tunggu beberapa menit, lalu coba lagi.',
  'Give it a name, like “iPhone” or “Work laptop”.': 'Beri nama, misalnya “iPhone” atau “Laptop kantor”.',
  'That isn’t your sprint2go password.': 'Itu bukan kata sandi sprint2go Anda.',
  'You have 20 app passwords. Remove one you don’t use first.': 'Anda sudah punya 20 kata sandi aplikasi. Hapus dulu yang tidak dipakai.',
  'That app password is already gone.': 'Kata sandi aplikasi itu sudah tidak ada.',
  'There’s no mailbox here you can open in a mail app.': 'Tidak ada kotak surat di sini yang bisa Anda buka di aplikasi email.',

  // The setup guide (EmailSetupGuide.tsx): forwarding, moving, and "Some of each"
  'your mail provider': 'penyedia email Anda',
  'Nobody in Microsoft 365 may have it as a mailbox, group or mail contact, or Microsoft keeps the mail.':
    'Tidak boleh ada yang memakainya di Microsoft 365 sebagai kotak surat, grup, atau kontak email, kalau tidak Microsoft yang menyimpan emailnya.',
  'Nobody in Zoho Mail may have it as an account or alias, or Zoho keeps the mail.':
    'Tidak boleh ada yang memakainya di Zoho Mail sebagai akun atau alias, kalau tidak Zoho yang menyimpan emailnya.',
  'Your mail provider must not have a mailbox for it, or the provider keeps the mail.':
    'Penyedia email Anda tidak boleh punya kotak surat untuk alamat itu, kalau tidak penyedia yang menyimpan emailnya.',
  'No Google Workspace user, alias or group may have it, or Google keeps the mail. A suspended user, or one with Gmail turned off, is fine.':
    'Tidak boleh ada pengguna, alias, atau grup Google Workspace yang memakainya, kalau tidak Google yang menyimpan emailnya. Pengguna yang ditangguhkan, atau yang Gmail-nya dimatikan, tidak masalah.',
  'yourcompany.com': 'perusahaananda.com',
  'email::you': 'anda',
  'email::name': 'nama',
  'The check didn’t go through. Try again.': 'Pemeriksaan tidak berhasil. Coba lagi.',
  'Check that {domain} is set to Internal relay, that the connector is on, and that nobody in Microsoft 365 has the address. Changes can take up to an hour.':
    'Pastikan {domain} disetel ke “Internal relay”, konektornya aktif, dan tidak ada yang memakai alamat itu di Microsoft 365. Perubahan bisa butuh hingga satu jam.',
  'Check that the route is on (Status) with Split Delivery, and that nobody in Zoho Mail has the address.':
    'Pastikan rutenya aktif (“Status”) dengan “Split Delivery”, dan tidak ada yang memakai alamat itu di Zoho Mail.',
  'Ask your provider whether split delivery is on for {domain}.': 'Tanyakan ke penyedia Anda apakah split delivery sudah aktif untuk {domain}.',
  'Google can take up to an hour to start using a new rule. Check that no Google user has the address, and that the rule says “only on non-recognized addresses”.':
    'Google bisa butuh hingga satu jam untuk mulai memakai aturan baru. Pastikan tidak ada pengguna Google yang memakai alamat itu, dan aturannya berisi “only on non-recognized addresses”.',
  'Not found yet: {records}.': 'Belum ditemukan: {records}.',
  '{domain} has more than one SPF record; merge them into one.': '{domain} punya lebih dari satu record SPF; gabungkan menjadi satu.',
  'New records can take a few minutes to show.': 'Record baru bisa butuh beberapa menit untuk terlihat.',
  'There’s no {product} mailbox at {domain} yet. Add one first (step {step}), then send to it.':
    'Belum ada kotak surat {product} di {domain}. Tambahkan dulu (langkah {step}), lalu kirim email ke sana.',
  'Nothing has arrived for {addresses} or the others yet.': 'Belum ada email yang masuk untuk {addresses} atau alamat lainnya.',
  'Nothing has arrived for {addresses} yet.': 'Belum ada email yang masuk untuk {addresses}.',
  'Nothing has arrived yet. It can take a minute; try again.': 'Belum ada yang masuk. Bisa butuh semenit; coba lagi.',
  'The test couldn’t be sent. Try again.': 'Email uji tidak bisa dikirim. Coba lagi.',
  'Sent to {address}. Waiting for {provider} to pass it on…': 'Terkirim ke {address}. Menunggu {provider} meneruskannya…',
  'It didn’t arrive.': 'Email tidak sampai.',
  'The test couldn’t leave our server. Try again later.': 'Email uji tidak bisa keluar dari server kami. Coba lagi nanti.',
  'Sending to {address}…': 'Mengirim ke {address}…',
  'It hasn’t arrived yet.': 'Belum sampai.',
  'We keep watching for it; the result shows under Mail routing.': 'Kami terus memantaunya; hasilnya muncul di Routing email.',
  'Once your company is set up, check this in Settings, Email delivery.': 'Setelah perusahaan Anda siap, periksa ini di Pengaturan, Pengiriman email.',
  'Check again': 'Periksa lagi',
  'v=DKIM1; k=rsa; p=… (the exact value is in Settings, Email delivery)': 'v=DKIM1; k=rsa; p=… (nilai persisnya ada di Pengaturan, Pengiriman email)',
  'Signs mail sent from {product}': 'Menandatangani email yang dikirim dari {product}',
  'Protects your domain from spoofing': 'Melindungi domain Anda dari pemalsuan',
  'Add to your SPF record (keep what’s there)': 'Tambahkan ke record SPF Anda (pertahankan isinya)',
  'Priority 10. Replaces your current MX records': 'Prioritas 10. Menggantikan record MX Anda saat ini',
  'Replaces your SPF record': 'Menggantikan record SPF Anda',
  'In Outlook on the web: Settings, Mail, Forwarding. Turn forwarding on and paste the address.':
    'Di Outlook versi web: “Settings”, “Mail”, “Forwarding”. Aktifkan penerusan dan tempel alamatnya.',
  'In Zoho Mail: Settings, Mail forwarding and POP/IMAP, Add forwarding address.': 'Di Zoho Mail: “Settings”, “Mail forwarding and POP/IMAP”, “Add forwarding address”.',
  'In your mail provider’s settings, find Forwarding and add the address.': 'Di pengaturan penyedia email Anda, cari pengaturan penerusan (Forwarding) dan tambahkan alamatnya.',
  'In Gmail: Settings (gear), See all settings, Forwarding and POP/IMAP, Add a forwarding address.':
    'Di Gmail: “Settings” (ikon roda gigi), “See all settings”, “Forwarding and POP/IMAP”, “Add a forwarding address”.',
  'your usual mail app': 'aplikasi email yang biasa Anda pakai',
  'Lets {provider} and {product} send as {domain}. A domain has one SPF record: if {domain} already has one, change it to this and keep any other include: it lists.':
    'Mengizinkan {provider} dan {product} mengirim atas nama {domain}. Satu domain hanya punya satu record SPF: jika {domain} sudah punya, ubah menjadi ini dan pertahankan include: lain yang ada di dalamnya.',
  'Your mail provider most likely has an SPF record for {domain} already. Don’t add a second one: put {spf} into it, before the ~all or -all.':
    'Penyedia email Anda kemungkinan besar sudah punya record SPF untuk {domain}. Jangan tambahkan yang kedua: masukkan {spf} ke dalamnya, sebelum ~all atau -all.',
  'Tells receivers what to do with mail that fails the checks. If {domain} already has a DMARC record, keep yours.':
    'Memberi tahu penerima apa yang harus dilakukan dengan email yang gagal pemeriksaan. Jika {domain} sudah punya record DMARC, pertahankan yang lama.',
  'With {domain} set to Internal relay and one connector, Microsoft 365 passes mail for addresses it doesn’t know on to {product}.':
    'Dengan {domain} disetel ke “Internal relay” dan satu konektor, Microsoft 365 meneruskan email untuk alamat yang tidak dikenalnya ke {product}.',
  'Split delivery passes mail for addresses Zoho doesn’t know on to {product}.': 'Split delivery meneruskan email untuk alamat yang tidak dikenal Zoho ke {product}.',
  'If your provider offers split delivery, it passes mail for addresses it doesn’t host on to {product}.':
    'Jika penyedia Anda menyediakan split delivery, email untuk alamat yang tidak mereka host diteruskan ke {product}.',
  'One routing rule there passes mail for addresses Google doesn’t know on to {product}.': 'Satu aturan routing di sana meneruskan email untuk alamat yang tidak dikenal Google ke {product}.',
  'Turn on Microsoft’s own signature too.': 'Aktifkan juga tanda tangan milik Microsoft.',
  'In the Microsoft Defender portal (security.microsoft.com): {settings}, {dkim}, pick {domain}, add the two CNAME records it shows, then turn signing on. With DMARC on, mail from your Microsoft 365 people should be signed as well.':
    'Di Microsoft Defender portal (security.microsoft.com): {settings}, {dkim}, pilih {domain}, tambahkan dua record CNAME yang ditampilkan, lalu aktifkan penandatanganan. Dengan DMARC aktif, email dari orang-orang Anda di Microsoft 365 juga perlu ditandatangani.',
  'Turn on Zoho’s own signature too.': 'Aktifkan juga tanda tangan milik Zoho.',
  'In the Zoho Mail Admin Console: Domains, {domain}, {config}, {dkim}. Add the record it shows, then verify it. With DMARC on, mail from your Zoho people should be signed as well.':
    'Di Zoho Mail Admin Console: “Domains”, {domain}, {config}, {dkim}. Tambahkan record yang ditampilkan, lalu verifikasi. Dengan DMARC aktif, email dari orang-orang Anda di Zoho juga perlu ditandatangani.',
  'If your mail provider can sign mail with DKIM, turn that on too: with DMARC on, mail from the people who stay there should be signed as well.':
    'Jika penyedia email Anda bisa menandatangani email dengan DKIM, aktifkan juga: dengan DMARC aktif, email dari orang yang tetap di sana juga perlu ditandatangani.',
  'Turn on Google’s own signature too.': 'Aktifkan juga tanda tangan milik Google.',
  'In admin.google.com: Apps, Google Workspace, Gmail, {auth}. Generate a new record, add it with the others, then click {start}. With DMARC on, mail from your Google Workspace people should be signed as well.':
    'Di admin.google.com: “Apps”, “Google Workspace”, “Gmail”, {auth}. Buat record baru, tambahkan bersama record lainnya, lalu klik {start}. Dengan DMARC aktif, email dari orang-orang Anda di Google Workspace juga perlu ditandatangani.',
  '{domain}’s DNS is at {host}, so the records go there: {where}.': 'DNS {domain} ada di {host}, jadi record-nya ditambahkan di sana: {where}.',
  'Add them where {domain}’s DNS is managed: the company its nameservers belong to, usually where you bought the domain, and often not {provider}.':
    'Tambahkan di tempat DNS {domain} dikelola: perusahaan pemilik nameserver-nya, biasanya tempat Anda membeli domain, dan sering kali bukan {provider}.',
  '{domain} uses {nameservers}.': '{domain} memakai {nameservers}.',
  'How it works': 'Cara kerjanya',
  '{domain} stays with {provider}. People who keep a licence there carry on as today.': '{domain} tetap di {provider}. Orang yang tetap punya lisensi di sana bekerja seperti biasa.',
  'Everyone else gets a real {address} mailbox in {product}, and you stop paying {provider} for them.':
    'Yang lain mendapat kotak surat {address} sungguhan di {product}, dan Anda berhenti membayar {provider} untuk mereka.',
  'Mail always reaches {provider} first.': 'Email selalu sampai ke {provider} lebih dulu.',
  'If an address exists in neither, the sender gets the usual “doesn’t exist” reply.': 'Jika alamat tidak ada di keduanya, pengirim menerima balasan “alamat tidak ada” seperti biasa.',
  'One place per person.': 'Satu tempat untuk tiap orang.',
  'When someone moves to {product}, free up their address at {provider}.': 'Saat seseorang pindah ke {product}, lepaskan alamatnya di {provider}.',
  'You need admin access to {provider} and to {domain}’s DNS. It’s done once for the whole company.': 'Anda perlu akses admin ke {provider} dan ke DNS {domain}. Cukup sekali untuk seluruh perusahaan.',
  'Give people a mailbox here': 'Beri orang kotak surat di sini',
  'Each person who leaves {provider} gets a mailbox here with the same address.': 'Setiap orang yang keluar dari {provider} mendapat kotak surat di sini dengan alamat yang sama.',
  'In the next step, Team, pick {choice} for each of them.': 'Di langkah berikutnya, Tim, pilih {choice} untuk masing-masing.',
  'Later, add more in Settings, {general}, {accounts}.': 'Nanti, tambahkan lagi di Pengaturan, {general}, {accounts}.',
  'In {product}: Settings, {general}, {accounts}.': 'Di {product}: Pengaturan, {general}, {accounts}.',
  'Click {add}, choose {kind} and type {address}.': 'Klik {add}, pilih {kind}, lalu ketik {address}.',
  'For someone new, use {invite} instead, with {create} ticked.': 'Untuk orang baru, pakai {invite}, dengan {create} dicentang.',
  'The address must be free at {provider}.': 'Alamatnya harus kosong di {provider}.',
  'Add a mailbox': 'Tambah kotak surat',
  'Sending records': 'Record pengiriman',
  'So mail from {product} mailboxes isn’t marked as spam, add these records for {domain}. Once for the whole company.':
    'Agar email dari kotak surat {product} tidak ditandai spam, tambahkan record ini untuk {domain}. Cukup sekali untuk seluruh perusahaan.',
  'Zoho shows the exact include for your account under Domains, {domain}, Email configuration, SPF. In its EU or India data centre it’s include:zohomail.eu or include:zohomail.in.':
    'Zoho menampilkan include yang tepat untuk akun Anda di “Domains”, {domain}, “Email configuration”, “SPF”. Di pusat data EU atau India, nilainya include:zohomail.eu atau include:zohomail.in.',
  'Check the records': 'Periksa record',
  'Checking DNS…': 'Memeriksa DNS…',
  'All records found': 'Semua record ditemukan',
  'Check it works': 'Pastikan berfungsi',
  'Send a test and we mail an address at {domain} that only {product} knows. Or, from your phone or any address outside {domain}, send an email to an address at {domain} that only exists in {product}, like a mailbox from step {step}.':
    'Kirim email uji, lalu kami mengirimnya ke alamat di {domain} yang hanya dikenal {product}. Atau, dari ponsel Anda atau alamat apa pun di luar {domain}, kirim email ke alamat di {domain} yang hanya ada di {product}, seperti kotak surat dari langkah {step}.',
  'From your phone, or any address outside {domain}, send an email to an address at {domain} that only exists in {product}, like a mailbox from step {step}.':
    'Dari ponsel Anda, atau alamat apa pun di luar {domain}, kirim email ke alamat di {domain} yang hanya ada di {product}, seperti kotak surat dari langkah {step}.',
  'If it arrives here, {provider} passes mail on correctly.': 'Jika sampai di sini, {provider} sudah meneruskan email dengan benar.',
  'We send a test to {address}, an address only {product} has. If it arrives here, {provider} passes mail on correctly and you can give people {product} mailboxes.':
    'Kami mengirim email uji ke {address}, alamat yang hanya ada di {product}. Jika sampai di sini, {provider} sudah meneruskan email dengan benar dan Anda bisa memberi orang kotak surat {product}.',
  'It arrived: routing works': 'Sudah sampai: routing berfungsi',
  'Testing…': 'Menguji…',
  'Send another test': 'Kirim email uji lagi',
  'I sent it': 'Sudah saya kirim',
  'Send the test': 'Kirim email uji',
  'Looking for it…': 'Mencarinya…',
  'Waiting for it to pass through {provider}…': 'Menunggu email melewati {provider}…',
  'If it doesn’t take the name, use the address {ip}': 'Jika nama tidak diterima, pakai alamat {ip}',
  'Let unknown addresses through': 'Loloskan alamat tak dikenal',
  'Open the Exchange admin center, {site}: Mail flow, {domains}.': 'Buka Exchange admin center, {site}: “Mail flow”, {domains}.',
  'Click {domain}, set it to {relay} and click {save}.': 'Klik {domain}, setel ke {relay}, lalu klik {save}.',
  'Internal relay means mail for anyone Microsoft 365 knows is still delivered there, and the rest may go on to another server. The next step names that server.':
    '“Internal relay” berarti email untuk siapa pun yang dikenal Microsoft 365 tetap dikirim ke sana, dan sisanya boleh diteruskan ke server lain. Langkah berikutnya menentukan server itu.',
  'Add a connector': 'Tambahkan konektor',
  'Mail flow, {connectors}, {add}.': '“Mail flow”, {connectors}, {add}.',
  'Connection from {from}, connection to {to}. Next.': '“Connection from”: {from}, “Connection to”: {to}. Klik “Next”.',
  'Name: {name}, with {on} ticked. Next.': '“Name”: {name}, dengan {on} dicentang. Klik “Next”.',
  'Use of connector: {when}. Add {domain}, then Next.': '“Use of connector”: {when}. Tambahkan {domain}, lalu “Next”.',
  'Routing: {how}. Add {host}, then Next.': '“Routing”: {how}. Tambahkan {host}, lalu “Next”.',
  'Security restrictions: keep {tls} and pick {ca}. Tick {san} and add {host}. Next.':
    '“Security restrictions”: biarkan {tls} tetap dipilih dan pilih {ca}. Centang {san} dan tambahkan {host}. Klik “Next”.',
  'Security restrictions: keep {tls} and pick {any}. Our certificate is self-signed for now. Next.':
    '“Security restrictions”: biarkan {tls} tetap dipilih dan pilih {any}. Untuk sementara sertifikat kami masih self-signed. Klik “Next”.',
  'Validation email: an address at {domain} that only exists in {product}, like the mailbox from step 2. Click {validate}, and when it passes, {next} and {create}.':
    '“Validation email”: alamat di {domain} yang hanya ada di {product}, seperti kotak surat dari langkah 2. Klik {validate}, dan setelah lolos, {next} lalu {create}.',
  'Add the route': 'Tambahkan rute',
  'Open the {console}: Mail Settings, {routing}. Click {configure} (or {add}).': 'Buka {console}: “Mail Settings”, {routing}. Klik {configure} (atau {add}).',
  'Domain: {domain}.': 'Domain: {domain}.',
  'Destination Host: {host}': '“Destination Host”: {host}',
  'Verification Email Address: an address at {domain} that only exists in {product}, like the mailbox from step 2. Click {add}.':
    '“Verification Email Address”: alamat di {domain} yang hanya ada di {product}, seperti kotak surat dari langkah 2. Klik {add}.',
  'Zoho emails that address to confirm the route. It arrives in Mail here: open it and confirm.':
    'Zoho mengirim email ke alamat itu untuk mengonfirmasi rutenya. Email itu masuk ke Email di sini: buka dan konfirmasi.',
  'Turn on split delivery': 'Aktifkan split delivery',
  'In Email Routing, click the new route, then {basic}.': 'Di “Email Routing”, klik rute yang baru, lalu {basic}.',
  'Type of email distribution: {split}.': '“Type of email distribution”: {split}.',
  'Under {details}, slide {status} on.': 'Di bawah {details}, geser {status} ke aktif.',
  'Not Dual Delivery.': 'Bukan Dual Delivery.',
  'That one copies mail for people Zoho knows and bounces everyone else, so {product} mailboxes get nothing.':
    'Opsi itu menyalin email untuk orang yang dikenal Zoho dan menolak sisanya, jadi kotak surat {product} tidak menerima apa-apa.',
  'Ask your provider': 'Tanyakan ke penyedia Anda',
  'Ask your mail provider for {split} for {domain}: mail for addresses they don’t host goes on to another server instead of bouncing. Some call it routing for unknown recipients. Give them:':
    'Minta {split} untuk {domain} ke penyedia email Anda: email untuk alamat yang tidak mereka host diteruskan ke server lain, bukan ditolak. Ada yang menyebutnya routing untuk penerima tak dikenal. Berikan ini ke mereka:',
  'Server: {host}': 'Server: {host}',
  'Port {port}, with TLS. Our certificate is CA-signed, so they can require that.': 'Port {port}, dengan TLS. Sertifikat kami ditandatangani CA, jadi mereka boleh mewajibkannya.',
  'Port {port}, with TLS. Our certificate is self-signed for now, so they must not require a CA-signed one.':
    'Port {port}, dengan TLS. Untuk sementara sertifikat kami masih self-signed, jadi mereka tidak boleh mewajibkan sertifikat dari CA.',
  'Only for addresses they don’t host. Everyone who has a mailbox there keeps getting mail there.':
    'Hanya untuk alamat yang tidak mereka host. Semua yang punya kotak surat di sana tetap menerima email di sana.',
  '{many}, such as cPanel hosting, Hostinger email and Niagahoster. Then the clean way is {move} in Settings, Email delivery: all of {domain}’s mail comes here, and you can stop paying for the old mailboxes.':
    '{many}, misalnya hosting cPanel, email Hostinger, dan Niagahoster. Kalau begitu, cara yang paling rapi adalah {move} di Pengaturan, Pengiriman email: semua email {domain} masuk ke sini, dan Anda bisa berhenti membayar kotak surat lama.',
  'Many shared hosts can’t do this': 'Banyak shared hosting tidak bisa melakukan ini',
  'Move to {product}': 'Pindah ke {product}',
  'Add {product} as a host': 'Tambahkan {product} sebagai host',
  'Open {site}: Apps, Google Workspace, Gmail, {hosts}. Click {add}.': 'Buka {site}: “Apps”, “Google Workspace”, “Gmail”, {hosts}. Klik {add}.',
  'Name: {name}': '“Name”: {name}',
  'Specify email server: {single}, with {host} and port {port}.': '“Specify email server”: {single}, dengan {host} dan port {port}.',
  'Options: tick {tls}, {ca} and {hostname}. Leave {lookup} unticked.': '“Options”: centang {tls}, {ca}, dan {hostname}. Biarkan {lookup} tidak dicentang.',
  'Options: keep {tls} ticked. Untick {ca} and {hostname}. Leave {lookup} unticked.':
    '“Options”: biarkan {tls} tetap dicentang. Hapus centang {ca} dan {hostname}. Biarkan {lookup} tidak dicentang.',
  'Click {save}.': 'Klik {save}.',
  'Our certificate for {host} is signed by a trusted authority, so Google can check it on every delivery.':
    'Sertifikat kami untuk {host} ditandatangani otoritas tepercaya, jadi Google bisa memeriksanya di setiap pengiriman.',
  'Our certificate is self-signed for now. With either certificate box ticked, Google can’t deliver here and the mail bounces.':
    'Untuk sementara sertifikat kami masih self-signed. Jika salah satu kotak sertifikat dicentang, Google tidak bisa mengirim ke sini dan emailnya ditolak.',
  'Send unknown addresses there': 'Kirim alamat tak dikenal ke sana',
  'Back in the Gmail settings, open {routing} and click {configure} (or {another}).': 'Kembali ke pengaturan Gmail, buka {routing} dan klik {configure} (atau {another}).',
  'Specify envelope recipients to match: {all}.': '“Specify envelope recipients to match”: {all}.',
  'If the envelope recipient matches the above, do the following: keep {modify} and leave the header and subject boxes unticked. Under Route, tick {change} and pick {product}. Leave {spam} unticked, so only real mail comes through.':
    '“If the envelope recipient matches the above, do the following”: biarkan {modify} dan jangan centang kotak header dan subjek. Di bawah “Route”, centang {change} dan pilih {product}. Biarkan {spam} tidak dicentang, agar hanya email asli yang masuk.',
  'Options: {only}.': '“Options”: {only}.',
  'The last option is the one that matters.': 'Opsi terakhir itulah yang penting.',
  'Without it, every email for {domain} goes to {product}, including mail for your Google Workspace people.':
    'Tanpa opsi itu, semua email untuk {domain} masuk ke {product}, termasuk email untuk orang-orang Anda di Google Workspace.',
  'The rule usually works within an hour; Google says it can take up to 24.': 'Aturan ini biasanya berlaku dalam satu jam; menurut Google bisa sampai 24 jam.',
  'Your address': 'Alamat Anda',
  'Everyone gets a private {product} address that only receives forwarded mail. Yours:':
    'Setiap orang mendapat alamat {product} pribadi yang hanya menerima email terusan. Milik Anda:',
  'Forward a copy': 'Teruskan salinan',
  'Gmail sends a confirmation email to that address. It shows up in Mail here, with the code and a Copy button.':
    'Gmail mengirim email konfirmasi ke alamat itu. Email itu muncul di Email di sini, lengkap dengan kodenya dan tombol Salin.',
  'Look for Gmail’s email': 'Cari email dari Gmail',
  'It arrived: open Mail for the code': 'Sudah sampai: buka Email untuk melihat kodenya',
  'Gmail sends a confirmation code to that address. It arrives here, so you don’t have to go looking:':
    'Gmail mengirim kode konfirmasi ke alamat itu. Kodenya masuk ke sini, jadi Anda tidak perlu mencarinya:',
  'Show Gmail’s code': 'Tampilkan kode Gmail',
  'Waiting for Gmail…': 'Menunggu Gmail…',
  'Code: {code}': 'Kode: {code}',
  'Paste it in Gmail, then choose “Forward a copy of incoming mail” and “keep Gmail’s copy in the Inbox”.':
    'Tempel di Gmail, lalu pilih “Forward a copy of incoming mail” dan “keep Gmail’s copy in the Inbox”.',
  '{everyone} does this once in their own {app}, with their own address. Each person finds theirs here, in Settings, Email delivery.':
    '{everyone} melakukan ini sekali di {app} masing-masing, dengan alamatnya sendiri. Setiap orang menemukan alamatnya di sini, di Pengaturan, Pengiriman email.',
  'Everyone who keeps {provider}': 'Setiap orang yang tetap memakai {provider}',
  'Microsoft 365 blocks forwarding outside the company until an admin allows it: Microsoft Defender portal, Anti-spam policies, the outbound policy, Automatic forwarding rules: On.':
    'Microsoft 365 memblokir penerusan ke luar perusahaan sampai admin mengizinkannya: Microsoft Defender portal, “Anti-spam policies”, kebijakan outbound, “Automatic forwarding rules”: “On”.',
  'Admins:': 'Admin:',
  'one mail flow rule in the Exchange admin center copies everyone’s mail, so nobody has to do this step.':
    'satu aturan mail flow di Exchange admin center menyalin email semua orang, jadi tidak ada yang perlu melakukan langkah ini.',
  'one routing rule in the Google Admin console (“Also deliver to”) copies everyone’s mail, so nobody has to do this step.':
    'satu aturan routing di Google Admin console (“Also deliver to”) menyalin email semua orang, jadi tidak ada yang perlu melakukan langkah ini.',
  'most providers can copy everyone’s mail with one admin rule. Ask us.': 'kebanyakan penyedia bisa menyalin email semua orang dengan satu aturan admin. Tanyakan ke kami.',
  Replies: 'Balasan',
  'While a mailbox stays with {provider}, you read its mail here and reply from {app}. To send from {product} as {address}, move the mailbox over in Settings, Email delivery.':
    'Selama kotak surat tetap di {provider}, Anda membaca emailnya di sini dan membalas dari {app}. Untuk mengirim dari {product} sebagai {address}, pindahkan kotak suratnya di Pengaturan, Pengiriman email.',
  'Reply as yourself': 'Balas atas nama sendiri',
  'So replies leave as {address} and don’t land in spam, add two records where you manage {domain}. Once for the whole company.':
    'Agar balasan terkirim sebagai {address} dan tidak masuk spam, tambahkan dua record di tempat Anda mengelola {domain}. Cukup sekali untuk seluruh perusahaan.',
  'Both records found': 'Kedua record ditemukan',
  'Test it': 'Uji coba',
  'Send any email to {address} from your phone.': 'Kirim email apa saja ke {address} dari ponsel Anda.',
  'Watching for it…': 'Memantau…',
  'Arrived in {product}': 'Masuk ke {product}',
  'Add the records': 'Tambahkan record',
  'Where {domain}’s DNS is managed, usually where you bought it (Hostinger, Niagahoster, Cloudflare, GoDaddy…). Until the MX record changes, mail still goes to your current provider, so nothing is lost.':
    'Di tempat DNS {domain} dikelola, biasanya tempat Anda membelinya (Hostinger, Niagahoster, Cloudflare, GoDaddy…). Selama record MX belum berubah, email tetap masuk ke penyedia Anda saat ini, jadi tidak ada yang hilang.',
  'Check my records': 'Periksa record saya',
  'Bring old mail': 'Bawa email lama',
  'Bringing old mail over isn’t available yet. Your old mail stays in {provider}, so keep that account until you’ve saved what you need.':
    'Memindahkan email lama belum tersedia. Email lama Anda tetap di {provider}, jadi pertahankan akun itu sampai Anda menyimpan yang diperlukan.',
  'Sign in to {provider} once and we copy every folder in the background. People can work while it runs.':
    'Masuk ke {provider} sekali, lalu kami menyalin semua folder di latar belakang. Semua orang tetap bisa bekerja selama prosesnya berjalan.',
  'Importing {n} emails…': 'Mengimpor {n} email…',
  'Imported {n} emails': '{n} email diimpor',
  'Switch day': 'Hari peralihan',
  'When the MX record goes live, new mail arrives here, usually within an hour. For a day or two some mail may still reach the old inbox, so look there too until then.':
    'Begitu record MX aktif, email baru masuk ke sini, biasanya dalam satu jam. Selama satu atau dua hari, sebagian email mungkin masih masuk ke kotak masuk lama, jadi periksa juga di sana sampai saat itu.',
  'When the MX record goes live, new mail arrives here, usually within an hour. For a day or two some mail may still reach the old inbox; we keep pulling it in until the switch is complete.':
    'Begitu record MX aktif, email baru masuk ke sini, biasanya dalam satu jam. Selama satu atau dua hari, sebagian email mungkin masih masuk ke kotak masuk lama; kami terus menariknya ke sini sampai peralihan selesai.',
  'Cancel the old plan': 'Batalkan paket lama',
  'After 30 days with nothing arriving there, cancel {provider}.': 'Setelah 30 hari tanpa email yang masuk ke sana, batalkan {provider}.',
  'After 30 days with nothing arriving there, cancel {provider}. We remind you.': 'Setelah 30 hari tanpa email yang masuk ke sana, batalkan {provider}. Kami akan mengingatkan Anda.',
  'Step {n} of {total}': 'Langkah {n} dari {total}',
  // The server's messages in the guide (server/index.ts, server/routing.ts)
  'Only admins can send a routing test.': 'Hanya admin yang bisa mengirim email uji routing.',
  'That’s a lot of tests in an hour. Wait a little and try again.': 'Sudah banyak email uji dalam satu jam. Tunggu sebentar, lalu coba lagi.',
  'Could not send the test.': 'Email uji tidak bisa dikirim.',
  'No such test.': 'Email uji tidak ditemukan.',
  'Routing is checked only for “Some of each”.': 'Routing hanya diperiksa untuk “Campuran keduanya”.',
  'Add your company’s domain first.': 'Tambahkan domain perusahaan Anda dulu.',
  'This server can’t send mail yet, so it can’t send the test.': 'Server ini belum bisa mengirim email, jadi belum bisa mengirim email uji.',
  'No such company.': 'Perusahaan tidak ditemukan.',
  'A local sprint2go keeps mail on this computer, so the test never left. Set MAIL_RELAY_URL to try it.':
    'sprint2go lokal menyimpan email di komputer ini, jadi email uji tidak pernah keluar. Atur MAIL_RELAY_URL untuk mencobanya.',
  'Only admins can check the records.': 'Hanya admin yang bisa memeriksa record.',
  'Not in this company.': 'Anda tidak ada di perusahaan ini.',

  // Email delivery (admin/EmailDelivery.tsx)
  'its MX record points here': 'record MX-nya yang mengarah ke sini',
  'its signing record': 'record tanda tangannya',
  'its sprint2go-verify record': 'record sprint2go-verify-nya',
  'Keep Gmail or Outlook': 'Tetap pakai Gmail atau Outlook',
  'Mail stays where it is. A forwarded copy shows here to read, and replies go out from Gmail or Outlook.':
    'Email tetap di tempatnya. Salinan terusan muncul di sini untuk dibaca, dan balasan dikirim dari Gmail atau Outlook.',
  'Some of each': 'Campuran keduanya',
  'Google, Microsoft or Zoho keeps the domain and passes the addresses it doesn’t know to {product}.':
    'Google, Microsoft, atau Zoho tetap memegang domain dan meneruskan alamat yang tidak dikenalnya ke {product}.',
  'The domain’s mail comes here. Cancel the other licences.': 'Email domain masuk ke sini. Batalkan lisensi yang lain.',
  'No email here': 'Tanpa email di sini',
  'Mail stays off. Chat, Tasks, Calendar and the rest keep working.': 'Email tetap nonaktif. Chat, Tugas, Kalender, dan lainnya tetap berjalan.',
  'Another provider': 'Penyedia lain',
  'Proof the domain is yours (TXT)': 'Bukti domain milik Anda (TXT)',
  'Where mail arrives (MX)': 'Tempat email masuk (MX)',
  'Who may send (SPF)': 'Yang boleh mengirim (SPF)',
  'Signature (DKIM)': 'Tanda tangan (DKIM)',
  'Policy (DMARC)': 'Kebijakan (DMARC)',
  'Reverse DNS of the server': 'Reverse DNS server',
  'The server’s address record': 'Record alamat server',
  'Outgoing port 25': 'Port keluar 25',
  'Incoming mail port': 'Port email masuk',
  'Could not load.': 'Tidak bisa dimuat.',
  'No connection.': 'Tidak ada koneksi.',
  'All records are in place.': 'Semua record sudah terpasang.',
  'Some records are still missing.': 'Beberapa record masih belum ada.',
  'Boosted sending is on. Add the three signing records.': 'Pengiriman Boosted aktif. Tambahkan tiga record tanda tangannya.',
  'Mail goes out from the sprint2go server.': 'Email dikirim dari server sprint2go.',
  'Invoice {number} for {total} is in Plan & billing. The {n} emails are added when it’s paid.':
    'Invoice {number} sebesar {total} ada di Paket & tagihan. {n} email ditambahkan setelah dibayar.',
  'Two decisions you can change any time: where your domain’s mail lives, and how mail from {product} goes out. Nothing switches until the records are really there.':
    'Dua keputusan yang bisa Anda ubah kapan saja: di mana email domain Anda berada, dan bagaimana email dari {product} dikirim. Tidak ada yang beralih sampai record-nya benar-benar ada.',
  'Where your mail lives': 'Tempat email Anda berada',
  'Which provider': 'Penyedia mana',
  '{provider} keeps the domain and its MX records. In its admin settings, mail for addresses it doesn’t know is routed on to {host}. People on {product} mail can write to colleagues on {other} as usual.':
    '{provider} tetap memegang domain dan record MX-nya. Di pengaturan admin-nya, email untuk alamat yang tidak dikenal diteruskan ke {host}. Orang yang memakai email {product} tetap bisa mengirim email ke rekan di {other} seperti biasa.',
  'Your mail provider': 'Penyedia email Anda',
  'When the MX record below points here, new mail for {domain} arrives in {product}. Old mail stays where it is for now: bringing it over isn’t available yet.':
    'Begitu record MX di bawah mengarah ke sini, email baru untuk {domain} masuk ke {product}. Email lama tetap di tempatnya untuk saat ini: memindahkannya belum tersedia.',
  'Hide the steps': 'Sembunyikan langkah',
  'Show the routing steps': 'Tampilkan langkah routing',
  'Show the forwarding steps': 'Tampilkan langkah penerusan',
  'How your mail goes out': 'Cara email Anda dikirim',
  'Mail goes out from the {product} mail server, signed with your domain’s own key.': 'Email dikirim dari server email {product}, ditandatangani dengan kunci domain Anda sendiri.',
  'Boosted sending isn’t available on this server, so it isn’t used.': 'Pengiriman Boosted tidak tersedia di server ini, jadi tidak dipakai.',
  '{product} mail server': 'Server email {product}',
  Included: 'Termasuk',
  'Free, no limits': 'Gratis, tanpa batas',
  'Your own server, your own reputation': 'Server sendiri, reputasi sendiri',
  'A brand-new domain can land in spam at Gmail and Outlook for the first weeks': 'Domain yang benar-benar baru bisa masuk spam di Gmail dan Outlook di minggu-minggu pertama',
  'Needs SPF, DKIM and DMARC records on your domain': 'Perlu record SPF, DKIM, dan DMARC di domain Anda',
  'Boosted sending': 'Pengiriman Boosted',
  Credits: 'Kredit',
  'Coming soon': 'Segera hadir',
  'Proven delivery to Gmail and Outlook from day one': 'Terbukti sampai ke Gmail dan Outlook sejak hari pertama',
  'Bounces and complaints handled for you': 'Bounce dan komplain kami yang tangani',
  'Paid per email: {packs}': 'Bayar per email: {packs}',
  '{n} for {price}': '{n} seharga {price}',
  'Three extra signing records on your domain': 'Tiga record tanda tangan tambahan di domain Anda',
  '{n} emails left. Mail goes out from our server until you top up.': 'Sisa {n} email. Email dikirim dari server kami sampai Anda menambah kredit.',
  '{n} email left.': 'Sisa {n} email.',
  '{n} emails left.': 'Sisa {n} email.',
  'Waiting for payment: {orders}. They’re added when it’s paid.': 'Menunggu pembayaran: {orders}. Kredit ditambahkan setelah dibayar.',
  '{n} emails (invoice {number}, {total}, due {date})': '{n} email (invoice {number}, {total}, jatuh tempo {date})',
  'An invoice for {price} plus PPN, paid by bank transfer to {bank}. The emails arrive when it’s paid.':
    'Invoice sebesar {price} ditambah PPN, dibayar lewat transfer bank ke {bank}. Kredit email masuk setelah dibayar.',
  'An invoice for {price} plus PPN, paid by bank transfer. The emails arrive when it’s paid.':
    'Invoice sebesar {price} ditambah PPN, dibayar lewat transfer bank. Kredit email masuk setelah dibayar.',
  'Not now': 'Nanti saja',
  'Ordering…': 'Memesan…',
  'Order {n}': 'Pesan {n}',
  'Records for {domain}': 'Record untuk {domain}',
  'your domain': 'domain Anda',
  'Your addresses live at {host}, so there is nothing to add: mail to them arrives here as it is. To use your own domain, add it under General.':
    'Alamat Anda ada di {host}, jadi tidak ada yang perlu ditambahkan: email ke alamat itu langsung masuk ke sini. Untuk memakai domain sendiri, tambahkan di bagian Umum.',
  'Another company uses {domain}.': 'Perusahaan lain memakai {domain}.',
  'Its mail can’t arrive here or go out from {product} for you until you prove the domain is yours with the record below.':
    'Emailnya tidak bisa masuk ke sini atau dikirim dari {product} untuk Anda sampai Anda membuktikan domain itu milik Anda dengan record di bawah.',
  '{domain}’s DNS is at {host}, so add these there: {where}.': 'DNS {domain} ada di {host}, jadi tambahkan record ini di sana: {where}.',
  'Add these where {domain}’s DNS is managed: the company its nameservers belong to, usually where you bought the domain, and often not {provider}.':
    'Tambahkan record ini di tempat DNS {domain} dikelola: perusahaan pemilik nameserver-nya, biasanya tempat Anda membeli domain, dan sering kali bukan {provider}.',
  'Add these where {domain}’s DNS is managed: the company its nameservers belong to, usually where you bought the domain.':
    'Tambahkan record ini di tempat DNS {domain} dikelola: perusahaan pemilik nameserver-nya, biasanya tempat Anda membeli domain.',
  'Changes can take up to an hour to show.': 'Perubahan bisa butuh hingga satu jam untuk terlihat.',
  'Found: {found}': 'Ditemukan: {found}',
  'Everything is in place.': 'Semuanya sudah terpasang.',
  '{missing} of {total} still missing.': '{missing} dari {total} masih belum ada.',
  'Checked {ago}.': 'Diperiksa {ago}.',
  '{domain} is verified as yours by {how}.': '{domain} terverifikasi sebagai milik Anda lewat {how}.',
  '{domain} is verified as yours.': '{domain} terverifikasi sebagai milik Anda.',
  '{domain} isn’t verified as yours yet. That happens by itself once the MX record points here, or add this TXT record at {at}:':
    '{domain} belum terverifikasi sebagai milik Anda. Verifikasi berjalan sendiri begitu record MX mengarah ke sini, atau tambahkan record TXT ini di {at}:',
  '{domain} isn’t verified as yours yet. That happens by itself once the DKIM record is in place, or add this TXT record at {at}:':
    '{domain} belum terverifikasi sebagai milik Anda. Verifikasi berjalan sendiri begitu record DKIM terpasang, atau tambahkan record TXT ini di {at}:',
  '{domain} isn’t verified as yours yet. That happens by itself once a record proves it, or add this TXT record at {at}:':
    '{domain} belum terverifikasi sebagai milik Anda. Verifikasi berjalan sendiri begitu ada record yang membuktikannya, atau tambahkan record TXT ini di {at}:',
  'Your mailboxes': 'Kotak surat Anda',
  'Checked again.': 'Sudah diperiksa lagi.',
  '{used} of {n} hosted mailboxes in use: one comes with the plan for each person, and shared inboxes are free.':
    '{used} dari {n} kotak surat ter-hosting terpakai: setiap orang mendapat satu dari paket, dan kotak masuk bersama gratis.',
  '{used} of {n} hosted mailboxes in use: on Free, each hosted mailbox is an add-on.':
    '{used} dari {n} kotak surat ter-hosting terpakai: di paket Gratis, setiap kotak surat ter-hosting adalah add-on.',
  '{n} of them receive mail but can’t send until there’s room.': '{n} di antaranya menerima email tetapi belum bisa mengirim sampai ada slot.',
  'For more, an owner adds mailboxes in Settings, Plan & billing, Add-ons.': 'Untuk menambah, pemilik bisa menambah kotak surat di Pengaturan, Paket & tagihan, Add-on.',
  'No mailboxes yet. Add one for each person, and shared inboxes like hello@ for the team.':
    'Belum ada kotak surat. Tambahkan satu untuk tiap orang, dan kotak masuk bersama seperti hello@ untuk tim.',
  'Shared inbox': 'Kotak masuk bersama',
  'Not checked yet': 'Belum diperiksa',
  'Copies arrive here': 'Salinan masuk ke sini',
  'No copies yet': 'Belum ada salinan',
  Receives: 'Menerima',
  'Doesn’t receive yet': 'Belum menerima',
  sends: 'mengirim',
  'doesn’t send yet': 'belum mengirim',
  'Also gets mail for {addresses}': 'Juga menerima email untuk {addresses}',
  'Remove {address}': 'Hapus {address}',
  'Mail unlocks for everyone as soon as a mailbox works.': 'Email terbuka untuk semua orang begitu ada satu kotak surat yang berfungsi.',
  'Other addresses': 'Alamat lain',
  'Add your domain under General first': 'Tambahkan domain Anda di Umum dulu',
  'Add your domain under General first: addresses live at your own domain.': 'Tambahkan domain Anda di Umum dulu: alamat ada di domain Anda sendiri.',
  'Add an address': 'Tambah alamat',
  'Addresses like sales@ or info@ that deliver into mailboxes here: into a shared inbox, or a copy to each of several people.':
    'Alamat seperti sales@ atau info@ yang meneruskan email ke kotak surat di sini: ke kotak masuk bersama, atau salinan ke beberapa orang sekaligus.',
  'A copy to each of {mailboxes}': 'Salinan untuk masing-masing: {mailboxes}',
  'Into {mailbox}': 'Masuk ke {mailbox}',
  'a removed mailbox': 'kotak surat yang sudah dihapus',
  'Change {address}': 'Ubah {address}',
  '{address} removed. Mail to it is refused from now on.': '{address} dihapus. Email ke alamat itu ditolak mulai sekarang.',
  '{address} added. Send it a test to see it arrive.': '{address} ditambahkan. Kirim email uji untuk melihatnya masuk.',
  '{address} saved': '{address} disimpan',
  'The {product} server': 'Server {product}',
  'These are ours to fix, not yours; they decide whether Gmail and Outlook accept mail from here.':
    'Ini urusan kami, bukan Anda; hal-hal ini menentukan apakah Gmail dan Outlook menerima email dari sini.',
  'Found: {found}. Wanted: {want}.': 'Ditemukan: {found}. Seharusnya: {want}.',
  'Mail server certificate': 'Sertifikat server email',
  '{issuer}, valid until {date}.': '{issuer}, berlaku sampai {date}.',
  'A trusted authority': 'Otoritas tepercaya',
  'Self-signed until Let’s Encrypt issues one: {error}': 'Self-signed sampai Let’s Encrypt menerbitkan sertifikat: {error}',
  'Self-signed until Let’s Encrypt issues one.': 'Self-signed sampai Let’s Encrypt menerbitkan sertifikat.',
  'Self-signed: {error}': 'Self-signed: {error}',
  'Self-signed: providers that require a CA-signed certificate refuse it. Set CF_DNS_TOKEN or MAIL_TLS_CERT on the server.':
    'Self-signed: penyedia yang mewajibkan sertifikat dari CA akan menolaknya. Atur CF_DNS_TOKEN atau MAIL_TLS_CERT di server.',
  'Only operators see this.': 'Hanya operator yang melihat ini.',
  'This month': 'Bulan ini',
  '{received} received ({spam} to spam)': '{received} diterima ({spam} ke spam)',
  '{received} received': '{received} diterima',
  '{sent} sent ({boosted} boosted)': '{sent} terkirim ({boosted} lewat Boosted)',
  '{sent} sent': '{sent} terkirim',
  '{n} could not be delivered': '{n} gagal terkirim',
  '{n} on the way': '{n} sedang dikirim',
  // Logo in inboxes (BimiBlock)
  'Logo saved. Add the record below to publish it.': 'Logo tersimpan. Tambahkan record di bawah untuk memublikasikannya.',
  'Logo removed. Remove the default._bimi record too.': 'Logo dihapus. Hapus juga record default._bimi.',
  'The logo': 'Logo',
  '{name}, checked {ago}.': '{name}, diperiksa {ago}.',
  'None yet. Upload an SVG Tiny PS file: square, with a title, no scripts or links to other files.':
    'Belum ada. Unggah file SVG Tiny PS: persegi, dengan judul, tanpa skrip atau link ke file lain.',
  'Its address': 'Alamatnya',
  '{url}: inboxes only read logos over https, so this works once it’s on the live server.':
    '{url}: kotak masuk hanya membaca logo lewat https, jadi ini berfungsi setelah ada di server live.',
  'The record': 'Record',
  'default._bimi.{domain} points at this logo.': 'default._bimi.{domain} mengarah ke logo ini.',
  'default._bimi.{domain} has a different record: {found}': 'default._bimi.{domain} punya record lain: {found}',
  'Not in DNS yet.': 'Belum ada di DNS.',
  'DMARC policy': 'Kebijakan DMARC',
  'p={policy}, as BIMI needs.': 'p={policy}, sesuai kebutuhan BIMI.',
  'BIMI needs p=quarantine or p=reject for all mail; {domain} has p={policy}.': 'BIMI butuh p=quarantine atau p=reject untuk semua email; {domain} memakai p={policy}.',
  'BIMI needs a DMARC record with p=quarantine or p=reject; {domain} has none.': 'BIMI butuh record DMARC dengan p=quarantine atau p=reject; {domain} belum punya.',
  'Logo in inboxes (BIMI)': 'Logo di kotak masuk (BIMI)',
  Replace: 'Ganti',
  'Upload a logo': 'Unggah logo',
  'Optional. Some inboxes show your logo next to mail from {domain}. Gmail also needs a VMC or CMC certificate for it: those need 12 months of the logo in use, or a registered trademark. Until you have one, the logo doesn’t show in Gmail.':
    'Opsional. Sebagian kotak masuk menampilkan logo Anda di samping email dari {domain}. Gmail juga butuh sertifikat VMC atau CMC: syaratnya logo sudah dipakai 12 bulan, atau merek dagang terdaftar. Selama belum punya sertifikat itu, logo tidak tampil di Gmail.',
  'This logo can’t be used yet:': 'Logo ini belum bisa dipakai:',
  'Your logo': 'Logo Anda',
  'No logo yet': 'Belum ada logo',
  'Points inboxes at your logo. The empty a= is where a VMC or CMC certificate goes once you have one.':
    'Mengarahkan kotak masuk ke logo Anda. Bagian a= yang kosong adalah tempat sertifikat VMC atau CMC setelah Anda memilikinya.',
  'Ready for inboxes that show logos without a certificate. Not in Gmail: it needs the VMC or CMC certificate.':
    'Siap untuk kotak masuk yang menampilkan logo tanpa sertifikat. Belum di Gmail: Gmail butuh sertifikat VMC atau CMC.',
  'Not showing anywhere yet.': 'Belum tampil di mana pun.',

  // The server's messages on Email delivery (server/index.ts, mailer.ts, billing.ts, bimi.ts), shown with t()
  'Only admins can change how mail is sent.': 'Hanya admin yang bisa mengubah cara email dikirim.',
  'Unknown route.': 'Rute tidak dikenal.',
  'Boosted sending isn’t available on this server yet.': 'Pengiriman Boosted belum tersedia di server ini.',
  'Only admins can buy credits.': 'Hanya admin yang bisa membeli kredit.',
  'That’s a lot of orders in an hour. Pay the invoices that are waiting first.': 'Sudah banyak pesanan dalam satu jam. Bayar dulu invoice yang masih menunggu.',
  'Pick one of the packs.': 'Pilih salah satu paket.',
  'There are already 3 credit invoices waiting for payment. Pay one (Settings, Plan & billing, Invoices), or ask us to cancel one, first.':
    'Sudah ada 3 invoice kredit yang menunggu pembayaran. Bayar salah satunya dulu (Pengaturan, Paket & tagihan, Invoice), atau minta kami membatalkan salah satunya.',
  'Boosted sending isn’t available on this server, so there are no credits to buy.': 'Pengiriman Boosted tidak tersedia di server ini, jadi tidak ada kredit yang bisa dibeli.',
  'Credits are paid by bank transfer, and our bank details aren’t set up yet. Write to support to buy credits.':
    'Kredit dibayar lewat transfer bank, dan detail rekening kami belum diatur. Hubungi tim dukungan untuk membeli kredit.',
  'Only admins can change addresses.': 'Hanya admin yang bisa mengubah alamat.',
  'Email is off for this company.': 'Email nonaktif untuk perusahaan ini.',
  'Not your mailbox.': 'Bukan kotak surat Anda.',
  'Write the message people get back.': 'Tulis pesan yang akan diterima orang.',
  // Readiness: why a mailbox doesn't receive or send yet (server/mailer.ts)
  'There are no mailboxes yet.': 'Belum ada kotak surat.',
  'Boosted sending isn’t available yet.': 'Pengiriman Boosted belum tersedia.',
  'Amazon hasn’t verified the signing records yet.': 'Amazon belum memverifikasi record tanda tangannya.',
  'Outgoing mail is blocked on the server.': 'Email keluar diblokir di server.',
  // The records' notes and placeholders (server/mailer.ts expectedRecords)
  'Priority 10. Mail for the domain comes here.': 'Prioritas 10. Email untuk domain ini masuk ke sini.',
  'Who may send as your domain. Merge with an SPF record you already have.': 'Siapa yang boleh mengirim atas nama domain Anda. Gabungkan dengan record SPF yang sudah ada.',
  'Signs mail sent through Boosted sending.': 'Menandatangani email yang dikirim lewat Pengiriman Boosted.',
  'Signs mail sent from sprint2go so Gmail and Outlook trust it.': 'Menandatangani email yang dikirim dari sprint2go agar dipercaya Gmail dan Outlook.',
  '(stays with your provider)': '(tetap di penyedia Anda)',
  '(3 records)': '(3 record)',
  'given once Amazon knows the domain': 'diberikan setelah Amazon mengenali domainnya',
  // What the record and server checks found (server/mailer.ts checkDomain, serverHealth)
  none: 'tidak ada',
  'a DKIM record': 'sebuah record DKIM',
  'a DKIM record with a different key': 'sebuah record DKIM dengan kunci lain',
  'a different sprint2go-verify record': 'record sprint2go-verify yang lain',
  'Amazon has no identity for this domain yet': 'Amazon belum punya identitas untuk domain ini',
  'your provider': 'penyedia Anda',
  '3 CNAME records': '3 record CNAME',
  open: 'terbuka',
  'blocked or no answer': 'diblokir atau tidak ada jawaban',
  'not listening': 'tidak menerima koneksi',
  'an A record': 'sebuah record A',
  // BIMI (server/index.ts, server/bimi.ts)
  'Only admins can change the company’s logo in inboxes.': 'Hanya admin yang bisa mengubah logo perusahaan di kotak masuk.',
  'A logo in inboxes needs your own mail domain. Add it under General first.': 'Logo di kotak masuk butuh domain email sendiri. Tambahkan dulu di bagian Umum.',
  'This logo can’t be used for BIMI yet.': 'Logo ini belum bisa dipakai untuk BIMI.',
  'It has a DOCTYPE or ENTITY declaration, which BIMI logos can’t have.': 'Ada deklarasi DOCTYPE atau ENTITY, yang tidak boleh ada di logo BIMI.',
  'Its <svg> element needs version="1.2" (SVG Tiny 1.2).': 'Elemen <svg>-nya perlu version="1.2" (SVG Tiny 1.2).',
  'Its <svg> element needs baseProfile="tiny-ps" (the SVG profile BIMI uses).': 'Elemen <svg>-nya perlu baseProfile="tiny-ps" (profil SVG yang dipakai BIMI).',
  'Its <svg> element can’t have x or y.': 'Elemen <svg>-nya tidak boleh punya x atau y.',
  'It needs a <title> with the company’s name.': 'Perlu <title> yang berisi nama perusahaan.',
  'It has no viewBox (or width and height), so it can’t be checked for being square.': 'Tidak ada viewBox (atau width dan height), jadi tidak bisa dicek apakah persegi.',
  'It has a script, which BIMI logos can’t have.': 'Ada skrip, yang tidak boleh ada di logo BIMI.',
  'It has event handlers (onclick and the like), which BIMI logos can’t have.': 'Ada event handler (onclick dan sejenisnya), yang tidak boleh ada di logo BIMI.',
  'It has a javascript: address, which BIMI logos can’t have.': 'Ada alamat javascript:, yang tidak boleh ada di logo BIMI.',
  'It embeds other content (foreignObject), which BIMI logos can’t have.': 'Ada konten lain yang disematkan (foreignObject), yang tidak boleh ada di logo BIMI.',
  'It has an embedded picture (<image>). BIMI logos must be drawn shapes only.': 'Ada gambar yang disematkan (<image>). Logo BIMI hanya boleh berisi bentuk yang digambar.',
  'It’s animated. BIMI logos must be still.': 'Logonya beranimasi. Logo BIMI harus diam.',
  'It points at something outside the file (a link, font or picture). Everything has to be inside the SVG.':
    'Ada yang mengarah ke luar file (link, font, atau gambar). Semuanya harus ada di dalam SVG.',
};

export default id;
