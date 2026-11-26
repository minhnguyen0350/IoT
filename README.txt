IOT SYSTEM - HUONG DAN CAI DAT VA CHAY

1. THANH PHAN
- frontend/: Giao dien HTML/CSS/JavaScript.
- backend/: Node.js, Express, MQTT, MySQL va JWT.
- database/iot_system.sql: Tao database va cac bang.

2. YEU CAU
- Node.js ban LTS.
- MySQL 8.x (hoac phien ban tuong thich).
- MQTT broker co the truy cap tu may chay Backend.
- ESP32 da duoc cau hinh publish/subscribe cac topic trong muc 7.

3. TAO DATABASE
- Mo MySQL Workbench hoac phpMyAdmin.
- Import va chay file database/iot_system.sql.
- Database duoc tao ten iot_system, gom users, sensor_data, activity_logs, devices.

4. CAU HINH BACKEND
- Mo CMD/Terminal tai thu muc backend.
- Chay: npm install
- Sao chep .env.example thanh .env.
- Dien cac gia tri DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
- Dien MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD theo broker dang dung.
- Tao JWT_SECRET la mot chuoi ngau nhien dai it nhat 32 ky tu.

5. TAO TAI KHOAN QUAN TRI
- Trong thu muc backend, chay: npm run seed:admin
- Mac dinh tai khoan mau: admin
- Mat khau mau: admin123
- Co the thay doi bang ADMIN_USERNAME va ADMIN_PASSWORD trong .env truoc khi chay lenh seed.
- Lenh seed tao mat khau da bam bcrypt va co the chay lai de cap nhat tai khoan admin.
- Doi mat khau mau truoc khi dua he thong vao su dung that.

6. KHOI DONG
- Trong thu muc backend, chay: npm start
- Backend chi khoi dong API sau khi ket noi MySQL thanh cong.
- Mo trinh duyet: http://localhost:3000
- Dang nhap bang tai khoan da tao o buoc 5.

7. CAC TOPIC MQTT
- home/sensor: ESP32 publish JSON gom temperature, humidity, light.
- home/led/1: Backend publish lenh 0/1 cho LED 1.
- home/led/2: Backend publish lenh 0/1 cho LED 2.
- home/led/all: Backend publish lenh 0/1 cho ca hai LED.
- home/led/history: ESP32 publish lich su bat/tat theo dinh dang LED 1 ON, LED 2 OFF, ALL LED ON/OFF.
- home/led/state: ESP32 publish JSON trang thai thuc te, vi du {"led1":true,"led2":false}.

8. API
- POST /api/auth/sign-in: Dang nhap va nhan JWT.
- GET /api/health: Kiem tra Backend, MQTT va MySQL (khong can JWT).
- GET /api/dashboard/led: Lay trang thai LED (can JWT).
- POST /api/dashboard/control: Dieu khien mot LED (can JWT).
- POST /api/dashboard/control/all: Dieu khien ca hai LED (can JWT).
- GET /api/sensor-data?limit=500: Lay du lieu cam bien (can JWT).
- GET /api/activity: Lay lich su hoat dong (can JWT).
- GET /api/iot-devices: Lay danh sach thiet bi (can JWT).

9. LUU Y
- Cac API tru /api/health va /api/auth/sign-in yeu cau Authorization: Bearer <token>.
- Du lieu cam bien va lich su hoat dong duoc luu trong MySQL, khong con chi nam trong RAM.
- Trang thai LED duoc cap nhat tu topic home/led/state va home/led/history.
- Lich su gan nguoi dung duoc ghi khi Backend nhan xac nhan MQTT tu lenh do nguoi dung gui. Thao tac phat sinh truc tiep tu ESP32 hien thi nguoi dung ESP32.
- Neu ESP32 khong gui topic home/led/state hoac home/led/history thi Backend khong the xac nhan trang thai moi cua LED.
- Khong chia se file .env; file nay chua thong tin ket noi va JWT secret.
