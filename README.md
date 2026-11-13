# ♠ KÉO XÌ DZÁCH MIỀN NAM — ONLINE MULTIPLAYER

Bộ game kéo Xì Dzách chơi cùng bạn bè **thực sự qua mạng**, hỗ trợ điện thoại và PC. Mỗi người chơi một thiết bị/trình duyệt, vào cùng **mã phòng 6 ký tự** hoặc link chia sẻ. Trò chơi phục vụ giải trí, **không có đặt cược hoặc tiền thật**.

## Chức năng

- Tạo phòng / nhập mã phòng / sao chép link mời (ví dụ `https://ten-app.onrender.com/?room=ABC234`).
- Tối đa **7 người** trong một bàn: 1 Nhà cái + 1–6 Nhà con.
- Chủ phòng chọn Nhà cái và mốc được chốt của Nhà cái (15 hoặc 16 điểm).
- Mỗi người tự kéo / dằn bài. Khi tất cả Nhà con hoàn thành, Nhà cái kéo / chốt / xét từng người hoặc xét cả bàn.
- **Xì Bàng, Xì Dách, Ngũ Linh, đủ tuổi, quắc**, quân Át 1/10/11 điểm linh hoạt.
- Bài trên máy chủ, giấu bài người khác cho tới khi xét/kết thúc (không gửi lá bài thật cho người không có quyền xem).
- Chat trong phòng, bảng thắng/thua/hòa; người mất kết nối có thể vào lại với cùng trình duyệt.
- Chủ phòng có thể bỏ lượt người đã mất kết nối; hủy ván nếu Nhà cái rớt mạng.
- Có hướng dẫn luật ngay trong trang; giao diện responsive.

## 1. Cách đưa lên GitHub (không cần cài code)

1. Giải nén **`Keo_Xi_Dzach_Online_GitHub_Render.zip`**.
2. Vào [github.com/new](https://github.com/new) và tạo repo mới, ví dụ `xi-dzach-mien-nam-online`.
3. Trong repo, chọn **Add file → Upload files**.
4. Kéo **toàn bộ nội dung BÊN TRONG** thư mục `xi-dzach-online` vào GitHub (giữ nguyên thư mục `public/`). Không chỉ tải lên file ZIP hoặc `index.html`.
5. Chọn **Commit changes**. Ở thư mục gốc repo phải thấy `server.js`, `game-core.js`, `package.json`, `render.yaml`, và thư mục `public`.

> Lưu ý: `index.html` riêng lẻ hay GitHub Pages **không đủ** để chơi nhiều người. Game cần máy chủ Node.js và WebSocket.

## 2. Deploy qua Render

1. Mở [dashboard.render.com](https://dashboard.render.com/).
2. Chọn **New → Web Service** (không chọn Static Site).
3. Kết nối tài khoản GitHub, chọn repo vừa tạo.
4. Cấu hình:
   - **Language / Runtime:** Node
   - **Branch:** `main` (hoặc branch chứa code)
   - **Root Directory:** để trống nếu file `package.json` ở gốc repo
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance type:** `Free` nếu thử nghiệm
5. Nhấn **Deploy Web Service**. Sau khi hiện **Live**, Render cấp link có dạng `https://ten-service.onrender.com`.
6. Mở link đó trên máy tính/điện thoại. Người thứ nhất **TẠO PHÒNG**, gửi **MỜI BẠN VÔ**. Người khác mở link, nhập tên và **VÀO PHÒNG**. Chủ phòng nhấn **CHIA BÀI**.

File `render.yaml` đã kèm cấu hình dành cho Render Blueprint, nếu muốn có thể deploy bằng **New → Blueprint** thay vì tự nhập các trường.

## 3. Chạy thử trên máy cá nhân

Cần Node.js phiên bản 20 trở lên:

```bash
npm install
npm test
npm start
```

Truy cập `http://localhost:3000`. Mở 2 cửa sổ trình duyệt khác nhau để tạo và vào cùng phòng trên máy tính. Để bạn bè truy cập từ Internet, cần deploy lên Render.

## 4. Luật phiên bản này

| Trường hợp | Luật |
| --- | --- |
| Xì Bàng | Đúng 2 lá A, thứ hạng cao nhất |
| Xì Dách | Đúng 2 lá: A + 10/J/Q/K |
| Ngũ Linh | 5 lá tổng ≤ 21, mạnh hơn bài điểm thường; hai Ngũ Linh thì ít điểm hơn thắng |
| Bài điểm | Nhà con 16–21 điểm, 21 là cao nhất |
| Quắc | Tổng >21 điểm |
| Át | Chọn điểm tối ưu trong 1, 10, 11 |
| Nhà cái | Chốt từ 15/16 điểm tùy cấu hình; chốt rồi mới xét |
| Cùng mức | Cùng điểm hoặc cùng Xì Bàng/Xì Dách thì hòa; cả hai quắc tính hòa theo biến thể mặc định này |
| Số lá | Mỗi người rút tới tối đa 5 lá |

> Xì Dách dân gian có biến thể tùy nhóm/địa phương (ví dụ cách xử lý cả cái lẫn con quắc). Quy ước trên được công bố rõ trong game để tránh tranh luận.

## 5. Điều cần biết khi dùng Render miễn phí

- Render Free **ngủ sau khoảng 15 phút không có hoạt động**, nên lượt truy cập sau đó có thể khởi động lại chậm.
- Trạng thái phòng/bài/thống kê hiện **chỉ lưu trong RAM**. Nếu Render restart, spin-down hoặc deploy lại, **phòng đang chơi và điểm cũ sẽ mất**. Khi đó tạo phòng mới.
- Nên chơi nhóm nhỏ, một máy chủ. Để lưu vĩnh viễn phòng, cần thêm database như Redis/Postgres và cơ chế đồng bộ bền vững.
- Không gửi tiền, nạp tiền, thanh toán hay tài khoản; toàn bộ là trò chơi giải trí.

Tham khảo cách deploy: [Render Node Express/Web Service](https://render.com/docs/deploy-node-express-app), [Render Free instance](https://render.com/docs/free), [Render Blueprint](https://render.com/docs/infrastructure-as-code).

## Cấu trúc dự án

```text
xi-dzach-online/
├── public/
│   ├── index.html       # giao diện
│   ├── style.css        # desktop + mobile
│   ├── app.js           # client WebSocket & tương tác
│   └── favicon.svg
├── test/
│   ├── game.test.js
│   └── server.test.js
├── game-core.js         # bộ luật, bộ bài, tính thắng thua
├── server.js            # máy chủ HTTP / WebSocket, phòng chơi
├── package.json
├── render.yaml
├── .gitignore
└── README.md
```

**Ghi chú:** Không dùng thư viện npm ngoài nên cài đặt nhẹ; Render chỉ cần Node.js. Không triển khai GitHub Pages đơn độc.
