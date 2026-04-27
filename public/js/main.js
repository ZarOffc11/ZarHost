// Global helpers used across pages.

window.ZH = window.ZH || {};

ZH.formatIDR = function (n) {
  if (n === null || n === undefined || isNaN(Number(n))) return 'Rp 0';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
};

ZH.toast = function (icon, title) {
  if (!window.Swal) return;
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: icon || 'info',
    title: title || '',
    showConfirmButton: false,
    timer: 3500,
    background: '#16161F',
    color: '#F1F5F9',
  });
};

// Toggle password visibility for any [data-toggle-pass="<targetId>"]
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-toggle-pass]');
  if (!btn) return;
  var input = document.getElementById(btn.dataset.togglePass);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    btn.querySelector('i')?.classList.replace('fa-eye', 'fa-eye-slash');
  } else {
    input.type = 'password';
    btn.querySelector('i')?.classList.replace('fa-eye-slash', 'fa-eye');
  }
});

// Copy-to-clipboard for any [data-copy="..."]
document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-copy]');
  if (!btn) return;
  var value = btn.dataset.copy;
  if (!value) {
    var target = btn.dataset.copyTarget && document.getElementById(btn.dataset.copyTarget);
    if (target) value = target.value || target.innerText;
  }
  if (!value) return;
  navigator.clipboard.writeText(value).then(function () {
    ZH.toast('success', 'Disalin ke clipboard');
  });
});
