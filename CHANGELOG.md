# Changelog

## 1.4.6

- Dùng FxTwitter dự phòng khi nguồn nhúng X không cung cấp video công khai.

## 1.4.5

- Nhận video X từ ảnh xem trước trên lưới media và bổ sung các dạng dữ liệu video.
- Giảm tính lại bố cục khi gắn nút tiện ích trên trang X.

## 1.4.4

- Khi chuyển Reel Facebook mà dữ liệu chưa được tải sẵn, tự tìm dữ liệu của đúng Reel hiện tại bằng phiên đăng nhập trên Facebook.
- Hủy yêu cầu cũ khi chuyển nhanh giữa các Reel và thêm nút tìm lại nếu Facebook không trả về video.

## 1.4.3

- Nhận Reel Facebook tiếp theo khi chuyển video trong cùng tab, kể cả dữ liệu đã được tải sẵn trước khi chuyển.
- Giữ lựa chọn theo từng tác giả và hiển thị đúng loại video trong danh sách.

## 1.4.2

- Nhận video X khi dữ liệu media thiếu ID hoặc khi bài video xuất hiện trên trang nhưng timeline không cung cấp video trực tiếp.
- Dùng dữ liệu Pixiv mà trang đã tải, gửi đúng phiên đăng nhập khi lấy Ugoira và thông báo rõ hơn khi tác phẩm giới hạn.
- Kiểm tra lại việc tải Reel Facebook, video X và Ugoira công khai trong trình duyệt.

## 1.4.1

- Cải thiện nhận video Facebook Reel, bao gồm dữ liệu phát mới và các luồng DASH MP4 có hình và tiếng riêng.
- Ghép các luồng tương thích thành MP4 trên máy; báo rõ khi không thấy track tiếng.

## 1.4.0

- Thêm bộ chọn ảnh và video; có thể tải riêng hoặc tải cả hai trong một lượt.
- Tải video MP4 sẵn có trên X và Facebook, ưu tiên chất lượng cao nhất mà trang cung cấp.
- Hỗ trợ chuyển Ugoira Pixiv thành WebM trực tiếp trên máy.

## 1.3.0

- Tạm dừng và tiếp tục hàng đợi; các ảnh đã bắt đầu vẫn tải xong.
- Tự thử lại tối đa hai lần khi gặp lỗi mạng hoặc máy chủ tạm thời; hiển thị hướng dẫn theo loại lỗi.
- Giữ nút điều khiển phản hồi khi Pixiv đang chuẩn bị ảnh gốc, sửa thông báo lỗi Pixiv bị sai ký tự.

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
