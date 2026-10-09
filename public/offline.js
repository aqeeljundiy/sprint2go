// The offline page (offline.html): try again on a tap, and by itself as soon as the connection is back.
const again = () => location.reload();
document.getElementById('retry').addEventListener('click', again);
addEventListener('online', again);

// In the language this device last used (the app and the landing page keep it in s2g-lang), else the browser's.
let lang = 'en';
try {
  lang = localStorage.getItem('s2g-lang') || '';
} catch {
  /* storage blocked */
}
if (lang !== 'en' && lang !== 'id') lang = /^(id|in)\b/i.test(navigator.language || '') ? 'id' : 'en';
if (lang === 'id') {
  document.documentElement.lang = 'id';
  document.title = 'Anda sedang offline';
  document.querySelector('h1').textContent = 'Anda sedang offline';
  document.querySelector('.card p').textContent = 'Aplikasi perlu koneksi untuk menampilkan pekerjaan Anda. Periksa Wi‑Fi atau data seluler Anda. Halaman ini membuka aplikasi lagi dengan sendirinya begitu Anda kembali online.';
  document.getElementById('retry').textContent = 'Coba lagi';
}
