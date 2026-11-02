# Changelog

## 1.2.2

- Mở X, Facebook và Pixiv với nút logo thu gọn; bấm nút để mở bảng.
- Thu nhỏ nút và cho phép kéo ghim vào mép trái hoặc phải, ghi nhớ vị trí giữa các tab.

## 1.2.1

- Sửa tải ảnh gốc Pixiv khi máy chủ yêu cầu Referer.
- Tự nhận ảnh của trang tác phẩm Pixiv và giữ danh sách profile khi chuyển qua lại.

## 1.2.0

- Hỗ trợ gom ảnh trên profile Pixiv, lấy ảnh gốc của từng trang tác phẩm và lưu vào thư mục Pixiv.
- Thêm link profile Pixiv theo ID vào file nguồn; giữ tiến trình tải và lựa chọn như các nền tảng khác.

## 1.1.0

- Tạo file `#nguon.txt` trong thư mục tải, ghi tên và link profile của tác giả.
- Ưu tiên link theo ID nếu dữ liệu trang cung cấp ID khớp với profile; giữ link username khi không có ID.
- Hiển thị lỗi và hỗ trợ thử lại nếu file nguồn không được tạo.

## 1.0.0

- Gom ảnh đã tải trên profile X và Facebook khi cuộn trang.
- Bảng ghim bên phải, giao diện tối, lựa chọn ảnh và thu gọn khi cần.
- Tải hàng loạt với tiến trình, dừng, thử lại và bỏ qua ảnh đã tải.
- Lưu dưới `WakuDownload/X/` và `WakuDownload/Facebook/`, kèm số ảnh của lượt tải trong tên thư mục.
- Giữ trạng thái và hỗ trợ tiếp tục các lượt tải cũ sau khi cập nhật.
