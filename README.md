# Waku Download

Tiện ích Chrome / Edge chạy cục bộ để gom và tải hàng loạt **ảnh** từ profile X và Facebook. Không cần Python, Node, API key hay server để sử dụng.

## Cài một lần

1. Mở `chrome://extensions` (Chrome) hoặc `edge://extensions` (Edge).
2. Bật **Developer mode / Chế độ dành cho nhà phát triển**.
3. Bấm **Load unpacked / Tải tiện ích đã giải nén**.
4. Chọn thư mục **`D:\project2026\xdownload\extension`**.
5. Ghim **Waku Download** trong menu tiện ích để dễ mở.
6. **Tải lại tab X hoặc Facebook** nếu tab đã mở trước lúc cài tiện ích.

Có thể bấm đúp `MO-THU-MUC-CAI.cmd` để mở sẵn thư mục cài đặt.

## Tải ảnh

1. Đăng nhập X bằng trình duyệt như bình thường. Mở profile cần tải → tab **Ảnh / Media**.
2. Bấm biểu tượng **Waku Download** để mở bảng ghim ở bên phải trang X.
3. **Cuộn trang X như bình thường.** Bảng tự nhận ảnh đã load, gom theo bài đăng; không cần nút quét hay tự cuộn.
4. Mặc định chọn ảnh mới. Có thể bỏ chọn từng ảnh, từng bài, hoặc toàn bộ; tắt “Chọn ảnh mới” nếu không muốn tự chọn các ảnh xuất hiện sau đó.
5. Bấm **Tải … ảnh đã chọn**, hoặc nút ↧ cạnh một bài để tải riêng bài đó. File nằm ở **Downloads/WakuDownload/X/username (số ảnh)/**, ví dụ `Downloads/WakuDownload/X/andayne (112)/`.

Với Facebook, đăng nhập Facebook, mở profile → tab **Ảnh**, chẳng hạn `https://web.facebook.com/profile.php?id=100075970176818&sk=photos`. Bấm biểu tượng tiện ích, cuộn trang và tải ảnh đã chọn như trên. Ảnh lưu tại **Downloads/WakuDownload/Facebook/<tên hoặc ID profile> (số ảnh)/**. Danh sách và lịch sử ảnh Facebook được lưu riêng với X.

Số trong tên thư mục là số ảnh của **lượt tải đó sau khi đã bỏ ảnh trùng hoặc ảnh đã lưu**. Tên được đặt lúc bắt đầu tải: nếu có ảnh lỗi hoặc bạn dừng giữa chừng, số file thành công thực tế có thể ít hơn; thử lại ảnh lỗi sẽ dùng cùng thư mục. Những lượt tải khác có thể tạo thư mục với số khác.

Bấm **»** ở góc trên bên phải để thu gọn bảng thành nút **↓** nằm ở **góc trên bên phải trang**; bấm nút nhỏ để mở lại. Khi thu gọn, ảnh vẫn được gom. Bấm ra ngoài hoặc chuyển tab không đóng bảng và không làm tải lại các ảnh xem trước. Sau lần mở đầu tiên, bảng tự xuất hiện trên các tab X/Facebook khác; mỗi tab giữ danh sách riêng, còn tiến trình tải hiện chung.

**Nút tải, thanh tiến trình, Dừng tải và Thử lại nằm cố định ở đáy bảng**; chỉ phần danh sách bài đăng cuộn. Hàng đợi tải chạy nền với tối đa 3 ảnh cùng lúc, kể cả khi thu gọn hoặc chuyển tab.

Bản **1.1.4** tách lưu danh sách quét khỏi hàng đợi tải, bắt đầu ảnh tiếp theo trước khi ghi tiến trình và chỉ cập nhật vùng tiến trình khi trạng thái tải thay đổi. Giữ nguyên 3 ảnh đồng thời và chất lượng ảnh gốc. Bài đo mô phỏng 100 ảnh giảm từ 302 xuống 101 lần ghi bộ nhớ; đây là chi phí xử lý nội bộ, không phải phép đo tốc độ mạng từ X.

### Cập nhật tiện ích

Vào `chrome://extensions` hoặc `edge://extensions`, bấm **Reload / Tải lại** trên thẻ tiện ích, sau đó **tải lại các tab X/Facebook**. Nếu trình duyệt yêu cầu chấp nhận quyền truy cập Facebook, hãy bật lại tiện ích và chấp nhận quyền đó. Lịch sử và lượt tải đã lưu của bản cũ được giữ nguyên.

Từ phiên bản 1.3.0, các lượt tải mới được lưu dưới `Downloads/WakuDownload/X/` hoặc `Downloads/WakuDownload/Facebook/`. Các lượt tải đang chạy hay thử lại từ phiên bản cũ tiếp tục lưu vào thư mục cũ để tránh chia ảnh của cùng một lượt. Ảnh đã tải trước đó vẫn nằm tại vị trí cũ.

Từ bản **1.1.2**, nếu Reload/cập nhật tiện ích khi tab X vẫn mở, phần chạy cũ tự dừng và nút nhỏ đổi thành **↻**. Bấm nút đó để tải lại tab và kết nối bản mới. Lỗi `Extension context invalidated` đã ghi trước khi cập nhật có thể còn trong trang Lỗi của Chrome; có thể xóa lịch sử lỗi cũ sau khi cập nhật.

Nếu Chrome vẫn hiện `Extension context invalidated` sau khi cập nhật: đóng các tab X/Facebook cũ, Reload tiện ích và kiểm tra phiên bản **1.3.0**, xóa lịch sử trong mục **Lỗi**, rồi mở lại profile trong tab mới. Dòng nguồn Chrome tô trong trang Lỗi có thể thuộc file hiện tại trong khi dấu vết ngăn xếp được lưu từ phiên cũ. Bản 1.1.3 bổ sung xử lý khi mất context ngay lúc đăng ký listener và khi gọi API từ bảng giao diện; kiểm thử đọc cả sổ lỗi tiện ích của Chrome, ngoài lỗi JavaScript của trang.

Tắt tùy chọn “Hỏi vị trí lưu từng tệp trước khi tải xuống” trong cài đặt Downloads của trình duyệt nếu nó hiện hộp thoại cho từng ảnh.

## Hành vi và giới hạn

- Đọc phản hồi dữ liệu mà trang X tự tải để lấy đủ ảnh trong một bài có nhiều ảnh. Có thêm cách đọc ảnh đang hiện trên trang. Bỏ qua ảnh đại diện, banner, video và bài của tài khoản khác.
- Nếu vừa cài tiện ích, ảnh đã load **trước khi cài** chỉ có thể được gom từ các ô đang còn trong trang. **Tải lại trang rồi cuộn lại** để bắt đầy đủ các bài và ảnh trong từng bài.
- Yêu cầu ảnh ở kích thước `orig` từ máy chủ ảnh X. File giữ đuôi jpg/png/webp theo dữ liệu nguồn; không phóng lớn hay chuyển đổi ảnh.
- Với Facebook, chỉ gom ảnh có liên kết ảnh đã xuất hiện trong tab Ảnh của profile. Tiện ích chọn ảnh lớn nhất có sẵn trong dữ liệu trang và giữ nguyên URL có chữ ký của Facebook. Nếu trang chỉ cung cấp ảnh thu nhỏ thì file tải có thể là ảnh thu nhỏ, không đảm bảo ảnh gốc. Đường dẫn có thể hết hạn: tải lại trang rồi cuộn lại để lấy đường dẫn mới nếu tải bị lỗi.
- Chống trùng trong một lượt quét. “Bỏ qua ảnh đã tải” dựa trên lịch sử **tải thành công của tiện ích** (tối đa 20.000 ảnh), không kiểm tra lại file nếu bạn đã xóa hoặc di chuyển nó. Bỏ dấu chọn để tải lại.
- Danh sách, lựa chọn ảnh, trạng thái thu gọn và vị trí cuộn trong bảng được lưu theo **tab/profile trong phiên trình duyệt**. Tải lại trang hoặc chuyển qua profile khác rồi quay về sẽ khôi phục danh sách. Đóng tab, tải lại/gỡ tiện ích hoặc kết thúc phiên trình duyệt sẽ xóa bộ nhớ danh sách của phiên; lượt tải đã bắt đầu và lịch sử tải được lưu riêng trong bộ nhớ cục bộ.
- Tự nhận tối đa 5.000 ảnh mỗi profile. Tiện ích không tự cuộn hoặc tự gửi yêu cầu lấy thêm bài; bạn cuộn đến đâu và X trả dữ liệu đến đâu thì danh sách được bổ sung đến đó.
- Chỉ tải nội dung tài khoản của bạn xem được. Số “ảnh và video” trên X là số bài/media X hiển thị; số ảnh tìm được có thể khác. Không cam kết lấy hết lịch sử nếu X giới hạn hoặc không trả nội dung cũ.
- Chỉ hỗ trợ ảnh trong bản này, chưa tải video. Khi X thay đổi cấu trúc dữ liệu hoặc trang, phần quét có thể cần cập nhật.
- Tiện ích không đọc/xuất cookie, không yêu cầu mật khẩu, không gửi dữ liệu tới server riêng. Quyền đọc trang giới hạn ở X/Twitter và Facebook; quyền downloads dùng để lưu ảnh và xem tiến độ.

## Phát triển và kiểm tra

Không cần các bước này để dùng tiện ích.

```powershell
npm.cmd install
npm.cmd test
npm.cmd run test:browser
npm.cmd run pack
```

Kiểm thử trình duyệt dùng Playwright Chromium, ưu tiên bản có sẵn tại máy; nếu chưa có, chạy `npx.cmd playwright install chromium`. Có thể đặt biến môi trường `XDL_CHROMIUM` thành đường dẫn trình duyệt Chromium dành cho kiểm thử. Kiểm thử bao gồm tự nhận ảnh qua fetch/XHR/DOM, thu gọn/mở lại, chuyển tab/profile, khôi phục sau reload, giữ nguyên node ảnh xem trước, vị trí cố định của footer ở cửa sổ thấp và Reload tiện ích khi tab X vẫn mở. Kiểm thử vòng đời còn bao gồm API ném lỗi ngay lập tức, Promise bị từ chối và runtime ID không còn hợp lệ. Dữ liệu X/Facebook và API tải trong kiểm thử trình duyệt được mô phỏng; phần hàng đợi được kiểm thử riêng, không dùng tài khoản thật.

Tài liệu API: [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [Chrome downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads).
