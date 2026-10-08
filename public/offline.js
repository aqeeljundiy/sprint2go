// The offline page (offline.html): try again on a tap, and by itself as soon as the connection is back.
const again = () => location.reload();
document.getElementById('retry').addEventListener('click', again);
addEventListener('online', again);
