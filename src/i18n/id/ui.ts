// Bahasa Indonesia: ui. Owner: Builder 1 (foundation).
// Shared pieces in src/components/ui: EmptyState, Select, pickers, DatePicker and TimePicker, Sheet, ActionSheet, PushScreen, SwipeRow, and the words in src/i18n/format.ts.
// The key is the exact English text in the code; the value is how it reads in Indonesian. Tone, the glossary and
// the rules for placeholders and plurals: docs/i18n.md. Check with: node scripts/i18n-check.mjs
const id: Record<string, string> = {
  'just now': 'baru saja',
  '{n} min ago': '{n} menit lalu',
  '{n} hours ago': '{n} jam lalu',
  '{n} days ago': '{n} hari lalu',

  // DatePicker: the field, quick picks, month grid and public holidays
  Date: 'Tanggal',
  'Next {weekday}': '{weekday} depan',
  'In 2 weeks': '2 minggu lagi',
  'Previous month': 'Bulan sebelumnya',
  'Next month': 'Bulan berikutnya',
  '{holiday}, a public holiday': '{holiday}, hari libur nasional',
  '{day}, {holiday}, public holiday': '{day}, {holiday}, hari libur nasional',
  '{holiday} is a public holiday': '{holiday} adalah hari libur nasional',

  // TimePicker
  Time: 'Waktu',
  'Type a time, like 9:30': 'Ketik waktu, mis. 9.30',
  'Type the {label}': 'Ketik {label}',
  'Not a time': 'Waktu tidak valid',

  // Select and MultiSelect
  'Choose…': 'Pilih…',
  'Search…': 'Cari…',
  'No matches': 'Tidak ada yang cocok',
  Name: 'Nama',
  None: 'Tidak ada',
  '{first} and {n} more': '{first} dan {n} lainnya',

  // PeopleList, PeoplePicker, PersonSelect
  '{name} (me)': '{name} (saya)',
  'Search by name, email, title or team': 'Cari nama, email, jabatan, atau tim',
  'Search people': 'Cari orang',
  'Nobody matches “{query}”': 'Tidak ada yang cocok dengan “{query}”',
  'Nobody yet': 'Belum ada orang',
  '{n} people': '{n} orang',
  'Choose someone…': 'Pilih orang…',

  // PushScreen
  'Back to {screen}': 'Kembali ke {screen}',

  // TabBar: arranging tabs
  'Arrange tabs': 'Atur tab',
  'Drag tabs to move them, or use the arrows. Hidden tabs stay one click away here.': 'Seret tab untuk memindahkannya, atau pakai tombol panah. Tab yang disembunyikan tetap bisa dibuka dari sini.',
  'Drag tabs to move them, or use the arrows. The order is the same for everyone.': 'Seret tab untuk memindahkannya, atau pakai tombol panah. Urutannya sama untuk semua orang.',
  'Move up': 'Naikkan',
  'Move down': 'Turunkan',
  'Show {tab}': 'Tampilkan {tab}',
  'Hide {tab}': 'Sembunyikan {tab}',
  'Always shown': 'Selalu ditampilkan',
  Show: 'Tampilkan',
  Hide: 'Sembunyikan',
  'Use the company’s order': 'Pakai urutan perusahaan',
  'Back to the usual order': 'Kembali ke urutan biasa',
  'Make this everyone’s order': 'Jadikan urutan semua orang',

  // Time zones (zones.ts): region headings; city names stay as they are
  Suggested: 'Disarankan',
  Other: 'Lainnya',
  Africa: 'Afrika',
  America: 'Amerika',
  Antarctica: 'Antarktika',
  Arctic: 'Arktik',
  Asia: 'Asia',
  Atlantic: 'Atlantik',
  Australia: 'Australia',
  Europe: 'Eropa',
  Indian: 'Samudra Hindia',
  Pacific: 'Pasifik',
};

export default id;
