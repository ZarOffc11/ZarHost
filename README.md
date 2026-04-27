# ZarHost — Website Jual Hosting CloudPanel

Website jual layanan hosting **production-ready**, dibangun dengan **Node.js + Express + EJS + SQLite**.
Setiap pembelian/perpanjangan otomatis di-provisioning ke VPS **CloudPanel** lewat
`cloudpanel-sdk` (SSH + `clpctl`). Pembayaran via **QRIS otomatis** menggunakan payment
gateway [fr3newera.com](https://fr3newera.com).

## Fitur Utama

- Landing page modern (dark elegant) dengan animasi AOS + tsParticles
- Register / Login dengan validasi `express-validator`, password di-hash bcrypt
- Dashboard user: hosting saya, perpanjang, riwayat transaksi, profil
- Checkout QRIS: QR di-render di backend (`qrcode`), auto-polling status tiap 5 detik, countdown timer
- PPN 11% otomatis di setiap transaksi
- Provisioning otomatis ke CloudPanel (`addPhp`, `database.add`, `letsEncrypt.installCertificate`)
- Auto-suspend hosting yang expired via cron job (`node-cron`, tiap jam)
- Admin panel: users, hostings, transactions, packages (CRUD), VPS config + tombol Test Koneksi
- Tampilan kredensial hosting (SSH/SFTP, MySQL, Nameserver) di dashboard user
- Retry provisioning ketika gagal
- Session persistent di SQLite

## Tech Stack

**Backend:** Node.js 18+, Express, EJS, better-sqlite3, express-session, bcryptjs, axios, node-cron, cloudpanel-sdk, qrcode, express-validator, express-rate-limit.

**Frontend:** Tailwind CSS (CDN play), AOS, SweetAlert2, Font Awesome 6, Material Icons, Google Fonts (Poppins + Inter), Chart.js, tsParticles.

## Quick Start

```bash
git clone https://github.com/ZarOffc11/ZarHost.git
cd ZarHost
cp .env.example .env
# Edit .env: isi PAYMENT_API_KEY, CLOUDPANEL_HOST, CLOUDPANEL_PASSWORD, dst.
npm install
npm start
```

Buka [http://localhost:3000](http://localhost:3000).

Akun admin default akan otomatis dibuat dari `.env` (`ADMIN_EMAIL`, `ADMIN_PASSWORD`).

## Mode Tanpa VPS (Dev)

Untuk testing tanpa VPS CloudPanel asli, set:

```env
SKIP_CLOUDPANEL=true
```

Dengan flag ini, provisioning **tidak** akan SSH ke VPS — sistem hanya generate kredensial
dummy supaya seluruh alur (checkout → bayar → hosting active → tampilkan info akses)
dapat diuji secara end-to-end di lokal.

## Struktur Folder

```
ZarHost/
├── src/
│   ├── routes/       # index, auth, dashboard, payment, admin
│   ├── middleware/   # auth, ppn
│   ├── lib/          # db, payment, cloudpanel, cron
│   └── views/        # EJS (layouts, pages, partials)
├── public/           # static (css, js)
├── index.js          # entry point
├── .env.example
└── package.json
```

## Database

SQLite (file: `./data/zarhost.db`). Migration & seed otomatis saat startup pertama.

## Endpoints utama

| Method | Path | Deskripsi |
| --- | --- | --- |
| GET | `/` | Landing page |
| GET | `/pricing` | Halaman paket |
| GET/POST | `/auth/register` | Registrasi |
| GET/POST | `/auth/login` | Login |
| POST | `/auth/logout` | Logout |
| GET | `/dashboard` | Dashboard user |
| GET | `/dashboard/hosting` | Hosting saya |
| GET/POST | `/dashboard/renew/:id` | Perpanjang |
| GET | `/dashboard/history` | Riwayat transaksi |
| GET/POST | `/dashboard/profile` | Profil |
| POST | `/payment/buy/:packageId` | Mulai beli baru |
| GET | `/payment/checkout/:trxId` | Halaman QR |
| POST | `/payment/cancel/:trxId` | Batalkan |
| GET | `/api/payment/status/:trxId` | Polling status |
| GET | `/admin` | Dashboard admin |
| GET | `/admin/users` | Manajemen user |
| GET | `/admin/hostings` | Semua hosting |
| GET | `/admin/transactions` | Semua transaksi |
| GET | `/admin/packages` | CRUD paket |
| GET/POST | `/admin/vps-config` | Config VPS + Test Koneksi |
| POST | `/admin/api/test-vps` | Endpoint AJAX test koneksi |
| POST | `/admin/hostings/:id/retry` | Retry provisioning |

## Lisensi

MIT © ZarOffc
