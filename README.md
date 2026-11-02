# Waku Download

Tiện ích Chrome và Microsoft Edge giúp gom và tải hàng loạt ảnh trên profile **X**, **Facebook** và **Pixiv**. Cuộn trang để nhận thêm ảnh, chọn ảnh cần lưu rồi theo dõi tiến trình trong bảng bên phải.

## Cài đặt

1. Tải gói ZIP của bản phát hành từ [GitHub Releases](https://github.com/takeshi7502/waku-download/releases/latest) và giải nén.
2. Mở `chrome://extensions` hoặc `edge://extensions`, bật **Developer mode / Chế độ dành cho nhà phát triển**.
3. Chọn **Load unpacked / Tải tiện ích đã giải nén**, rồi chọn thư mục vừa giải nén có chứa `manifest.json`.
4. Ghim **Waku Download** trong menu tiện ích và tải lại tab X, Facebook hoặc Pixiv đang mở.

Nếu cài trực tiếp từ mã nguồn, chọn thư mục **`extension`** bên trong dự án. Không chọn thư mục cha của dự án: tệp `manifest.json` nằm trong `extension`.

## Sử dụng

1. Đăng nhập nền tảng, mở profile cần tải; trên X hoặc Facebook chọn tab **Ảnh / Media**, trên Pixiv mở trang tác phẩm của tác giả.
2. Bấm biểu tượng **Waku Download** trên trang để mở bảng. Bảng tự thêm ảnh khi bạn cuộn trang.
3. Chọn ảnh, bài đăng hoặc tất cả, rồi bấm **Tải ảnh đã chọn**. Tiến trình, nút tạm dừng, dừng và thử lại được giữ ở đáy bảng.
4. Bấm **»** để thu gọn; bấm logo Waku để mở lại. Kéo logo sang trái hoặc phải, rồi thả để ghim vào mép gần nhất. Vị trí được ghi nhớ. Có thể chuyển tab hoặc thu gọn trong khi tải; khi mở lại trang, bảng khởi đầu ở dạng thu gọn.

Các lượt tải mới nằm trong thư mục Downloads mặc định của trình duyệt:

```text
WakuDownload/
├── X/
│   └── andayne (112)/
└── Facebook/
    └── 100075970176818 (50)/
└── Pixiv/
    └── 123456 (30)/
```

Số trong tên thư mục là số ảnh của lượt tải sau khi bỏ trùng và ảnh đã lưu. Tên được đặt lúc bắt đầu tải; nếu dừng hoặc có ảnh lỗi, số file thành công có thể ít hơn. Thử lại ảnh lỗi dùng cùng thư mục. Có thể tắt **Bỏ qua ảnh đã tải** để tải lại những ảnh đã lưu trước đây.

Bấm **Tạm dừng** để ngừng bắt đầu ảnh mới; ảnh đã bắt đầu sẽ tải xong. Bấm **Tiếp tục** để xử lý các ảnh đang chờ. Lỗi mạng, giới hạn tạm thời hoặc lỗi máy chủ được tự thử lại tối đa hai lần, sau khoảng chờ; các lỗi khác hiện hướng dẫn để bạn xử lý và thử lại thủ công. Những ảnh đã tải thành công không bị tải lại khi thử lại ảnh lỗi.

Mỗi lượt tải còn có một file `#nguon.txt` trong cùng thư mục, ghi nền tảng, tên tác giả, tài khoản và link profile. Nếu dữ liệu trang có ID số của đúng profile, link ưu tiên dạng ID; nếu không có ID, file giữ link theo username. Nếu thư mục đã có `#nguon.txt`, Chrome có thể thêm số vào tên file mới để tránh ghi đè file cũ.

Để tránh hộp thoại xuất hiện cho từng ảnh, tắt tùy chọn hỏi vị trí lưu trước mỗi lượt tải trong phần Downloads của trình duyệt.

## Phạm vi và chất lượng ảnh

- Tiện ích gom ảnh mà tài khoản đang đăng nhập có thể xem và trang đã tải. Mỗi profile tối đa 5.000 ảnh trong danh sách; tiện ích không tự cuộn hay gửi yêu cầu tải thêm bài.
- Trên X, tiện ích yêu cầu ảnh kích thước `orig` và nhận các ảnh trong một bài khi dữ liệu có sẵn. Video không được tải.
- Trên Facebook, chỉ ảnh có liên kết ảnh xuất hiện trong tab Ảnh của profile được đưa vào danh sách. Tiện ích chọn ảnh lớn nhất có sẵn trong dữ liệu trang; nếu Facebook chỉ cung cấp ảnh thu nhỏ, file tải có thể là ảnh thu nhỏ. URL ảnh Facebook có thể hết hạn; tải lại trang và cuộn lại nếu cần lấy URL mới.
- Trên Pixiv, tiện ích hỏi Pixiv thông tin của các tác phẩm xuất hiện trên profile hoặc tác phẩm đang mở và lấy URL `original` cho từng trang, kể cả tác phẩm nhiều ảnh. Khi mở trang tác phẩm, bảng chỉ hiện ảnh của tác phẩm đó; trở về profile sẽ hiện lại danh sách đã gom. Ảnh chỉ xuất hiện khi Pixiv trả về ảnh gốc; tải lại trang để thử lại nếu không lấy được dữ liệu. Ugoira (ảnh động) không được tải. Nội dung bị giới hạn cần tài khoản có quyền xem.
- Danh sách, lựa chọn và vị trí cuộn được giữ theo tab/profile trong phiên trình duyệt. Lịch sử tải thành công và hàng đợi tải được lưu cục bộ; lịch sử không kiểm tra lại file nếu bạn đã di chuyển hoặc xóa file đó.
- Tiện ích không yêu cầu mật khẩu, không xuất cookie và không gửi dữ liệu tới máy chủ riêng. Để Pixiv cho phép tải ảnh gốc, tiện ích đặt Referer của các yêu cầu đến `i.pximg.net` thành địa chỉ Pixiv và dùng tài liệu chạy nền để chuyển ảnh vào trình quản lý tải. Khi cấu trúc các trang thay đổi, phần nhận ảnh có thể cần cập nhật.

Khi cập nhật tiện ích, bấm **Reload / Tải lại** trong trang tiện ích rồi tải lại các tab X/Facebook. Lượt tải cũ đang chạy hoặc đang thử lại tiếp tục dùng thư mục đã được chỉ định lúc bắt đầu; ảnh cũ không tự di chuyển sang cấu trúc thư mục mới.

## Phát triển

```text
extension/
├── manifest.json          # Chrome/Edge: chọn thư mục này khi cài từ source
├── panel.html             # Điểm vào của bảng giao diện
├── assets/                # Biểu tượng
└── src/
    ├── background.js      # Hàng đợi tải và lưu trạng thái
    ├── bridge.js          # Đọc dữ liệu trang đã tải
    ├── content.js         # Gom ảnh và ghim bảng vào trang
    ├── platforms/         # Xử lý dữ liệu X và Facebook
    └── ui/                # Giao diện bảng
tests/                     # Kiểm thử logic và trình duyệt
scripts/                   # Đóng gói và công cụ phát triển
```

Yêu cầu Node.js 22 trở lên. Trên Windows:

```powershell
npm.cmd ci
npx.cmd playwright install chromium
npm.cmd test
npm.cmd run test:browser
npm.cmd run pack
```

Gói cài đặt được tạo tại `dist/WakuDownload-v<phiên bản>.zip`, với `manifest.json` ở ngay thư mục gốc của tệp ZIP. Có thể đặt biến môi trường `WAKU_CHROMIUM` thành đường dẫn Chromium để kiểm thử bằng trình duyệt có sẵn. Dữ liệu X/Facebook trong kiểm thử trình duyệt được mô phỏng; kiểm thử không đăng nhập tài khoản thật.

Nếu sau khi cập nhật Chrome vẫn hiển thị `Extension context invalidated`, hãy tải lại các tab X/Facebook và xóa lịch sử lỗi cũ trong trang tiện ích. Chrome có thể giữ dấu vết lỗi từ phiên trước.
