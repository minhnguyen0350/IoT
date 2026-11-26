require('dotenv').config();
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

async function main() {
    const db = await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'iot_system'
    });

    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const passwordHash = await bcrypt.hash(password, 12);

    await db.execute(
        `INSERT INTO users (username, password_hash, full_name, email, role, is_active)
         VALUES (?, ?, 'System Administrator', NULL, 'ADMIN', 1)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), is_active = 1`,
        [username, passwordHash]
    );

    console.log(`Da tao/cap nhat tai khoan: ${username}`);
    console.log('Hay doi mat khau mau sau lan dang nhap dau tien.');
    await db.end();
}

main().catch(error => {
    console.error('Khong tao duoc tai khoan admin:', error.message);
    process.exit(1);
});
